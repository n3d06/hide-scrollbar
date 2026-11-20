(() => {
  // Lists live in shared/constants.js, which every context loads first
  const getConstants = () => globalThis.ScrollHideConstants;

  const sanitizeDomain = (raw) => {
    let str = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (!str || str.startsWith('!') || str.startsWith('#')) return '';

    str = str
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme
      .replace(/[/?#].*$/, '') // path, query, fragment
      .replace(/^.*@/, '') // credentials
      .replace(/:\d+$/, ''); // port

    // Checked after the scheme is gone so "https://*.example.com" keeps its wildcard
    const hasWildcard = str.startsWith('*');
    str = str.replace(/^\*+\.?/, '');
    if (!str) return '';
    return hasWildcard ? `*.${str}` : str;
  };

  const normalizeWhitelist = (domains) =>
    [
      ...new Set((Array.isArray(domains) ? domains : []).map((domain) => sanitizeDomain(domain)).filter(Boolean)),
    ].sort();

  const serializeDomains = (domains) => normalizeWhitelist(domains).join('\n');

  /**
   * Normalize a host for use inside a Chrome match pattern.
   * Converts IDN to punycode and rejects anything Chrome would refuse
   * (one bad pattern makes registerContentScripts fail entirely).
   */
  const toPatternHost = (host) => {
    try {
      const h = new URL(`http://${host}`).hostname;
      return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(h) ? h : '';
    } catch (_) {
      return '';
    }
  };

  /**
   * Convert a single domain or wildcard rule into Chrome Extension match patterns (for excludeMatches)
   */
  const domainToMatchPatterns = (domain) => {
    const clean = sanitizeDomain(domain);
    if (!clean) return [];
    if (clean.startsWith('*.')) {
      const apex = toPatternHost(clean.slice(2));
      return apex ? [`*://*.${apex}/*`, `*://${apex}/*`] : [];
    }
    const host = toPatternHost(clean.startsWith('www.') ? clean.slice(4) : clean);
    if (!host) return [];
    // Chrome rejects "www." in front of an IP address
    return /^\d+(\.\d+){3}$/.test(host) ? [`*://${host}/*`] : [`*://${host}/*`, `*://www.${host}/*`];
  };

  /**
   * Convert an entire whitelist into Chrome Extension excludeMatches array
   */
  const whitelistToExcludeMatches = (whitelist) => {
    const patterns = new Set();
    for (const domain of normalizeWhitelist(whitelist)) {
      for (const pattern of domainToMatchPatterns(domain)) {
        patterns.add(pattern);
      }
    }
    return [...patterns].sort();
  };

  /**
   * Split a whitelist into exact hosts and wildcard apexes.
   * Plain serializable data, so it can be passed to scripting.executeScript.
   */
  const buildMatcher = (whitelist) => {
    const exact = new Set();
    const wildcards = [];
    for (const item of normalizeWhitelist(whitelist)) {
      if (item.startsWith('*.')) {
        const apex = item.slice(2);
        exact.add(apex);
        wildcards.push(apex);
      } else {
        const base = item.startsWith('www.') ? item.slice(4) : item;
        exact.add(base);
        exact.add(`www.${base}`);
      }
    }
    return { exact: [...exact], wildcards };
  };

  const matchHost = (host, exact, wildcards) =>
    exact.includes(host) || wildcards.some((apex) => host.endsWith(`.${apex}`));

  /** @type {string[] | null} */
  let cachedWhitelist = null;
  /** @type {{ exact: string[], wildcards: string[] }} */
  let cachedMatcher = { exact: [], wildcards: [] };

  /**
   * Check if a hostname or URL matches the whitelist
   */
  const isWhitelisted = (hostnameOrUrl, whitelist) => {
    if (!hostnameOrUrl) return false;
    let host = String(hostnameOrUrl).toLowerCase().trim();
    if (host.includes('://')) {
      try {
        host = new URL(host).hostname;
      } catch (_) {}
    }
    host = host.replace(/:\d+$/, '');
    if (!host) return false;

    if (whitelist !== cachedWhitelist) {
      cachedWhitelist = whitelist;
      cachedMatcher = buildMatcher(whitelist);
    }
    return matchHost(host, cachedMatcher.exact, cachedMatcher.wildcards);
  };

  const isRestrictedUrl = (url) => {
    if (!url) return true;
    try {
      const parsed = new URL(url);
      const { RESTRICTED_HOSTS = [], RESTRICTED_PROTOCOLS = [], RESTRICTED_PATHS = [] } = getConstants();
      if (RESTRICTED_PROTOCOLS.includes(parsed.protocol) || RESTRICTED_HOSTS.includes(parsed.hostname)) return true;
      // "chrome.google.com/webstore" matches /webstore and /webstore/..., not /webstoreX
      const hostPath = parsed.hostname + parsed.pathname;
      return RESTRICTED_PATHS.some((prefix) => hostPath === prefix || hostPath.startsWith(`${prefix}/`));
    } catch (_) {
      return true;
    }
  };

  /** Whether the stylesheet should be active on `url` for the given sync state. */
  const shouldHideOn = (url, { scrollbarHidden, whitelist }) => {
    if (!scrollbarHidden || isRestrictedUrl(url)) return false;
    try {
      return !isWhitelisted(new URL(url).hostname, whitelist);
    } catch (_) {
      return false;
    }
  };

  /**
   * What the popup shows for a tab URL.
   * `host` is set only for pages that can go on the whitelist (http, https, ...).
   */
  const describeUrl = (url) => {
    const restricted = isRestrictedUrl(url);
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return { label: '', host: '', restricted };
    }

    const { RESTRICTED_PROTOCOLS = [] } = getConstants();
    if (parsed.protocol === 'about:') return { label: parsed.href, host: '', restricted };
    if (parsed.protocol === 'file:') {
      const fileName = parsed.pathname.split('/').filter(Boolean).pop();
      return { label: fileName ? `file://.../${fileName}` : 'file://local-file', host: '', restricted };
    }
    if (RESTRICTED_PROTOCOLS.includes(parsed.protocol)) {
      return { label: `${parsed.protocol}//${parsed.hostname}`, host: '', restricted };
    }
    return { label: parsed.hostname, host: parsed.hostname, restricted };
  };

  /**
   * Lines from an imported whitelist file: plain text (one domain per line),
   * a JSON array, or a JSON object with a "whitelist" array (a settings backup).
   * Returns null for JSON that has neither shape.
   */
  const parseWhitelistFile = (text) => {
    const trimmed = String(text ?? '').trim();
    let lines = trimmed.split('\n');
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) lines = parsed;
        else if (Array.isArray(parsed?.whitelist)) lines = parsed.whitelist;
        else return null;
      } catch (_) {
        // Not JSON after all: treat as plain text
      }
    }
    return lines.map((line) => String(line).trim()).filter(Boolean);
  };

  const ScrollHideWhitelist = {
    buildMatcher,
    describeUrl,
    domainToMatchPatterns,
    isRestrictedUrl,
    isWhitelisted,
    normalizeWhitelist,
    parseWhitelistFile,
    sanitizeDomain,
    serializeDomains,
    shouldHideOn,
    whitelistToExcludeMatches,
  };

  // Global assignment for the service worker & HTML script tags
  globalThis.ScrollHideWhitelist = ScrollHideWhitelist;
})();
