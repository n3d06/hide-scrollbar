const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

require('../../src/shared/constants.js');
require('../../src/features/whitelist.js');

const {
  buildMatcher,
  domainToMatchPatterns,
  isRestrictedUrl,
  isWhitelisted,
  normalizeWhitelist,
  sanitizeDomain,
  serializeDomains,
  whitelistToExcludeMatches,
} = globalThis.ScrollHideWhitelist;

describe('sanitizeDomain', () => {
  const cases = [
    ['https://example.com/path?query=1', 'example.com', 'strips scheme, path and query'],
    ['   sub.domain.co.uk/   ', 'sub.domain.co.uk', 'trims whitespace and trailing slash'],
    ['http://localhost:3000/test', 'localhost', 'strips port from localhost'],
    ['127.0.0.1:8080', '127.0.0.1', 'strips port from IP'],
    ['https://admin:pass@example.com/test', 'example.com', 'strips credentials'],
    ['EXAMPLE.COM', 'example.com', 'lowercases'],
    ['example.com#frag', 'example.com', 'strips fragment'],
    ['*.google.com', '*.google.com', 'keeps a *. wildcard'],
    ['*google.com', '*.google.com', 'normalizes a bare * wildcard'],
    ['! This is a comment', '', 'ignores ! comments'],
    ['# This is a comment', '', 'ignores # comments'],
    ['', '', 'empty string'],
    ['*', '', 'lone wildcard'],
  ];
  for (const [input, expected, name] of cases) {
    test(name, () => assert.equal(sanitizeDomain(input), expected));
  }

  test('tolerates null and undefined', () => {
    assert.equal(sanitizeDomain(null), '');
    assert.equal(sanitizeDomain(undefined), '');
  });
});

describe('normalizeWhitelist', () => {
  test('dedupes, strips comments and ports, sorts', () => {
    const list = normalizeWhitelist([
      'example.com',
      '  ! note',
      '  YOUTUBE.COM  ',
      'example.com',
      '# note 2',
      '*.github.com',
      'localhost:3000',
    ]);
    assert.deepEqual(list, ['*.github.com', 'example.com', 'localhost', 'youtube.com']);
  });

  test('returns [] for non-arrays', () => {
    assert.deepEqual(normalizeWhitelist(undefined), []);
    assert.deepEqual(normalizeWhitelist('example.com'), []);
  });

  test('serializeDomains joins with newlines', () => {
    assert.equal(serializeDomains(['b.com', 'a.com', 'a.com']), 'a.com\nb.com');
  });
});

describe('isWhitelisted', () => {
  const list = normalizeWhitelist(['example.com', '*.github.com', 'localhost:3000']);

  const matches = [
    ['example.com', 'exact domain'],
    ['www.example.com', 'www alias'],
    ['EXAMPLE.COM', 'case-insensitive'],
    ['github.com', 'wildcard matches apex'],
    ['gist.github.com', 'wildcard matches subdomain'],
    ['a.b.github.com', 'wildcard matches nested subdomain'],
    ['localhost', 'localhost'],
    ['localhost:3000', 'host with port'],
    ['https://example.com/some/path', 'full URL'],
  ];
  for (const [host, name] of matches) {
    test(`matches: ${name}`, () => assert.equal(isWhitelisted(host, list), true));
  }

  const misses = [
    ['sub.example.com', 'subdomain without a wildcard rule'],
    ['notgithub.com', 'lookalike of a wildcard domain'],
    ['example.com.evil.org', 'listed domain used as a prefix'],
    ['other.com', 'unlisted site'],
    ['', 'empty host'],
  ];
  for (const [host, name] of misses) {
    test(`no match: ${name}`, () => assert.equal(isWhitelisted(host, list), false));
  }

  test('www. rule also matches the bare domain', () => {
    assert.equal(isWhitelisted('example.org', ['www.example.org']), true);
  });

  test('picks up a new list (matcher cache is per list)', () => {
    assert.equal(isWhitelisted('a.com', ['a.com']), true);
    assert.equal(isWhitelisted('a.com', ['b.com']), false);
  });
});

