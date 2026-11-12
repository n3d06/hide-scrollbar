const fs = require('fs');
const path = require('path');

let allPassed = true;

function assert(condition, message) {
  if (!condition) {
    console.error('❌ FAIL:', message);
    allPassed = false;
  } else {
    console.log('✅ PASS:', message);
  }
}

// 1. Verify Manifest
console.log('\n--- 1. Testing manifest.json integrity ---');
const extRoot = path.resolve(__dirname, '../src');
const manifestPath = path.join(extRoot, 'manifest.json');
assert(fs.existsSync(manifestPath), 'src/manifest.json exists');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert(manifest.manifest_version === 3, 'Manifest version is 3');
assert(manifest.options_ui && manifest.options_ui.page, 'options_ui is configured in manifest');
const optionsPage = manifest.options_ui.page;
assert(fs.existsSync(path.join(extRoot, optionsPage)), `options_ui page exists: ${optionsPage}`);

assert(manifest.action && manifest.action.default_popup, 'default_popup is configured in manifest');
const popupPage = manifest.action.default_popup;
assert(fs.existsSync(path.join(extRoot, popupPage)), `default_popup exists: ${popupPage}`);
if (manifest.icons) {
  Object.entries(manifest.icons).forEach(([size, iconPath]) => {
    assert(fs.existsSync(path.join(extRoot, iconPath)), `Manifest icon ${size}px exists: ${iconPath}`);
  });
}

// 2. Verify Locales
console.log('\n--- 2. Testing Locales (_locales) ---');
const localesRoot = path.join(extRoot, '_locales');
const en = JSON.parse(fs.readFileSync(path.join(localesRoot, 'en/messages.json'), 'utf8'));
const enKeys = Object.keys(en);

const allDirs = fs
  .readdirSync(localesRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

assert(allDirs.length >= 20, `Locales directory contains ${allDirs.length} languages (expected >= 20)`);

allDirs.forEach((lang) => {
  const langFile = path.join(localesRoot, lang, 'messages.json');
  assert(fs.existsSync(langFile), `Locale file exists: _locales/${lang}/messages.json`);
  const dict = JSON.parse(fs.readFileSync(langFile, 'utf8'));
  const dictKeys = Object.keys(dict);
  assert(
    dictKeys.length === enKeys.length,
    `Locale [${lang}] key count (${dictKeys.length}) matches EN (${enKeys.length})`,
  );
  const missing = enKeys.filter((k) => !dict[k]);
  assert(missing.length === 0, `All EN keys present in [${lang}] (Missing: ${missing.join(', ') || 'none'})`);
});
console.log(`✅ All ${allDirs.length} locales passed verification with 100% key completeness!`);

const srcRoot = path.resolve(__dirname, '..');

// 2b. Check that all data-i18n and getMessage keys in code exist in en/messages.json
const enKeySet = new Set(enKeys);
function scanKeysInDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.git'].includes(entry.name)) {
        scanKeysInDir(full);
      }
    } else if (entry.name.endsWith('.html') || entry.name.endsWith('.js')) {
      const src = fs.readFileSync(full, 'utf8');
      const htmlMatches = src.matchAll(/data-i18n(?:-[a-z]+)?=["']([^"']+)["']/g);
      for (const m of htmlMatches) {
        assert(enKeySet.has(m[1]), `HTML key [${m[1]}] in ${path.relative(srcRoot, full)} exists in messages.json`);
      }
      const msgMatches = src.matchAll(/getMessage\(\s*["']([^"']+)["']/g);
      for (const m of msgMatches) {
        assert(
          enKeySet.has(m[1]),
          `Code getMessage [${m[1]}] in ${path.relative(srcRoot, full)} exists in messages.json`,
        );
      }
    }
  }
}
scanKeysInDir(path.resolve(__dirname, '../src'));
// 3. Verify HTML and referenced files
console.log('\n--- 3. Testing HTML references and files ---');

