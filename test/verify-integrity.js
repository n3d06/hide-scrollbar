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
  const emptyMsgs = enKeys.filter((k) => dict[k] && !String(dict[k].message || '').trim());
  assert(emptyMsgs.length === 0, `No empty messages in [${lang}] (Empty: ${emptyMsgs.join(', ') || 'none'})`);
  const badPlaceholders = enKeys.filter(
    (k) =>
      dict[k] &&
      JSON.stringify(Object.keys(en[k].placeholders || {})) !== JSON.stringify(Object.keys(dict[k].placeholders || {})),
  );
  assert(
    badPlaceholders.length === 0,
    `Placeholders match EN in [${lang}] (Mismatch: ${badPlaceholders.join(', ') || 'none'})`,
  );
  if (lang !== 'en') {
    const untranslated = enKeys.filter(
      (k) =>
        dict[k] &&
        dict[k].message === en[k].message &&
        !['extName', 'buyMeACoffee'].includes(k) &&
        /[a-z]{4,}/i.test(en[k].message) &&
        en[k].message.includes(' '),
    );
    assert(
      untranslated.length === 0,
      `No untranslated (English) messages in [${lang}] (Found: ${untranslated.join(', ') || 'none'})`,
    );
  }
  const missing = enKeys.filter((k) => !dict[k]);
  assert(missing.length === 0, `All EN keys present in [${lang}] (Missing: ${missing.join(', ') || 'none'})`);
});
console.log(`✅ All ${allDirs.length} locales passed verification with 100% key completeness!`);

// 2a. Every __MSG_key__ referenced in the manifests must exist in en/messages.json
['manifest.json', 'manifest.firefox.json'].forEach((file) => {
  const raw = fs.readFileSync(path.join(extRoot, file), 'utf8');
  for (const m of raw.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) {
    assert(enKeys.includes(m[1]), `${file} references __MSG_${m[1]}__ which exists in messages.json`);
  }
});

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
        if (m[1].startsWith('@@')) continue; // predefined Chrome i18n messages
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

// 3a. Page scripts look up elements without null checks, so every id they use must exist
[
  ['features/popup.js', 'popup.html'],
  ['features/settings.js', 'options.html'],
].forEach(([script, page]) => {
  const code = fs.readFileSync(path.join(extRoot, script), 'utf8');
  const html = fs.readFileSync(path.join(extRoot, page), 'utf8');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of code.matchAll(/(?:\$|getElementById)\(\s*'([^']+)'/g)) {
    assert(ids.has(m[1]), `${script} uses #${m[1]}, which exists in ${page}`);
  }
});

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

// 3c. CSS injected via registerContentScripts and toolbar icons must exist
require('../src/shared/constants.js');
const { CSS_FILE, ICONS } = global.ScrollHideConstants;
assert(fs.existsSync(path.join(extRoot, CSS_FILE)), `Injected CSS exists: ${CSS_FILE}`);
Object.entries(ICONS).forEach(([state, sizes]) => {
  Object.values(sizes).forEach((iconPath) => {
    assert(fs.existsSync(path.join(extRoot, iconPath)), `Toolbar icon (${state}) exists: ${iconPath}`);
  });
});

// 3d. package.json and manifest.json must carry the same version ("2.2" == "2.2.0")
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
const trimVersion = (v) => String(v).replace(/(\.0)+$/, '');
assert(
  trimVersion(pkg.version) === trimVersion(manifest.version),
  `package.json version (${pkg.version}) matches manifest.json (${manifest.version})`,
);

// 4. Firefox manifest override
console.log('\n--- 4. Testing Firefox manifest override ---');
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
