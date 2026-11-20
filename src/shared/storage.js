(() => {
  // chrome.storage returns Promises in MV3 (Chrome and Firefox). Outside an extension
  // context, or after the extension was reloaded under an open page (runtime.id is gone),
  // fall back to the defaults instead of throwing.
  const hasSyncStorage = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.sync;

  const getDefaultSyncState = () => globalThis.ScrollHideConstants?.DEFAULT_SYNC_STATE ?? {};

  const getSyncState = async () => {
    const defaults = getDefaultSyncState();
    return hasSyncStorage() ? chrome.storage.sync.get(defaults) : { ...defaults };
  };

  const setSyncValue = async (value) => {
    if (hasSyncStorage()) await chrome.storage.sync.set(value);
  };

  const applyTheme = (theme, target = globalThis.document?.documentElement) => {
    if (!target) return;
    if (theme === 'light' || theme === 'dark') {
      target.setAttribute('data-theme', theme);
    } else {
      target.removeAttribute('data-theme');
    }
  };

  const ScrollHideStorage = {
    getSyncState,
    setSyncValue,
    applyTheme,
  };

  // Global assignment for the service worker & HTML script tags
  globalThis.ScrollHideStorage = ScrollHideStorage;
})();
