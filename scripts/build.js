// Packages src/ for each browser: dist/chrome and dist/firefox.
// No bundling — src/ stays loadable in Chrome as-is. The only per-browser
// difference is the manifest: manifest.json + manifest.<target>.json override.
// Usage: node scripts/build.js [chrome|firefox ...]
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');
const TARGETS = ['chrome', 'firefox'];

// Top-level keys in the override replace the base value entirely
// (e.g. Firefox's "background" must not keep Chrome's "service_worker").
const buildManifest = (target) => {
  const base = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8'));
  const overridePath = path.join(srcDir, `manifest.${target}.json`);
  const override = fs.existsSync(overridePath) ? JSON.parse(fs.readFileSync(overridePath, 'utf8')) : {};
  return { ...base, ...override };
};

const isOverrideManifest = (name) => /^manifest\.[a-z]+\.json$/.test(name);

const build = (target) => {
  const outDir = path.join(distDir, target);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(srcDir, outDir, {
    recursive: true,
    filter: (src) => !isOverrideManifest(path.basename(src)),
  });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(buildManifest(target), null, 2)}\n`);
  console.log(`✔ dist/${target}`);
};

const requested = process.argv.slice(2);
const targets = requested.length ? requested : TARGETS;
const unknown = targets.filter((t) => !TARGETS.includes(t));
if (unknown.length) {
  console.error(`Unknown target(s): ${unknown.join(', ')}. Use: ${TARGETS.join(', ')}`);
  process.exit(1);
}
targets.forEach(build);
