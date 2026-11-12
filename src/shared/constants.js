(() => {
  const STORAGE_KEYS = {
    scrollbarHidden: 'scrollbarHidden',
    whitelist: 'whitelist',
    theme: 'theme',
  };

  const DEFAULT_SYNC_STATE = {
    [STORAGE_KEYS.scrollbarHidden]: true,
    [STORAGE_KEYS.whitelist]: [],
    [STORAGE_KEYS.theme]: 'system',
  };

  const ScrollHideConstants = {
    BACKUP_FILENAME: 'scrollhide-backup.json',
    CSS_FILE: 'assets/styles/hide-scrollbar.css',
    DEFAULT_SYNC_STATE,
    RESTRICTED_HOSTS: [
      // Firefox blocks extensions on these Mozilla pages
      'addons.mozilla.org',
      'accounts.firefox.com',
      'support.mozilla.org',
    ],
    RESTRICTED_PROTOCOLS: ['chrome:', 'chrome-extension:', 'edge:', 'about:', 'view-source:', 'devtools:', 'moz-extension:', 'resource:'],
    STORAGE_KEYS,
    OFF_ATTR: 'data-scrollhide-off',
    SCRIPT_ID: 'scrollhide-css',
    STYLE_ID: 'hide-scrollbar-style', // legacy <style> id (before 2.2), removed on update
  };

  // Global assignment for the service worker & HTML script tags
  globalThis.ScrollHideConstants = ScrollHideConstants;
})();
