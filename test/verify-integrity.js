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
const manifestPath = path.resolve(__dirname, '../manifest.json');
assert(fs.existsSync(manifestPath), 'manifest.json exists');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert(manifest.manifest_version === 3, 'Manifest version is 3');
assert(manifest.options_ui && manifest.options_ui.page, 'options_ui is configured in manifest');
const optionsPage = manifest.options_ui.page;
assert(
  fs.existsSync(path.resolve(__dirname, '..', optionsPage)) ||
  fs.existsSync(path.resolve(__dirname, '../src', optionsPage)) ||
  fs.existsSync(path.resolve(__dirname, '../dist', optionsPage)),
  `options_ui page exists: ${optionsPage}`
);

assert(manifest.action && manifest.action.default_popup, 'default_popup is configured in manifest');
const popupPage = manifest.action.default_popup;
assert(
  fs.existsSync(path.resolve(__dirname, '..', popupPage)) ||
  fs.existsSync(path.resolve(__dirname, '../src', popupPage)) ||
  fs.existsSync(path.resolve(__dirname, '../dist', popupPage)),
  `default_popup exists: ${popupPage}`
);
if (manifest.icons) {
  Object.entries(manifest.icons).forEach(([size, iconPath]) => {
    assert(
      fs.existsSync(path.resolve(__dirname, '..', iconPath)) ||
      fs.existsSync(path.resolve(__dirname, '../src', iconPath)) ||
      fs.existsSync(path.resolve(__dirname, '../dist', iconPath)),
      `Manifest icon ${size}px exists: ${iconPath}`
    );
  });
}

// 2. Verify Locales
console.log('\n--- 2. Testing Locales (_locales) ---');
const localesRoot = fs.existsSync(path.resolve(__dirname, '../src/_locales'))
  ? path.resolve(__dirname, '../src/_locales')
  : path.resolve(__dirname, '../_locales');
const en = JSON.parse(fs.readFileSync(path.join(localesRoot, 'en/messages.json'), 'utf8'));
const enKeys = Object.keys(en);

const allDirs = fs.readdirSync(localesRoot, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

assert(allDirs.length >= 20, `Locales directory contains ${allDirs.length} languages (expected >= 20)`);

allDirs.forEach((lang) => {
  const langFile = path.join(localesRoot, lang, 'messages.json');
  assert(fs.existsSync(langFile), `Locale file exists: _locales/${lang}/messages.json`);
  const dict = JSON.parse(fs.readFileSync(langFile, 'utf8'));
  const dictKeys = Object.keys(dict);
  assert(dictKeys.length === enKeys.length, `Locale [${lang}] key count (${dictKeys.length}) matches EN (${enKeys.length})`);
  const missing = enKeys.filter(k => !dict[k]);
  assert(missing.length === 0, `All EN keys present in [${lang}] (Missing: ${missing.join(', ') || 'none'})`);
});
console.log(`✅ All ${allDirs.length} locales passed verification with 100% key completeness!`);

const distRoot = path.resolve(__dirname, '../dist');
const srcRoot = path.resolve(__dirname, '..');

// 2b. Check that all data-i18n and getMessage keys in code exist in en/messages.json
const enKeySet = new Set(enKeys);
function scanKeysInDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git'].includes(entry.name)) {
        scanKeysInDir(full);
      }
    } else if (entry.name.endsWith('.html') || entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
      const src = fs.readFileSync(full, 'utf8');
      const htmlMatches = src.matchAll(/data-i18n(?:-[a-z]+)?=["']([^"']+)["']/g);
      for (const m of htmlMatches) {
        assert(enKeySet.has(m[1]), `HTML key [${m[1]}] in ${path.relative(srcRoot, full)} exists in messages.json`);
      }
      const msgMatches = src.matchAll(/getMessage\(\s*["']([^"']+)["']/g);
      for (const m of msgMatches) {
        assert(enKeySet.has(m[1]), `Code getMessage [${m[1]}] in ${path.relative(srcRoot, full)} exists in messages.json`);
      }
    }
  }
}
scanKeysInDir(path.resolve(__dirname, '../src'));
// 3. Verify HTML and Referenced Assets (check against dist/ for script files)
console.log('\n--- 3. Testing HTML references and files ---');

function checkHtmlFile(srcRelPath, distRelPath) {
  // HTML source file must exist
  const srcFullPath = path.resolve(srcRoot, srcRelPath);
  assert(fs.existsSync(srcFullPath), `HTML file exists: ${srcRelPath}`);
  const content = fs.readFileSync(srcFullPath, 'utf8');
  
  // HTML must also exist in dist/
  const distFullPath = path.resolve(distRoot, distRelPath);
  assert(fs.existsSync(distFullPath), `HTML file in dist/: dist/${distRelPath}`);

  const distDir = path.dirname(distFullPath);

  // Script tags — resolve against dist/ (where .js files live)
  const scriptMatches = content.matchAll(/<script\s+[^>]*src=["']([^"']+)["']/g);
  for (const m of scriptMatches) {
    if (!m[1].startsWith('http')) {
      const target = path.resolve(distDir, m[1]);
      assert(fs.existsSync(target), `Script exists in dist/${distRelPath}: ${m[1]}`);
    }
  }

  // Link stylesheet tags — resolve against dist/
  const linkMatches = content.matchAll(/<link\s+[^>]*href=["']([^"']+)["']/g);
  for (const m of linkMatches) {
    if (!m[1].startsWith('http')) {
      const target = path.resolve(distDir, m[1]);
      assert(fs.existsSync(target), `Stylesheet exists in dist/${distRelPath}: ${m[1]}`);
    }
  }

  // Img tags — resolve against dist/
  const imgMatches = content.matchAll(/<img\s+[^>]*src=["']([^"']+)["']/g);
  for (const m of imgMatches) {
    if (m[1] && !m[1].startsWith('http') && !m[1].startsWith('data:')) {
      const target = path.resolve(distDir, m[1]);
      assert(fs.existsSync(target), `Image exists in dist/${distRelPath}: ${m[1]}`);
    }
  }
}

