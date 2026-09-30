const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const esbuild = require('esbuild');

const isWatch = process.argv.includes('--watch');
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const RELOAD_PORT = 8999;

console.log('🚀 Building extension to dist/ ...');

// 1. Clean dist directory
if (!isWatch && fs.existsSync(distDir)) {
  try {
    fs.rmSync(distDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (_) {}
}
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 2. Type Check with tsc
console.log('🔍 Running TypeScript type check (tsc --noEmit)...');
try {
  execSync('npx tsc --noEmit', { cwd: rootDir, stdio: 'inherit' });
  console.log('✅ Type check passed!');
} catch (err) {
  console.error('❌ Type check failed. Please fix TypeScript errors.');
  if (!isWatch) process.exit(1);
}

// 3. Static Copy helper
function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    for (const child of fs.readdirSync(src)) {
      if (child === 'node_modules' || child === 'dist' || child === '.git') continue;
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    const ext = path.extname(src).toLowerCase();
    if (ext !== '.ts') {
      if (ext === '.css' && !isWatch) {
        try {
          const rawCss = fs.readFileSync(src, 'utf8');
          const minified = esbuild.transformSync(rawCss, { loader: 'css', minify: true }).code;
          fs.writeFileSync(dest, minified);
        } catch (err) {
          console.warn(`⚠️ Failed to minify CSS ${src}, copying as is.`, err.message);
          fs.copyFileSync(src, dest);
        }
      } else if (ext === '.json' && !isWatch) {
        try {
          const rawJson = fs.readFileSync(src, 'utf8');
          const minified = JSON.stringify(JSON.parse(rawJson));
          fs.writeFileSync(dest, minified);
        } catch (_) {
          fs.copyFileSync(src, dest);
        }
      } else {
        fs.copyFileSync(src, dest);
      }
    }
  }
}

function minifyHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function copyHtmlFile(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!isWatch) {
    try {
      const raw = fs.readFileSync(src, 'utf8');
      fs.writeFileSync(dest, minifyHtml(raw), 'utf8');
      return;
    } catch (_) {}
  }
  fs.copyFileSync(src, dest);
}

function copyAllStatic() {
  if (fs.existsSync(path.join(rootDir, 'manifest.json'))) {
    if (!isWatch) {
      try {
        const raw = fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8');
        fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(JSON.parse(raw)), 'utf8');
      } catch (_) {
        fs.copyFileSync(path.join(rootDir, 'manifest.json'), path.join(distDir, 'manifest.json'));
      }
    } else {
      fs.copyFileSync(path.join(rootDir, 'manifest.json'), path.join(distDir, 'manifest.json'));
    }
  }
  copyHtmlFile(path.join(rootDir, 'src/options.html'), path.join(distDir, 'options.html'));
  copyHtmlFile(path.join(rootDir, 'src/popup.html'), path.join(distDir, 'popup.html'));
  if (fs.existsSync(path.join(rootDir, 'src/_locales'))) {
    copyRecursive(path.join(rootDir, 'src/_locales'), path.join(distDir, '_locales'));
  }
  if (fs.existsSync(path.join(rootDir, 'src/assets'))) {
    copyRecursive(path.join(rootDir, 'src/assets'), path.join(distDir, 'assets'));
  }
}

copyAllStatic();

// 4. In-memory Auto Reload Server (Development Mode Only)
let reloadClients = [];

function startReloadServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url === '/wait-reload') {
      reloadClients.push(res);
      req.on('close', () => {
        reloadClients = reloadClients.filter((c) => c !== res);
      });
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚡ Reusing auto-reload server on port ${RELOAD_PORT}`);
    } else {
      console.error('Reload server error:', err);
    }
  });

  server.listen(RELOAD_PORT, '127.0.0.1', () => {
    console.log(`⚡ Auto-reload server ready on http://127.0.0.1:${RELOAD_PORT}`);
  });
}

function notifyReload() {
  if (reloadClients.length > 0) {
    console.log(`🔄 Reloading ${reloadClients.length} Chrome extension instance(s)...`);
    reloadClients.forEach((client) => {
      try {
        client.writeHead(200, { 'Content-Type': 'text/plain' });
        client.end('reload');
      } catch (_) {}
    });
    reloadClients = [];
  }
}