describe('domainToMatchPatterns', () => {
  test('plain domain gets bare and www patterns', () => {
    assert.deepEqual(domainToMatchPatterns('example.com'), ['*://example.com/*', '*://www.example.com/*']);
  });

  test('www. domain is treated like the bare domain', () => {
    assert.deepEqual(domainToMatchPatterns('www.example.com'), ['*://example.com/*', '*://www.example.com/*']);
  });

  test('wildcard gets subdomain and apex patterns', () => {
    assert.deepEqual(domainToMatchPatterns('*.google.com'), ['*://*.google.com/*', '*://google.com/*']);
  });

  test('IP address gets no www. pattern', () => {
    assert.deepEqual(domainToMatchPatterns('127.0.0.1'), ['*://127.0.0.1/*']);
  });

  test('IDN host is converted to punycode', () => {
    assert.ok(domainToMatchPatterns('bücher.de').includes('*://xn--bcher-kva.de/*'));
  });

  test('invalid hosts produce no pattern (one bad pattern breaks registerContentScripts)', () => {
    assert.deepEqual(domainToMatchPatterns('bad host!.com'), []);
    assert.deepEqual(domainToMatchPatterns('# comment'), []);
  });
});

describe('whitelistToExcludeMatches', () => {
  test('expands, dedupes and sorts every rule', () => {
    assert.deepEqual(whitelistToExcludeMatches(['example.com', 'www.example.com', '*.google.com']), [
      '*://*.google.com/*',
      '*://example.com/*',
      '*://google.com/*',
      '*://www.example.com/*',
    ]);
  });

  test('every pattern is a valid Chrome match pattern', () => {
    const patterns = whitelistToExcludeMatches(['a.com', '*.b.org', '10.0.0.1', 'bücher.de', 'bad host!.com']);
    for (const p of patterns) assert.match(p, /^\*:\/\/(\*\.)?[a-z0-9.-]+\/\*$/);
  });
});

describe('buildMatcher', () => {
  test('splits exact hosts and wildcard apexes', () => {
    const { exact, wildcards } = buildMatcher(['*.github.com', 'www.example.com']);
    assert.deepEqual(new Set(exact), new Set(['github.com', 'example.com', 'www.example.com']));
    assert.deepEqual(wildcards, ['github.com']);
  });

  test('output is plain JSON (it is passed to scripting.executeScript)', () => {
    const m = buildMatcher(['a.com', '*.b.com']);
    assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
  });
});

describe('isRestrictedUrl', () => {
  const restricted = [
    'chrome://settings',
    'edge://extensions',
    'about:blank',
    'chrome-search://local-ntp/',
    'moz-extension://abc/popup.html',
    'view-source:https://example.com',
    'https://chromewebstore.google.com/detail/x',
    'https://chrome.google.com/webstore',
    'https://chrome.google.com/webstore/devconsole/',
    'https://microsoftedge.microsoft.com/addons/detail/x',
    'https://addons.mozilla.org/firefox/',
    'https://sync.services.mozilla.com/',
  ];
  for (const url of restricted) {
    test(`restricted: ${url}`, () => assert.equal(isRestrictedUrl(url), true));
  }

  const allowed = [
    'https://google.com',
    'https://chrome.google.com/intl/en/chrome/',
    'https://chrome.google.com/webstorefront',
    'http://localhost:3000/',
    'file:///home/user/page.html',
  ];
  for (const url of allowed) {
    test(`allowed: ${url}`, () => assert.equal(isRestrictedUrl(url), false));
  }

  test('empty or unparsable URLs count as restricted', () => {
    assert.equal(isRestrictedUrl(''), true);
    assert.equal(isRestrictedUrl(undefined), true);
    assert.equal(isRestrictedUrl('not a url'), true);
  });
});
