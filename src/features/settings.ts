import { EditorView, placeholder, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { minimalSetup } from 'codemirror';
import { StreamLanguage } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';

/* ── Minimal CodeMirror 6 Language for Whitelist ────────────────── */

const whitelistStreamParser = {
  token(stream: any) {
    if (stream.sol()) {
      stream.eatSpace();
      if (stream.peek() === '!' || stream.peek() === '#') {
        stream.skipToEnd();
        return 'lineComment';
      }
    }
    if (stream.eatSpace()) return null;
    if (stream.peek() === '!' || stream.peek() === '#') {
      stream.skipToEnd();
      return 'lineComment';
    }
    if (stream.match(/^https?:\/\/[^\s]+/)) {
      return 'url';
    }
    if (stream.match(/^(\*\.)?[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)*(:\d+)?/)) {
      return 'keyword';
    }
    stream.next();
    return null;
  },
};

const whitelistLanguage = StreamLanguage.define(whitelistStreamParser);

/* ── Main Settings Initialization ──────────────────────────────── */

const initSettings = () => {
  'use strict';

  const { applyI18n } = (globalThis as any).ScrollHideI18n || {};
  const { BACKUP_FILENAME, DEFAULT_SYNC_STATE } = (globalThis as any).ScrollHideConstants || {};
  const { getSyncState, setSyncValue, applyTheme } = (globalThis as any).ScrollHideStorage || {};
  const { normalizeWhitelist, sanitizeDomain } = (globalThis as any).ScrollHideWhitelist || {};

  if (applyI18n) {
    applyI18n();
  }

  // Tabs
  const navTabs = document.querySelectorAll<HTMLElement>('.nav-tab[data-tab]');
  const tabPanes = document.querySelectorAll<HTMLElement>('.tab-pane');

  // Settings elements
  const settingHideScrollbar = document.getElementById('settingHideScrollbar') as HTMLInputElement | null;
  const settingTheme = document.getElementById('settingTheme') as HTMLSelectElement | null;
  const statCleanedCount = document.getElementById('statCleanedCount') as HTMLElement | null;
  const btnResetCleaned = document.getElementById('btnResetCleaned') as HTMLButtonElement | null;
  const btnExportSettings = document.getElementById('btnExportSettings') as HTMLButtonElement | null;
  const btnImportSettings = document.getElementById('btnImportSettings') as HTMLButtonElement | null;
  const settingsFileInput = document.getElementById('settingsFileInput') as HTMLInputElement | null;
  const btnResetDefaults = document.getElementById('btnResetDefaults') as HTMLButtonElement | null;

  // Whitelist elements
  const btnApplyWhitelist = document.getElementById('btnApplyWhitelist') as HTMLButtonElement | null;
  const btnRevertWhitelist = document.getElementById('btnRevertWhitelist') as HTMLButtonElement | null;
  const btnImportWhitelist = document.getElementById('btnImportWhitelist') as HTMLButtonElement | null;
  const btnExportWhitelist = document.getElementById('btnExportWhitelist') as HTMLButtonElement | null;
  const whitelistFileInput = document.getElementById('whitelistFileInput') as HTMLInputElement | null;
  const saveIndicator = document.getElementById('saveIndicator') as HTMLElement | null;
  const whitelistEditorContainer = document.getElementById('whitelistEditorContainer') as HTMLElement | null;

  let lastSavedWhitelistText = '';
  let editorView: EditorView | null = null;
  const themeCompartment = new Compartment();

  const darkTheme = EditorView.theme(
    {
      '&': {
        backgroundColor: 'var(--secondary-bg) !important',
        color: 'var(--text)',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--secondary-bg) !important',
        color: 'var(--muted)',
        borderRight: '1px solid rgba(255, 255, 255, 0.15) !important',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'rgba(255, 255, 255, 0.07)',
      },
      '.cm-activeLine': {
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
      },
    },
    { dark: true }
  );

  const getEditorText = (): string => (editorView ? editorView.state.doc.toString() : '');

  const setEditorText = (text: string): void => {
    if (!editorView) return;
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: text,
      },
    });
  };

  const checkWhitelistDirty = (): void => {
    if (!btnApplyWhitelist || !btnRevertWhitelist) return;
    const isDirty = getEditorText() !== lastSavedWhitelistText;
    btnApplyWhitelist.disabled = !isDirty;
    btnRevertWhitelist.disabled = !isDirty;
  };

  const updateEditorTheme = (themeName?: string): void => {
    if (!editorView) return;
    const theme = themeName || (settingTheme ? settingTheme.value : 'system');
    const isDark =
      theme === 'dark' ||
      (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    editorView.dispatch({
      effects: themeCompartment.reconfigure(isDark ? [oneDark, darkTheme] : []),
    });
  };

  // Initialize CodeMirror 6 Editor
  if (whitelistEditorContainer) {
    const isInitialDark =
      typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

    editorView = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          minimalSetup,
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          whitelistLanguage,
          themeCompartment.of(isInitialDark ? [oneDark, darkTheme] : []),
          EditorView.theme({
            '&': { height: '100%' },
          }),
          placeholder('! Enter domains here, one per line\nexample.com\nyoutube.com'),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              checkWhitelistDirty();
            }
          }),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                if (btnApplyWhitelist && !btnApplyWhitelist.disabled) {
                  applyWhitelistChanges();
                }
                return true;
              },
            },
          ]),
        ],
      }),
      parent: whitelistEditorContainer,
    });
  }

  /* ── Tab Switching ────────────────────────────────────────── */

  function switchTab(tabName: string | undefined): void {
    if (!tabName) return;
    navTabs.forEach((tab) => {
      const isTarget = tab.dataset.tab === tabName;
      tab.classList.toggle('active', isTarget);
      tab.setAttribute('aria-selected', String(isTarget));
    });

    tabPanes.forEach((pane) => {
      pane.classList.toggle('active', pane.id === `tab-${tabName}`);
    });

    // Synchronize query parameter ?tab=... in URL (no hash #)
    const currentParams = new URLSearchParams(window.location.search);
    if (currentParams.get('tab') !== tabName) {
      const newUrl = `${window.location.pathname}?tab=${tabName}`;
      history.replaceState(null, '', newUrl);
    }

    if (tabName === 'whitelist' && editorView) {
      editorView.requestMeasure();
    }
  }

  navTabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  const validTabs = ['settings', 'whitelist', 'guide', 'report', 'about'];
  const params = new URLSearchParams(window.location.search);
  const initialTab = params.get('tab');

  switchTab(initialTab && validTabs.includes(initialTab) ? initialTab : 'settings');

  window.addEventListener('popstate', () => {
    const popParams = new URLSearchParams(window.location.search);
    const popTab = popParams.get('tab') || 'settings';
    if (validTabs.includes(popTab)) {
      switchTab(popTab);
    }
  });

  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (settingTheme && settingTheme.value === 'system') {
        updateEditorTheme('system');
      }
    });
  }

  function showSavedToast(msg: string = 'Changes saved'): void {
    if (!saveIndicator) return;
    saveIndicator.textContent = msg;
    saveIndicator.classList.add('visible');
    setTimeout(() => {
      saveIndicator?.classList.remove('visible');
    }, 2000);
  }

  /* ── Parse & Normalize Lines ──────────────────────────────── */

  function parseEditorContent(text: string): string[] {
    const lines = text.split('\n');
    const domains: string[] = [];

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

  function loadAllState(): void {
    if (getSyncState) {
      getSyncState().then((state: { scrollbarHidden?: boolean; whitelist?: string[]; theme?: string }) => {
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
        updateEditorTheme(theme);

        // Whitelist
        const domains = normalizeWhitelist ? normalizeWhitelist(state.whitelist || []) : (state.whitelist || []);
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
    const version = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest)
      ? chrome.runtime.getManifest().version
      : '2.1';
    const versionText = `v${version}`;
    const extVersionEl = document.getElementById('extVersion');
    if (extVersionEl) extVersionEl.textContent = versionText;
    document.querySelectorAll<HTMLElement>('.ext-version-badge').forEach((el) => {
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
      updateEditorTheme(themeVal);
    });
  }

  const btnConfigureShortcuts = document.getElementById('btnConfigureShortcuts') as HTMLButtonElement | null;
  if (btnConfigureShortcuts) {
    btnConfigureShortcuts.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
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
      getSyncState().then((data: unknown) => {
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

    settingsFileInput.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          if (!data || typeof data !== 'object') {
            alert('Invalid configuration file.');
            return;
          }
          const nextState: Record<string, unknown> = {};
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

  function applyWhitelistChanges(): void {
    if (!editorView || !setSyncValue) return;
    const currentText = getEditorText();
    const domains = parseEditorContent(currentText);
    setSyncValue({ whitelist: domains }).then(() => {
      lastSavedWhitelistText = currentText;
      checkWhitelistDirty();
      showSavedToast('Changes applied');
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

    whitelistFileInput.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const text = ((event.target?.result as string) || '').trim();
        let importedLines: string[] = [];

        if (text.startsWith('{') || text.startsWith('[')) {
          try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed.whitelist)) {
              importedLines = parsed.whitelist;
            } else if (Array.isArray(parsed)) {
              importedLines = parsed;
            } else {
              alert('Invalid whitelist JSON format. Expected an array of domains or an object containing a "whitelist" array.');
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

  // Report Tab: Copy System Info
  const btnCopyReportInfo = document.getElementById('btnCopyReportInfo') as HTMLButtonElement | null;
  const copyReportInfoText = document.getElementById('copyReportInfoText') as HTMLElement | null;
  if (btnCopyReportInfo) {
    btnCopyReportInfo.addEventListener('click', async () => {
      const extVersion =
        typeof chrome !== 'undefined' && chrome.runtime?.getManifest
          ? chrome.runtime.getManifest().version
          : '2.1';
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
          updateEditorTheme(newTheme);
        }
        if (changes.whitelist && Array.isArray(changes.whitelist.newValue)) {
          const isDirty = getEditorText() !== lastSavedWhitelistText;
          const newDomains = normalizeWhitelist ? normalizeWhitelist(changes.whitelist.newValue) : changes.whitelist.newValue;
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
  document.addEventListener('DOMContentLoaded', () => {
    initSettings();
    requestAnimationFrame(() => document.documentElement.classList.add('loaded'));
  });
} else {
  initSettings();
  requestAnimationFrame(() => document.documentElement.classList.add('loaded'));
}