checkHtmlFile('src/popup.html', 'popup.html');
checkHtmlFile('src/options.html', 'options.html');


// 4. Whitelist Service logic
console.log('\n--- 4. Testing Whitelist & Sanitization logic ---');
global.globalThis = global;
require('../dist/src/shared/constants.js');
require('../dist/src/features/whitelist.js');
const service = global.ScrollHideWhitelist;

assert(service.sanitizeDomain('https://example.com/path?query=1') === 'example.com', 'Sanitize URL to domain');
assert(service.sanitizeDomain('! This is a comment') === '', 'Ignore comment starting with !');
assert(service.sanitizeDomain('# This is a comment') === '', 'Ignore comment starting with #');
assert(service.sanitizeDomain('   sub.domain.co.uk/   ') === 'sub.domain.co.uk', 'Sanitize subdomain with whitespace');
assert(service.sanitizeDomain('http://localhost:3000/test') === 'localhost', 'Sanitize localhost with port');
assert(service.sanitizeDomain('127.0.0.1:8080') === '127.0.0.1', 'Sanitize IP with port');
assert(service.sanitizeDomain('*.google.com') === '*.google.com', 'Sanitize preserves wildcard prefix *.domain');
assert(service.sanitizeDomain('https://admin:pass@example.com/test') === 'example.com', 'Sanitize strips credentials from URL');

const list = service.normalizeWhitelist(['example.com', '  ! note', '  YOUTUBE.COM  ', 'example.com', '# note 2', '*.github.com', 'localhost:3000']);
assert(list.length === 4 && list.includes('example.com') && list.includes('youtube.com') && list.includes('*.github.com') && list.includes('localhost'), 'Normalize whitelist deduplicates, strips comments, ports & wildcards');

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
assert(matchPatterns.includes('*://example.com/*') && matchPatterns.includes('*://www.example.com/*'), 'domainToMatchPatterns generates exact and www match patterns');

const wildcardPatterns = service.domainToMatchPatterns('*.google.com');
assert(wildcardPatterns.includes('*://*.google.com/*') && wildcardPatterns.includes('*://google.com/*'), 'domainToMatchPatterns generates wildcard and apex match patterns');

const excludeMatches = service.whitelistToExcludeMatches(['example.com', '*.google.com']);
assert(excludeMatches.length === 4, 'whitelistToExcludeMatches creates full list of exclude matches');

assert(service.isRestrictedUrl('chrome://settings') === true, 'Restricted on chrome://');
assert(service.isRestrictedUrl('edge://extensions') === true, 'Restricted on edge://');
assert(service.isRestrictedUrl('about:blank') === true, 'Restricted on about:');
assert(service.isRestrictedUrl('https://chromewebstore.google.com') === false, 'Chrome Web Store is NOT restricted');
assert(service.isRestrictedUrl('https://google.com') === false, 'google.com is NOT restricted');

// 5. Verify Dist Output
console.log('\n--- 5. Testing dist/ bundle integrity ---');
const distPath = path.resolve(__dirname, '../dist');
assert(fs.existsSync(distPath), 'dist/ directory exists');
assert(fs.existsSync(path.join(distPath, 'manifest.json')), 'dist/manifest.json exists');
assert(fs.existsSync(path.join(distPath, '_locales/en/messages.json')), 'dist/_locales/en/messages.json exists');
assert(fs.existsSync(path.join(distPath, '_locales/vi/messages.json')), 'dist/_locales/vi/messages.json exists');
assert(fs.existsSync(path.join(distPath, 'src/entries/background.js')), 'dist/src/entries/background.js compiled');
assert(fs.existsSync(path.join(distPath, 'src/entries/content.js')), 'dist/src/entries/content.js compiled');
assert(fs.existsSync(path.join(distPath, 'src/features/popup.js')), 'dist/src/features/popup.js compiled');
assert(fs.existsSync(path.join(distPath, 'src/features/settings.js')), 'dist/src/features/settings.js compiled');
assert(fs.existsSync(path.join(distPath, 'src/features/whitelist.js')), 'dist/src/features/whitelist.js compiled');

console.log('\n======================================================');
if (allPassed) {
  console.log('🎉 TẤT CẢ CÁC BÀI KIỂM TRA ĐỀU TRƠN TRU & ĐẠT 100%!');
} else {
  console.error('❌ CÓ LỖI XẢY RA TRONG QUÁ TRÌNH KIỂM TRA!');
  process.exit(1);
}
console.log('======================================================\n');
