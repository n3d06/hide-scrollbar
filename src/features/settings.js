(() => {
  const { applyI18n, getMessage } = globalThis.ScrollHideI18n;
  const { BACKUP_FILENAME, DEFAULT_SYNC_STATE } = globalThis.ScrollHideConstants;
  const { applyTheme, getHideCount, getSyncState, parseBackup, setHideCount, setSyncValue } =
    globalThis.ScrollHideStorage;
  const { normalizeWhitelist, parseWhitelistFile, serializeDomains } = globalThis.ScrollHideWhitelist;

  const isFirefox = chrome.runtime.getURL('').startsWith('moz-extension:');
  const version = chrome.runtime.getManifest().version;

  const { getElement: $ } = globalThis.ScrollHideDom;
  const ui = {
    hideScrollbar: $('settingHideScrollbar', HTMLInputElement),
    theme: $('settingTheme', HTMLSelectElement),
    configureShortcuts: $('btnConfigureShortcuts', HTMLButtonElement),
    // Whitelist editor
    applyWhitelist: $('btnApplyWhitelist', HTMLButtonElement),
    revertWhitelist: $('btnRevertWhitelist', HTMLButtonElement),
    importWhitelist: $('btnImportWhitelist', HTMLButtonElement),
    exportWhitelist: $('btnExportWhitelist', HTMLButtonElement),
    whitelistFile: $('whitelistFileInput', HTMLInputElement),
    saveIndicator: $('saveIndicator'),
    gutter: $('whitelistGutter'),
    editor: $('whitelistInput', HTMLTextAreaElement),
    // Statistics & backup
    cleanedCount: $('statCleanedCount'),
    resetCleaned: $('btnResetCleaned', HTMLButtonElement),
    exportSettings: $('btnExportSettings', HTMLButtonElement),
    importSettings: $('btnImportSettings', HTMLButtonElement),
    settingsFile: $('settingsFileInput', HTMLInputElement),
    resetDefaults: $('btnResetDefaults', HTMLButtonElement),
    // About
    version: $('extVersion'),
    rate: $('btnRateExtension', HTMLButtonElement),
    copyReportInfo: $('btnCopyReportInfo', HTMLButtonElement),
    copyReportInfoText: $('copyReportInfoText'),
  };

  /* ── Helpers ──────────────────────────────────────────────── */

  let toastTimer;
  const showToast = (message) => {
    ui.saveIndicator.textContent = message;
    ui.saveIndicator.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.saveIndicator.classList.remove('visible'), 2000);
  };

  const downloadFile = (filename, content, type) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Opens the hidden <input type="file"> and resolves with the chosen file's text
  const pickFile = (input, onText) => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = ''; // allow picking the same file again
      if (file) onText(await file.text());
    });
    return () => input.click();
  };

  /* ── Whitelist editor ─────────────────────────────────────── */

  // Text of the whitelist as last saved; the editor is "dirty" when it differs
  let savedWhitelistText = '';

  const getEditorText = () => ui.editor.value;
  const isEditorDirty = () => getEditorText() !== savedWhitelistText;

  const updateLineNumbers = () => {
    const lineCount = getEditorText().split('\n').length;
    ui.gutter.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
  };

  const updateDirtyState = () => {
    const dirty = isEditorDirty();
    ui.applyWhitelist.disabled = !dirty;
    ui.revertWhitelist.disabled = !dirty;
  };

  const setEditorText = (text) => {
    ui.editor.value = text;
    updateLineNumbers();
    updateDirtyState();
  };

  // A whitelist saved elsewhere (popup, other device) replaces the editor unless it has unsaved edits
  const showSavedWhitelist = (whitelist) => {
    const keepEdits = isEditorDirty();
    savedWhitelistText = serializeDomains(whitelist);
    if (keepEdits) updateDirtyState();
    else setEditorText(savedWhitelistText);
  };

  const applyWhitelistChanges = async () => {
    const text = getEditorText();
    await setSyncValue({ whitelist: normalizeWhitelist(text.split('\n')) });
    savedWhitelistText = text;
    updateDirtyState();
    showToast(getMessage('msgChangesApplied'));
  };

  /* ── State ────────────────────────────────────────────────── */

  const renderState = (state) => {
    ui.hideScrollbar.checked = state.scrollbarHidden;
    ui.theme.value = state.theme;
    applyTheme(state.theme);
  };

  const loadAllState = async () => {
    const [state, hideCount] = await Promise.all([getSyncState(), getHideCount()]);
    renderState(state);
    savedWhitelistText = serializeDomains(state.whitelist);
    setEditorText(savedWhitelistText);
    ui.cleanedCount.textContent = hideCount.toLocaleString();
  };

  /* ── General settings ─────────────────────────────────────── */

  ui.hideScrollbar.addEventListener('change', () => {
    setSyncValue({ scrollbarHidden: ui.hideScrollbar.checked });
  });

  ui.theme.addEventListener('change', () => {
    applyTheme(ui.theme.value);
    setSyncValue({ theme: /** @type {Theme} */ (ui.theme.value) }); // <select> only offers valid themes
  });

  ui.configureShortcuts.addEventListener('click', () => {
    // Firefox (min version 140) has a dedicated API; extensions can't open about:addons directly
    // @types/chrome doesn't know this Firefox-only API
    if (isFirefox) /** @type {any} */ (chrome.commands).openShortcutSettings();
    else chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  /* ── Whitelist editor events ──────────────────────────────── */

  ui.editor.addEventListener('scroll', () => {
    ui.gutter.scrollTop = ui.editor.scrollTop;
  });

  ui.editor.addEventListener('input', () => {
    updateLineNumbers();
    updateDirtyState();
  });

  ui.editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      applyWhitelistChanges();
    }
  });

  ui.applyWhitelist.addEventListener('click', applyWhitelistChanges);
  ui.revertWhitelist.addEventListener('click', () => setEditorText(savedWhitelistText));

  ui.exportWhitelist.addEventListener('click', () => {
    downloadFile('scrollhide-whitelist.txt', getEditorText(), 'text/plain;charset=utf-8');
  });

  ui.importWhitelist.addEventListener(
    'click',
    pickFile(ui.whitelistFile, (text) => {
      const lines = parseWhitelistFile(text);
      if (lines === null) {
        alert(getMessage('msgInvalidWhitelistJson'));
        return;
      }
      if (lines.length === 0) {
        alert(getMessage('msgNoValidDomains'));
        return;
      }
      // Appended for review; nothing is saved until "Apply"
      const current = getEditorText().trim();
      setEditorText([current, ...lines].filter(Boolean).join('\n'));
      showToast(getMessage('msgImportedDomains', [String(lines.length)]));
    }),
  );

  // Warn before closing the tab with unsaved whitelist edits
  window.addEventListener('beforeunload', (e) => {
    if (isEditorDirty()) e.preventDefault();
  });

  /* ── Statistics & backup ──────────────────────────────────── */

  ui.resetCleaned.addEventListener('click', async () => {
    await setHideCount(0);
    ui.cleanedCount.textContent = '0';
  });

  ui.exportSettings.addEventListener('click', async () => {
    const state = await getSyncState();
    downloadFile(BACKUP_FILENAME, JSON.stringify(state, null, 2), 'application/json');
  });

  ui.importSettings.addEventListener(
    'click',
    pickFile(ui.settingsFile, async (text) => {
      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        alert(getMessage('msgBackupParseFailed'));
        return;
      }
      const next = parseBackup(data);
      if (!next) {
        alert(getMessage('msgInvalidConfig'));
        return;
      }
      await setSyncValue(next);
      await loadAllState();
      alert(getMessage('msgSettingsRestored'));
    }),
  );

  ui.resetDefaults.addEventListener('click', async () => {
    if (!confirm(getMessage('msgConfirmReset'))) return;
    await setSyncValue(DEFAULT_SYNC_STATE);
    await loadAllState();
  });

  /* ── About ────────────────────────────────────────────────── */

  ui.rate.addEventListener('click', () => {
    const url = isFirefox
      ? 'https://addons.mozilla.org/firefox/addon/ihatescrollbar/reviews/'
      : `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews`;
    chrome.tabs.create({ url });
  });

  ui.copyReportInfo.addEventListener('click', async () => {
    const info = [
      '### Environment Details',
      `- **Extension:** ScrollHide v${version}`,
      `- **User Agent:** ${navigator.userAgent}`,
      `- **Platform:** ${navigator.platform || 'Unknown'}`,
      `- **Screen Resolution:** ${screen.width}x${screen.height}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(info);
    } catch (err) {
      console.error('[Settings] Copy failed', err);
      return;
    }
    const original = ui.copyReportInfoText.textContent;
    ui.copyReportInfoText.textContent = getMessage('msgCopied');
    setTimeout(() => {
      ui.copyReportInfoText.textContent = original;
    }, 2000);
  });

  /* ── Changes from the popup, shortcut or another device ───── */

  chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'local' && changes.hideCount) {
      ui.cleanedCount.textContent = (changes.hideCount.newValue ?? 0).toLocaleString();
    }
    if (namespace !== 'sync') return;
    const state = await getSyncState();
    renderState(state);
    if (changes.whitelist) showSavedWhitelist(state.whitelist);
  });

  /* ── Init ─────────────────────────────────────────────────── */

  applyI18n();
  ui.version.textContent = `v${version}`;
  loadAllState().catch((err) => console.error('[Settings] Failed to load', err));
})();