function checkHtmlFile(relPath) {
  const fullPath = path.join(extRoot, relPath);
  assert(fs.existsSync(fullPath), `HTML file exists: src/${relPath}`);
  const content = fs.readFileSync(fullPath, 'utf8');
  const dir = path.dirname(fullPath);
  const patterns = [
    [/<script\s+[^>]*src=["']([^"']+)["']/g, 'Script'],
    [/<link\s+[^>]*href=["']([^"']+)["']/g, 'Stylesheet'],
    [/<img\s+[^>]*src=["']([^"']+)["']/g, 'Image'],
  ];
  for (const [re, label] of patterns) {
    for (const m of content.matchAll(re)) {
      if (m[1] && !m[1].startsWith('http') && !m[1].startsWith('data:')) {
        assert(fs.existsSync(path.resolve(dir, m[1])), `${label} exists for ${relPath}: ${m[1]}`);
      }
    }
  }
}

checkHtmlFile('popup.html');
checkHtmlFile('options.html');

// 3b. Verify files referenced by manifest
const manifestFiles = [
  manifest.background.service_worker,
  ...(manifest.content_scripts || []).flatMap((cs) => cs.js || []),
];
manifestFiles.forEach((f) => assert(fs.existsSync(path.join(extRoot, f)), `Manifest script exists: ${f}`));

// 3b2. Shared scripts must be wrapped in an IIFE: classic scripts share one global scope,
// so a top-level const in one file collides with the same name in another (SyntaxError)
['shared', 'features'].forEach((dir) => {
  fs.readdirSync(path.join(extRoot, dir))
    .filter((f) => f.endsWith('.js'))
    .forEach((f) => {
      const code = fs.readFileSync(path.join(extRoot, dir, f), 'utf8').trimStart();
      assert(code.startsWith('(() => {'), `${dir}/${f} is wrapped in an IIFE`);
    });
});

// 3c. CSS injected via registerContentScripts must exist
require('../src/shared/constants.js');
assert(
  fs.existsSync(path.join(extRoot, global.ScrollHideConstants.CSS_FILE)),
  `Injected CSS exists: ${global.ScrollHideConstants.CSS_FILE}`,
);

// 4. Whitelist Service logic
console.log('\n--- 4. Testing Whitelist & Sanitization logic ---');
global.globalThis = global;
require('../src/shared/constants.js');
require('../src/features/whitelist.js');
const service = global.ScrollHideWhitelist;

assert(service.sanitizeDomain('https://example.com/path?query=1') === 'example.com', 'Sanitize URL to domain');
assert(service.sanitizeDomain('! This is a comment') === '', 'Ignore comment starting with !');
assert(service.sanitizeDomain('# This is a comment') === '', 'Ignore comment starting with #');
assert(service.sanitizeDomain('   sub.domain.co.uk/   ') === 'sub.domain.co.uk', 'Sanitize subdomain with whitespace');
assert(service.sanitizeDomain('http://localhost:3000/test') === 'localhost', 'Sanitize localhost with port');
assert(service.sanitizeDomain('127.0.0.1:8080') === '127.0.0.1', 'Sanitize IP with port');
assert(service.sanitizeDomain('*.google.com') === '*.google.com', 'Sanitize preserves wildcard prefix *.domain');
assert(
  service.sanitizeDomain('https://admin:pass@example.com/test') === 'example.com',
  'Sanitize strips credentials from URL',
);

const list = service.normalizeWhitelist([
  'example.com',
  '  ! note',
  '  YOUTUBE.COM  ',
  'example.com',
  '# note 2',
  '*.github.com',
  'localhost:3000',
]);
assert(
  list.length === 4 &&
    list.includes('example.com') &&
    list.includes('youtube.com') &&
    list.includes('*.github.com') &&
    list.includes('localhost'),
  'Normalize whitelist deduplicates, strips comments, ports & wildcards',
);

assert(service.isWhitelisted('example.com', list) === true, 'isWhitelisted finds domain');
assert(service.isWhitelisted('www.example.com', list) === true, 'isWhitelisted finds www alias');
assert(service.isWhitelisted('sub.example.com', list) === false, 'Subdomain is NOT matched without wildcard rule');
assert(service.isWhitelisted('github.com', list) === true, 'Wildcard matches apex domain');
assert(service.isWhitelisted('gist.github.com', list) === true, 'isWhitelisted matches subdomain of wildcard domain');
assert(service.isWhitelisted('localhost', list) === true, 'isWhitelisted finds localhost');
assert(service.isWhitelisted('localhost:3000', list) === true, 'isWhitelisted matches localhost with port');
assert(service.isWhitelisted('https://example.com/some/path', list) === true, 'isWhitelisted matches full URL');
assert(service.isWhitelisted('other.com', list) === false, 'isWhitelisted returns false for non-listed site');

