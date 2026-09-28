const getConstants = () => {
  const g = globalThis as unknown as { ScrollHideConstants?: { RESTRICTED_HOSTS: string[]; RESTRICTED_PROTOCOLS: string[] } };
  return g.ScrollHideConstants || {
    RESTRICTED_HOSTS: [] as string[],
    RESTRICTED_PROTOCOLS: [
      'chrome:',
      'chrome-extension:',
      'edge:',
      'about:',
      'view-source:',
      'devtools:',
    ],
  };
};

export const sanitizeDomain = (raw: unknown): string => {
  let str = String(raw || '').trim().toLowerCase();
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

export const normalizeWhitelist = (domains: unknown): string[] =>
  [...new Set(
    (Array.isArray(domains) ? domains : [])
      .map((domain) => sanitizeDomain(domain))
      .filter(Boolean)
  )].sort();

export const serializeDomains = (domains: unknown): string =>
  normalizeWhitelist(domains).join('\n');

/**
 * Convert a single domain or wildcard rule into Chrome Extension match patterns (for excludeMatches)
 */
export const domainToMatchPatterns = (domain: string): string[] => {
  const clean = sanitizeDomain(domain);
  if (!clean) return [];
  if (clean.startsWith('*.')) {
    const apex = clean.slice(2);
    return [`*://${clean}/*`, `*://${apex}/*`];
  }
  const withoutWww = clean.startsWith('www.') ? clean.slice(4) : clean;
  return [`*://${withoutWww}/*`, `*://www.${withoutWww}/*`];
};

/**
 * Convert an entire whitelist into Chrome Extension excludeMatches array
 */
export const whitelistToExcludeMatches = (whitelist: string[] | unknown): string[] => {
  const list = normalizeWhitelist(whitelist);
  const patterns = new Set<string>();
  for (const domain of list) {
    for (const pattern of domainToMatchPatterns(domain)) {
      patterns.add(pattern);
    }
  }
  return [...patterns].sort();
};

let cachedWhitelist: unknown = null;
let cachedPatterns: any[] = [];
let cachedExactSet = new Set<string>();
let cachedWildcards: string[] = [];

/**
 * Check if a hostname or URL matches the whitelist using native URLPattern API
 */
export const isWhitelisted = (
  hostnameOrUrl: string | null | undefined,
  whitelist: string[] | unknown
): boolean => {
  if (!hostnameOrUrl) return false;
  let cleanHost = String(hostnameOrUrl).toLowerCase().replace(/:\d+$/, '').trim();
  if (cleanHost.includes('://')) {
    try {
      cleanHost = new URL(cleanHost).hostname;
    } catch (_) {}
  }
  if (!cleanHost) return false;

  if (whitelist !== cachedWhitelist) {
    cachedWhitelist = whitelist;
    const list = normalizeWhitelist(whitelist);
    cachedExactSet = new Set<string>();
    cachedPatterns = [];
    cachedWildcards = [];

    const hasNativeURLPattern = typeof (globalThis as any).URLPattern === 'function';

    for (const item of list) {
      if (item.startsWith('*.')) {
        const apex = item.slice(2);
        cachedExactSet.add(apex);
        cachedWildcards.push(apex);
        if (hasNativeURLPattern) {
          try {
            cachedPatterns.push(new (globalThis as any).URLPattern({ hostname: `{*.}?${apex}` }));
          } catch (_) {}
        }
      } else {
        const withoutWww = item.startsWith('www.') ? item.slice(4) : item;
        cachedExactSet.add(withoutWww);
        cachedExactSet.add(`www.${withoutWww}`);
        if (hasNativeURLPattern) {
          try {
            cachedPatterns.push(new (globalThis as any).URLPattern({ hostname: `{www.}?${withoutWww}` }));
          } catch (_) {}
        }
      }
    }
  }

  // 1. Instant O(1) exact match
  if (cachedExactSet.has(cleanHost)) return true;

  // 2. Native URLPattern matching
  if (cachedPatterns.length > 0) {
    for (const pattern of cachedPatterns) {
      if (pattern.test({ hostname: cleanHost })) return true;
    }
    return false;
  }

  // 3. Fallback matching
  for (const apex of cachedWildcards) {
    if (cleanHost.endsWith(`.${apex}`)) return true;
  }
  return false;
};

export const isRestrictedUrl = (url: string | null | undefined): boolean => {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    const { RESTRICTED_HOSTS, RESTRICTED_PROTOCOLS } = getConstants();
    return RESTRICTED_PROTOCOLS.includes(parsed.protocol) || RESTRICTED_HOSTS.includes(parsed.hostname);
  } catch (_) {
    return true;
  }
};

export const ScrollHideWhitelist = {
  domainToMatchPatterns,
  isRestrictedUrl,
  isWhitelisted,
  normalizeWhitelist,
  sanitizeDomain,
  serializeDomains,
  whitelistToExcludeMatches,
};

// Global assignment for HTML script tags
(globalThis as unknown as { ScrollHideWhitelist: typeof ScrollHideWhitelist }).ScrollHideWhitelist = ScrollHideWhitelist;
