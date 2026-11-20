const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { frameGlobals } = require('../helpers/fake-browser.js');

require('../../src/shared/constants.js');
require('../../src/features/whitelist.js');

const {
  applyInFrame,
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
    ['https://*.google.com/x', '*.google.com', 'keeps a wildcard after a scheme'],
    ['example.com/login@other', 'example.com', 'an @ in the path is not a credential'],
    ['git+ssh://example.com', 'example.com', 'scheme with + and digits'],
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

describe('shouldHideOn', () => {
  const on = { scrollbarHidden: true, whitelist: ['example.com'] };

  test('hides on a normal page', () => assert.equal(shouldHideOn('https://other.com/', on), true));
  test('not when hiding is off', () =>
    assert.equal(shouldHideOn('https://other.com/', { ...on, scrollbarHidden: false }), false));
  test('not on a whitelisted page', () => assert.equal(shouldHideOn('https://www.example.com/a', on), false));
  test('not on a restricted page', () => assert.equal(shouldHideOn('chrome://settings', on), false));
  test('not without a URL', () => assert.equal(shouldHideOn(undefined, on), false));
});

describe('describeUrl', () => {
  test('web page: hostname, can be whitelisted', () => {
    assert.deepEqual(describeUrl('https://www.example.com/a?b'), {
      label: 'www.example.com',
      host: 'www.example.com',
      restricted: false,
    });
  });

  test('browser page: scheme and host, restricted', () => {
    assert.deepEqual(describeUrl('chrome://settings/privacy'), {
      label: 'chrome://settings',
      host: '',
      restricted: true,
    });
  });

  test('about: page keeps the full URL', () => {
    assert.equal(describeUrl('about:blank').label, 'about:blank');
  });

  test('local file shows the file name only, cannot be whitelisted', () => {
    assert.deepEqual(describeUrl('file:///home/me/secret/report.html'), {
      label: 'file://.../report.html',
      host: '',
      restricted: false,
    });
    assert.equal(describeUrl('file:///').label, 'file://local-file');
  });

  test('store page has a host but is restricted', () => {
    const page = describeUrl('https://chromewebstore.google.com/detail/x');
    assert.equal(page.restricted, true);
  });

  test('no URL (tab without permission or new tab)', () => {
    assert.deepEqual(describeUrl(''), { label: '', host: '', restricted: true });
    assert.deepEqual(describeUrl(undefined), { label: '', host: '', restricted: true });
  });
});

describe('parseWhitelistFile', () => {
  test('plain text, one domain per line', () => {
    assert.deepEqual(parseWhitelistFile('a.com\n\n  b.com  \r\n'), ['a.com', 'b.com']);
  });

  test('JSON array', () => {
    assert.deepEqual(parseWhitelistFile('["a.com", "b.com"]'), ['a.com', 'b.com']);
  });

  test('settings backup object', () => {
    assert.deepEqual(parseWhitelistFile('{"scrollbarHidden": true, "whitelist": ["a.com"]}'), ['a.com']);
  });

  test('JSON object without a whitelist is rejected', () => {
    assert.equal(parseWhitelistFile('{"foo": 1}'), null);
  });

  test('text that only looks like JSON is read as lines', () => {
    assert.deepEqual(parseWhitelistFile('[comment\na.com'), ['[comment', 'a.com']);
  });

  test('empty file gives no lines', () => {
    assert.deepEqual(parseWhitelistFile(''), []);
    assert.deepEqual(parseWhitelistFile('   \n  '), []);
  });
});

describe('internationalized domains (IDN)', () => {
  // Browsers report hostnames in punycode; users type the Unicode form
  test('a Unicode rule matches the punycode hostname', () => {
    assert.equal(isWhitelisted('xn--bcher-kva.de', ['bücher.de']), true);
    assert.equal(isWhitelisted('www.xn--bcher-kva.de', ['bücher.de']), true);
    assert.equal(isWhitelisted('shop.xn--bcher-kva.de', ['*.bücher.de']), true);
  });

  test('a Unicode host matches too', () => {
    assert.equal(isWhitelisted('bücher.de', ['bücher.de']), true);
    assert.equal(isWhitelisted('https://bücher.de/x', ['xn--bcher-kva.de']), true);
  });

  test('buildMatcher stores ASCII hosts (what executeScript frames compare against)', () => {
    assert.deepEqual(buildMatcher(['*.bücher.de']), { exact: ['xn--bcher-kva.de'], wildcards: ['xn--bcher-kva.de'] });
  });

  test('popup, open tabs and new page loads agree', () => {
    const url = 'https://xn--bcher-kva.de/';
    const state = { scrollbarHidden: true, whitelist: ['bücher.de'] };
    assert.equal(shouldHideOn(url, state), false);
    assert.ok(whitelistToExcludeMatches(state.whitelist).includes('*://xn--bcher-kva.de/*'));
  });
});

describe('applyInFrame', () => {
  const NAMES = { offAttr: 'data-scrollhide-off', marker: '--scrollhide-css', legacyStyleId: 'hide-scrollbar-style' };

  // Compile the function on its own in an empty context, as executeScript does:
  // any reference to an outside variable fails with a ReferenceError.
  const runInFrame = (frame, hidden, whitelist) => {
    const context = vm.createContext(frameGlobals(frame, NAMES));
    const isolated = vm.runInContext(`(${applyInFrame})`, context);
    return isolated(hidden, buildMatcher(whitelist), NAMES);
  };
  const newFrame = (hostname, hasCss = true) => ({ hostname, hasCss, off: false });

  test('is self-contained', () => {
    assert.doesNotThrow(() => runInFrame(newFrame('a.com'), true, ['*.b.com']));
  });

  test('turns hiding on or off by the frame host', () => {
    const shown = newFrame('a.com');
    runInFrame(shown, true, ['a.com']);
    assert.equal(shown.off, true);
    const hidden = newFrame('b.com');
    runInFrame(hidden, true, ['a.com']);
    assert.equal(hidden.off, false);
    const globalOff = newFrame('b.com');
    runInFrame(globalOff, false, []);
    assert.equal(globalOff.off, true);
  });

  test('asks for the stylesheet only when it should hide and the marker is missing', () => {
    assert.equal(runInFrame(newFrame('a.com', false), true, []), true);
    assert.equal(runInFrame(newFrame('a.com', true), true, []), false);
    assert.equal(runInFrame(newFrame('a.com', false), false, []), false);
    assert.equal(runInFrame(newFrame('a.com', false), true, ['a.com']), false);
  });

  test('frames without a document element are left alone', () => {
    const context = vm.createContext({ document: { documentElement: null } });
    assert.equal(vm.runInContext(`(${applyInFrame})`, context)(true, buildMatcher([]), NAMES), false);
  });

  // The frame code carries its own copy of the matching rule; it must never drift from isWhitelisted
  test('agrees with isWhitelisted on every host', () => {
    const whitelist = ['example.com', 'www.site.org', '*.github.com', 'localhost', '10.0.0.1', 'bücher.de', '*.co.uk'];
    const hosts = [
      'example.com',
      'www.example.com',
      'sub.example.com',
      'example.com.evil.org',
      'notexample.com',
      'site.org',
      'www.site.org',
      'github.com',
      'gist.github.com',
      'a.b.github.com',
      'notgithub.com',
      'localhost',
      '10.0.0.1',
      '10.0.0.10',
      'xn--bcher-kva.de',
      'www.xn--bcher-kva.de',
      'bbc.co.uk',
      'co.uk',
      '',
    ];
    for (const host of hosts) {
      const frame = newFrame(host);
      runInFrame(frame, true, whitelist);
      assert.equal(frame.off, isWhitelisted(host, whitelist), `host "${host}"`);
    }
  });
});
