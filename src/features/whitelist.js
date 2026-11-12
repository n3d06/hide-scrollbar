(() => {
  const getConstants = () => {
    const g = globalThis;
    return (
      g.ScrollHideConstants || {
        RESTRICTED_HOSTS: [
          // Firefox blocks extensions on these Mozilla pages
          'addons.mozilla.org',
          'accounts.firefox.com',
          'support.mozilla.org',
        ],
        RESTRICTED_PROTOCOLS: ['chrome:', 'chrome-extension:', 'edge:', 'about:', 'view-source:', 'devtools:', 'moz-extension:', 'resource:'],
      }
    );
  };

  const sanitizeDomain = (raw) => {
    let str = String(raw || '')
      .trim()
      .toLowerCase();
    if (!str || str.startsWith('!') || str.startsWith('#')) return '';

    const hasWildcard = str.startsWith('*.') || str.startsWith('*');
    str = str
      .replace(/^[a-zA-Z]+:\/\//, '')
      .replace(/^.*@/, '')
      .replace(/[/?#].*$/, '')
      .replace(/:\d+$/, '');

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

  let cachedWhitelist = null;
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
      const { RESTRICTED_HOSTS, RESTRICTED_PROTOCOLS } = getConstants();
      return RESTRICTED_PROTOCOLS.includes(parsed.protocol) || RESTRICTED_HOSTS.includes(parsed.hostname);
    } catch (_) {
      return true;
    }
  };

  const ScrollHideWhitelist = {
    buildMatcher,
    domainToMatchPatterns,
    isRestrictedUrl,
    isWhitelisted,
    normalizeWhitelist,
    sanitizeDomain,
    serializeDomains,
    whitelistToExcludeMatches,
  };

  // Global assignment for HTML script tags
  globalThis.ScrollHideWhitelist = ScrollHideWhitelist;
})();
