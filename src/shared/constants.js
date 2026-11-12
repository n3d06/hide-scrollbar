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
    // Pages where the browser blocks all extensions (CSS can't be injected).
    // Chrome has no official list; this follows Chromium source + Firefox's
    // extensions.webextensions.restrictedDomains pref.
    RESTRICTED_PROTOCOLS: [
      'about:',
      'chrome:',
      'chrome-extension:',
      'chrome-search:',
      'chrome-untrusted:',
      'devtools:',
      'edge:',
      'moz-extension:',
      'resource:',
      'view-source:',
    ],
    RESTRICTED_HOSTS: [
      // Chrome Web Store
      'chromewebstore.google.com',
      // Mozilla (Firefox restrictedDomains)
      'accounts-static.cdn.mozilla.net',
      'accounts.firefox.com',
      'addons.cdn.mozilla.net',
      'addons.mozilla.org',
      'api.accounts.firefox.com',
      'content.cdn.mozilla.net',
      'discovery.addons.mozilla.org',
      'install.mozilla.org',
      'oauth.accounts.firefox.com',
      'profile.accounts.firefox.com',
      'support.mozilla.org',
      'sync.services.mozilla.com',
    ],
    // host + path prefix, for stores that live under a shared domain
    RESTRICTED_PATHS: ['chrome.google.com/webstore', 'microsoftedge.microsoft.com/addons'],
    STORAGE_KEYS,
    OFF_ATTR: 'data-scrollhide-off',
    SCRIPT_ID: 'scrollhide-css',
    STYLE_ID: 'hide-scrollbar-style', // legacy <style> id (before 2.2), removed on update
  };

  // Global assignment for the service worker & HTML script tags
  globalThis.ScrollHideConstants = ScrollHideConstants;
})();
