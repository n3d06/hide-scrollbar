(() => {
  // chrome.storage returns Promises in MV3 (Chrome and Firefox). Outside an extension
  // context, or after the extension was reloaded under an open page (runtime.id is gone),
  // fall back to the defaults instead of throwing.
  const hasStorage = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.sync;

  const getConstants = () => globalThis.ScrollHideConstants;

  /**
   * The one place that decides how stored values are read, so every context agrees.
   * Missing or invalid values fall back to the defaults (hiding is on unless explicitly off).
   * @param {unknown} raw
   * @returns {SyncState}
   */
  const normalizeSyncState = (raw) => {
    const { THEMES } = getConstants();
    /** @type {Record<string, any>} */
    const state = raw && typeof raw === 'object' ? raw : {};
    return {
      scrollbarHidden: state.scrollbarHidden !== false,
      whitelist: Array.isArray(state.whitelist) ? state.whitelist.filter((item) => typeof item === 'string') : [],
      theme: THEMES.includes(state.theme) ? state.theme : 'system',
    };
  };

  /**
   * Settings to restore from a backup file. Only keys present and valid in the file are
   * returned, so a partial backup leaves the other settings alone. Null if it is not an object.
   * @param {any} data parsed JSON
   * @returns {Partial<SyncState> | null}
   */
  const parseBackup = (data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const { THEMES } = getConstants();
    const { normalizeWhitelist } = globalThis.ScrollHideWhitelist;
    /** @type {Partial<SyncState>} */
    const next = {};
    if (typeof data.scrollbarHidden === 'boolean') next.scrollbarHidden = data.scrollbarHidden;
    if (Array.isArray(data.whitelist)) next.whitelist = normalizeWhitelist(data.whitelist);
    if (THEMES.includes(data.theme)) next.theme = data.theme;
    return next;
  };

  const getSyncState = async () => {
    const defaults = getConstants().DEFAULT_SYNC_STATE;
    return normalizeSyncState(hasStorage() ? await chrome.storage.sync.get({ ...defaults }) : defaults);
  };

  const setSyncValue = async (value) => {
    if (hasStorage()) await chrome.storage.sync.set(value);
  };

  /* ── "Cleaned" counter (local, not synced) ─────────────────── */

  const getHideCount = async () => {
    if (!hasStorage()) return 0;
    const { hideCount } = await chrome.storage.local.get({ hideCount: 0 });
    return typeof hideCount === 'number' && Number.isFinite(hideCount) ? hideCount : 0;
  };

  const setHideCount = async (hideCount) => {
    if (hasStorage()) await chrome.storage.local.set({ hideCount });
  };

  /**
   * @param {string} theme
   * @param {Pick<Element, 'setAttribute' | 'removeAttribute'>} [target]
   */
  const applyTheme = (theme, target = globalThis.document?.documentElement) => {
    if (!target) return;
    if (theme === 'light' || theme === 'dark') {
      target.setAttribute('data-theme', theme);
    } else {
      target.removeAttribute('data-theme');
    }
  };

  const ScrollHideStorage = {
    applyTheme,
    getHideCount,
    getSyncState,
    normalizeSyncState,
    parseBackup,
    setHideCount,
    setSyncValue,
  };

  // Global assignment for the service worker & HTML script tags
  globalThis.ScrollHideStorage = ScrollHideStorage;
})();
