(() => {
  /* ── Main Settings Initialization ──────────────────────────────── */

  const initSettings = () => {
    'use strict';

    const isFirefox =
      typeof chrome !== 'undefined' && !!chrome.runtime?.getURL && chrome.runtime.getURL('').startsWith('moz-extension:');

    const { applyI18n } = globalThis.ScrollHideI18n || {};
    const { BACKUP_FILENAME, DEFAULT_SYNC_STATE } = globalThis.ScrollHideConstants || {};
    const { getSyncState, setSyncValue, applyTheme } = globalThis.ScrollHideStorage || {};
    const { normalizeWhitelist, sanitizeDomain } = globalThis.ScrollHideWhitelist || {};

    if (applyI18n) {
      applyI18n();
    }

    // DOM Elements - General & Appearance
    const settingHideScrollbar = document.getElementById('settingHideScrollbar');
    const settingTheme = document.getElementById('settingTheme');
    const btnConfigureShortcuts = document.getElementById('btnConfigureShortcuts');

    // DOM Elements - Whitelist Editor
    const btnApplyWhitelist = document.getElementById('btnApplyWhitelist');
    const btnRevertWhitelist = document.getElementById('btnRevertWhitelist');
    const btnImportWhitelist = document.getElementById('btnImportWhitelist');
    const btnExportWhitelist = document.getElementById('btnExportWhitelist');
    const whitelistFileInput = document.getElementById('whitelistFileInput');
    const saveIndicator = document.getElementById('saveIndicator');
    const whitelistGutter = document.getElementById('whitelistGutter');
    const whitelistInput = document.getElementById('whitelistInput');

    // DOM Elements - Statistics & Backup
    const statCleanedCount = document.getElementById('statCleanedCount');
    const btnResetCleaned = document.getElementById('btnResetCleaned');
    const btnExportSettings = document.getElementById('btnExportSettings');
    const btnImportSettings = document.getElementById('btnImportSettings');
    const settingsFileInput = document.getElementById('settingsFileInput');
    const btnResetDefaults = document.getElementById('btnResetDefaults');
    const btnRateExtension = document.getElementById('btnRateExtension');

    // DOM Elements - Report & Privacy
    const btnCopyReportInfo = document.getElementById('btnCopyReportInfo');
    const copyReportInfoText = document.getElementById('copyReportInfoText');

    let lastSavedWhitelistText = '';

    function showSavedToast(msg = 'Changes saved') {
      if (!saveIndicator) return;
      saveIndicator.textContent = msg;
      saveIndicator.classList.add('visible');
      setTimeout(() => {
        saveIndicator?.classList.remove('visible');
      }, 2000);
    }

    /* ── Native Editor Helpers ────────────────────────────────── */

    function updateLineNumbers() {
      if (!whitelistInput || !whitelistGutter) return;
      const lineCount = (whitelistInput.value.match(/\n/g) || []).length + 1;
      let numbers = '';
      for (let i = 1; i <= lineCount; i++) {
        numbers += i + '\n';
      }
      whitelistGutter.textContent = numbers;
    }

    function getEditorText() {
      return whitelistInput ? whitelistInput.value : '';
    }

    function setEditorText(text) {
      if (whitelistInput) {
        whitelistInput.value = text;
        updateLineNumbers();
      }
    }

    function checkWhitelistDirty() {
      const isDirty = getEditorText() !== lastSavedWhitelistText;
      if (btnApplyWhitelist) btnApplyWhitelist.disabled = !isDirty;
      if (btnRevertWhitelist) btnRevertWhitelist.disabled = !isDirty;
    }

    /* ── Parse & Normalize Lines ──────────────────────────────── */

    function parseEditorContent(text) {
      const lines = text.split('\n');
      const domains = [];

      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('#')) {
          return;
        }
        const cleaned = sanitizeDomain ? sanitizeDomain(trimmed) : trimmed;
        if (cleaned) {
          domains.push(cleaned);
        }
      });

      return normalizeWhitelist ? normalizeWhitelist(domains) : domains;
    }

    /* ── Load State ───────────────────────────────────────────── */

    function loadAllState() {
      if (getSyncState) {
        getSyncState().then((state) => {
          // Settings
          if (settingHideScrollbar) {
            settingHideScrollbar.checked = Boolean(state.scrollbarHidden);
          }

          // Theme
          const theme = state.theme || 'system';
          if (settingTheme) {
            settingTheme.value = theme;
          }
          if (applyTheme) {
            applyTheme(theme);
          }

          // Whitelist
          const domains = normalizeWhitelist ? normalizeWhitelist(state.whitelist || []) : state.whitelist || [];
          const text = domains.join('\n');
          setEditorText(text);
          lastSavedWhitelistText = text;
          checkWhitelistDirty();
        });
      }

      // Cleaned counter
      if (statCleanedCount && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get({ hideCount: 0 }, (res) => {
          statCleanedCount.textContent = (res.hideCount || 0).toLocaleString();
        });
      }

      // Version display
      const version =
        typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : '2.1';
      const versionText = `v${version}`;
      const extVersionEl = document.getElementById('extVersion');
      if (extVersionEl) extVersionEl.textContent = versionText;
      document.querySelectorAll('.ext-version-badge').forEach((el) => {
        el.textContent = versionText;
      });
    }

    loadAllState();

    /* ── Settings Event Listeners ─────────────────────────────── */

    if (settingHideScrollbar && setSyncValue) {
      settingHideScrollbar.addEventListener('change', () => {
        setSyncValue({ scrollbarHidden: settingHideScrollbar.checked });
      });
    }

    if (settingTheme && setSyncValue) {
      settingTheme.addEventListener('change', () => {
        const themeVal = settingTheme.value;
        if (applyTheme) applyTheme(themeVal);
        setSyncValue({ theme: themeVal });
      });
    }

    if (btnConfigureShortcuts) {
      btnConfigureShortcuts.addEventListener('click', () => {
        if (typeof chrome === 'undefined') return;
        // Firefox (min version 140) has a dedicated API; extensions can't open about:addons directly
        if (isFirefox) {
          chrome.commands.openShortcutSettings();
        } else if (chrome.tabs?.create) {
          chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
        }
      });
    }

    if (btnResetCleaned && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      btnResetCleaned.addEventListener('click', () => {
        chrome.storage.local.set({ hideCount: 0 }, () => {
          if (statCleanedCount) statCleanedCount.textContent = '0';
        });
      });
    }

    if (btnExportSettings && getSyncState) {
      btnExportSettings.addEventListener('click', () => {
        getSyncState().then((data) => {
          const json = JSON.stringify(data, null, 2);
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = BACKUP_FILENAME || 'scrollhide-backup.json';
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
      });
    }

    if (btnImportSettings && settingsFileInput && setSyncValue) {
      btnImportSettings.addEventListener('click', () => settingsFileInput.click());

      settingsFileInput.addEventListener('change', (e) => {
        const target = e.target;
        const file = target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const data = JSON.parse(event.target?.result);
            if (!data || typeof data !== 'object') {
              alert('Invalid configuration file.');
              return;
            }
            const nextState = {};
            if (typeof data.scrollbarHidden === 'boolean') {
              nextState.scrollbarHidden = data.scrollbarHidden;
            }
            if (Array.isArray(data.whitelist)) {
              nextState.whitelist = normalizeWhitelist ? normalizeWhitelist(data.whitelist) : data.whitelist;
            }
            if (typeof data.theme === 'string' && ['system', 'light', 'dark'].includes(data.theme)) {
              nextState.theme = data.theme;
            }

            setSyncValue(nextState).then(() => {
              loadAllState();
              alert('Settings restored successfully!');
            });
          } catch (_) {
            alert('Failed to parse backup JSON file.');
          }
        };
        reader.readAsText(file);
        settingsFileInput.value = '';
      });
    }

    if (btnResetDefaults && setSyncValue) {
      btnResetDefaults.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset all settings and whitelist to default?')) {
          setSyncValue(DEFAULT_SYNC_STATE).then(() => {
            loadAllState();
          });
        }
      });
    }

    /* ── Whitelist Tab Event Listeners ────────────────────────── */

    function applyWhitelistChanges() {
      if (!setSyncValue) return;
      const currentText = getEditorText();
      const domains = parseEditorContent(currentText);
      setSyncValue({ whitelist: domains }).then(() => {
        lastSavedWhitelistText = currentText;
        checkWhitelistDirty();
        showSavedToast('Changes applied');
      });
    }

    if (whitelistInput && whitelistGutter) {
      whitelistInput.addEventListener('scroll', () => {
        whitelistGutter.scrollTop = whitelistInput.scrollTop;
      });

      whitelistInput.addEventListener('input', () => {
        updateLineNumbers();
        checkWhitelistDirty();
      });

      whitelistInput.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          applyWhitelistChanges();
        }
      });
    }

    if (btnApplyWhitelist) {
      btnApplyWhitelist.addEventListener('click', applyWhitelistChanges);
    }

    if (btnRevertWhitelist) {
      btnRevertWhitelist.addEventListener('click', () => {
        setEditorText(lastSavedWhitelistText);
        checkWhitelistDirty();
      });
    }

    if (btnExportWhitelist) {
      btnExportWhitelist.addEventListener('click', () => {
        const content = getEditorText();
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'scrollhide-whitelist.txt';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    }

    if (btnImportWhitelist && whitelistFileInput) {
      btnImportWhitelist.addEventListener('click', () => whitelistFileInput.click());

      whitelistFileInput.addEventListener('change', (e) => {
        const target = e.target;
        const file = target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          const text = (event.target?.result || '').trim();
          let importedLines = [];

          if (text.startsWith('{') || text.startsWith('[')) {
            try {
              const parsed = JSON.parse(text);
              if (Array.isArray(parsed.whitelist)) {
                importedLines = parsed.whitelist;
              } else if (Array.isArray(parsed)) {
                importedLines = parsed;
              } else {
                alert(
                  'Invalid whitelist JSON format. Expected an array of domains or an object containing a "whitelist" array.',
                );
                return;
              }
            } catch (_) {
              importedLines = text.split('\n');
            }
          } else {
            importedLines = text.split('\n');
          }

          const validLines = importedLines.map((l) => String(l).trim()).filter(Boolean);
          if (validLines.length === 0) {
            alert('No valid domain entries found in the file.');
            return;
          }

          const currentVal = getEditorText().trim();
          const appendText = validLines.join('\n');

          const nextVal = currentVal ? `${currentVal}\n${appendText}` : appendText;
          setEditorText(nextVal);
          checkWhitelistDirty();
          showSavedToast(`Imported ${validLines.length} domain(s)`);
        };

        reader.readAsText(file);
        whitelistFileInput.value = '';
      });
    }

    if (btnRateExtension) {
      btnRateExtension.addEventListener('click', () => {
        const extId = typeof chrome !== 'undefined' && chrome.runtime?.id;
        let reviewUrl = 'https://github.com/n3d06/hide-scrollbar';
        if (isFirefox) {
          reviewUrl = 'https://addons.mozilla.org/firefox/addon/ihatescrollbar/reviews/';
        } else if (extId) {
          reviewUrl = `https://chromewebstore.google.com/detail/${extId}/reviews`;
        }

        if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
          chrome.tabs.create({ url: reviewUrl });
        } else {
          window.open(reviewUrl, '_blank');
        }
      });
    }

    // Report: Copy System Info
    if (btnCopyReportInfo) {
      btnCopyReportInfo.addEventListener('click', async () => {
        const extVersion =
          typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : '2.1';
        const info = [
          '### Environment Details',
          `- **Extension:** ScrollHide v${extVersion}`,
          `- **User Agent:** ${navigator.userAgent}`,
          `- **Platform:** ${navigator.platform || 'Unknown'}`,
          `- **Screen Resolution:** ${window.screen.width}x${window.screen.height}`,
        ].join('\n');

        const setCopiedUI = () => {
          if (copyReportInfoText) {
            const original = copyReportInfoText.textContent;
            copyReportInfoText.textContent = 'Copied!';
            setTimeout(() => {
              if (copyReportInfoText) copyReportInfoText.textContent = original;
            }, 2000);
          }
        };

        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(info);
            setCopiedUI();
          } else {
            throw new Error('Clipboard API unavailable');
          }
        } catch (_) {
          try {
            const textArea = document.createElement('textarea');
            textArea.value = info;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            setCopiedUI();
          } catch (_) {}
        }
      });
    }

    // Warn user if closing tab with unsaved whitelist edits
    window.addEventListener('beforeunload', (e) => {
      if (getEditorText() !== lastSavedWhitelistText) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Listen to remote changes
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync') {
          if (changes.scrollbarHidden && settingHideScrollbar) {
            settingHideScrollbar.checked = Boolean(changes.scrollbarHidden.newValue);
          }
          if (changes.theme) {
            const newTheme = String(changes.theme.newValue || 'system');
            if (settingTheme) settingTheme.value = newTheme;
            if (applyTheme) applyTheme(newTheme);
          }
          if (changes.whitelist && Array.isArray(changes.whitelist.newValue)) {
            const isDirty = getEditorText() !== lastSavedWhitelistText;
            const newDomains = normalizeWhitelist
              ? normalizeWhitelist(changes.whitelist.newValue)
              : changes.whitelist.newValue;
            const newText = newDomains.join('\n');
            if (!isDirty) {
              setEditorText(newText);
              lastSavedWhitelistText = newText;
              checkWhitelistDirty();
            } else {
              lastSavedWhitelistText = newText;
              checkWhitelistDirty();
            }
          }
        }
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettings);
  } else {
    initSettings();
  }
})();