const matchPatterns = service.domainToMatchPatterns('example.com');
assert(
  matchPatterns.includes('*://example.com/*') && matchPatterns.includes('*://www.example.com/*'),
  'domainToMatchPatterns generates exact and www match patterns',
);

const wildcardPatterns = service.domainToMatchPatterns('*.google.com');
assert(
  wildcardPatterns.includes('*://*.google.com/*') && wildcardPatterns.includes('*://google.com/*'),
  'domainToMatchPatterns generates wildcard and apex match patterns',
);

assert(service.isWhitelisted('a.b.github.com', list) === true, 'Wildcard matches nested subdomain');
assert(service.isWhitelisted('notgithub.com', list) === false, 'Wildcard does not match lookalike domain');
assert(
  JSON.stringify(service.domainToMatchPatterns('127.0.0.1')) === '["*://127.0.0.1/*"]',
  'IP address gets no www. pattern',
);
assert(service.domainToMatchPatterns('bad host!.com').length === 0, 'Invalid host produces no match pattern');
assert(service.domainToMatchPatterns('bücher.de').includes('*://xn--bcher-kva.de/*'), 'IDN host converted to punycode');
const matcher = service.buildMatcher(['*.github.com', 'www.example.com']);
assert(
  matcher.exact.includes('example.com') &&
    matcher.exact.includes('www.example.com') &&
    matcher.wildcards[0] === 'github.com',
  'buildMatcher splits exact & wildcard',
);

const excludeMatches = service.whitelistToExcludeMatches(['example.com', '*.google.com']);
assert(excludeMatches.length === 4, 'whitelistToExcludeMatches creates full list of exclude matches');

assert(service.isRestrictedUrl('chrome://settings') === true, 'Restricted on chrome://');
assert(service.isRestrictedUrl('edge://extensions') === true, 'Restricted on edge://');
assert(service.isRestrictedUrl('about:blank') === true, 'Restricted on about:');
assert(service.isRestrictedUrl('https://chromewebstore.google.com') === false, 'Chrome Web Store is NOT restricted');
assert(service.isRestrictedUrl('https://google.com') === false, 'google.com is NOT restricted');
assert(service.isRestrictedUrl('moz-extension://abc/popup.html') === true, 'Restricted on moz-extension://');
assert(service.isRestrictedUrl('https://addons.mozilla.org/firefox/') === true, 'Restricted on addons.mozilla.org');

// 5. Firefox manifest override
console.log('\n--- 5. Testing Firefox manifest override ---');
const ffPath = path.join(extRoot, 'manifest.firefox.json');
assert(fs.existsSync(ffPath), 'src/manifest.firefox.json exists');
const ff = JSON.parse(fs.readFileSync(ffPath, 'utf8'));
assert(ff.browser_specific_settings?.gecko?.id, 'Firefox manifest has a gecko id');
assert(Array.isArray(ff.background?.scripts) && ff.background.scripts.length > 0, 'Firefox background.scripts is set');
(ff.background?.scripts || []).forEach((s) => {
  assert(fs.existsSync(path.join(extRoot, s)), `Firefox background script exists: ${s}`);
});
assert(
  ff.background?.scripts?.at(-1) === manifest.background.service_worker,
  'Firefox loads the same background entry as Chrome, last',
);

console.log('\n======================================================');
if (allPassed) {
  console.log('🎉 TẤT CẢ CÁC BÀI KIỂM TRA ĐỀU TRƠN TRU & ĐẠT 100%!');
} else {
  console.error('❌ CÓ LỖI XẢY RA TRONG QUÁ TRÌNH KIỂM TRA!');
  process.exit(1);
}
console.log('======================================================\n');