function appendDevReloader() {
  const bgPath = path.join(distDir, 'src', 'entries', 'background.js');
  if (fs.existsSync(bgPath)) {
    const devScript = `
/* --- DEV AUTO RELOADER --- */
(() => {
  const checkReload = () => {
    fetch('http://127.0.0.1:${RELOAD_PORT}/wait-reload')
      .then(() => {
        console.log('[DevReload] Rebuilding completed, reloading extension...');
        // Reload all extension tabs (settings, popup, sidepanel)
        if (chrome.tabs && chrome.tabs.query) {
          chrome.tabs.query({}, (tabs) => {
            if (chrome.runtime?.lastError || !Array.isArray(tabs)) return;
            const extPrefix = 'chrome-extension://' + chrome.runtime.id;
            tabs.forEach((tab) => {
              if (tab.url && tab.url.startsWith(extPrefix) && tab.id) {
                try {
                  chrome.tabs.reload(tab.id, () => {
                    void chrome.runtime?.lastError;
                  });
                } catch (_) {}
              }
            });
          });
        }
        chrome.runtime.reload();
      })
      .catch(() => {
        setTimeout(checkReload, 1500);
      });
  };
  checkReload();
})();
`;
    fs.appendFileSync(bgPath, devScript);
  }
}

// 5. Build with esbuild (IIFE format for MV3 Chrome Extension compatibility)
const entryPoints = {
  'src/entries/background': path.join(rootDir, 'src/entries/background.ts'),
  'src/entries/content': path.join(rootDir, 'src/entries/content.ts'),
  'src/features/popup': path.join(rootDir, 'src/features/popup.ts'),
  'src/features/settings': path.join(rootDir, 'src/features/settings.ts'),
  'src/shared/constants': path.join(rootDir, 'src/shared/constants.ts'),
  'src/shared/storage': path.join(rootDir, 'src/shared/storage.ts'),
  'src/shared/browser-api': path.join(rootDir, 'src/shared/browser-api.ts'),
  'src/shared/i18n': path.join(rootDir, 'src/shared/i18n.ts'),
  'src/features/whitelist': path.join(rootDir, 'src/features/whitelist.ts'),
};

const buildOptions = {
  entryPoints,
  outdir: distDir,
  bundle: false,
  format: 'iife',
  target: 'es2022',
  sourcemap: false,
  minify: true,
};

async function build() {
  if (isWatch) {
    console.log('👀 Starting watch mode (watching ALL .ts, .html, .css, assets)...');
    startReloadServer();

    const ctx = await esbuild.context(buildOptions);
    await ctx.rebuild();
    copyAllStatic();
    appendDevReloader();

    // Full directory watcher for HTML, CSS, assets, manifest, and TS files
    let debounceTimer = null;
    const triggerRebuild = (eventType, filename) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          console.log(`📝 File changed: ${filename || 'file'} -> Rebuilding...`);
          await ctx.rebuild();
          copyAllStatic();
          appendDevReloader();
          notifyReload();
          console.log('⚡ Done! Extension reloaded in Chrome.');
        } catch (err) {
          console.error('❌ Rebuild error:', err.message);
        }
      }, 60);
    };

    // Watch src and manifest.json
    ['src'].forEach((dir) => {
      const fullDir = path.join(rootDir, dir);
      if (fs.existsSync(fullDir)) {
        fs.watch(fullDir, { recursive: true }, triggerRebuild);
      }
    });

    ['manifest.json'].forEach((file) => {
      const fullPath = path.join(rootDir, file);
      if (fs.existsSync(fullPath)) {
        fs.watch(fullPath, triggerRebuild);
      }
    });

    console.log('⚡ Ready! Sửa bất kỳ file .ts, .css, .html nào, Chrome sẽ tự động reload ngay lập tức.');
  } else {
    console.log('📦 Compiling with esbuild (Production build)...');
    await esbuild.build(buildOptions);
    console.log('✨ Build complete! Output directory: dist/\n');
  }
}

build().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
