export {};

declare function importScripts(...urls: string[]): void;

if (typeof importScripts === 'function') {
  importScripts(
    '/src/shared/constants.js',
    '/src/shared/storage.js',
    '/src/features/whitelist.js'
  );
}

const { BADGE_ACTIVE_COLOR, BADGE_INACTIVE_COLOR } = (globalThis as any).ScrollHideConstants || {
  BADGE_ACTIVE_COLOR: '#2772ed',
  BADGE_INACTIVE_COLOR: '#888',
};
const { getSyncState } = (globalThis as any).ScrollHideStorage || {};
const { isRestrictedUrl, isWhitelisted } = (globalThis as any).ScrollHideWhitelist || {};

// In-memory cache for Service Worker lifespan to avoid repeated storage disk/IPC reads
let cachedState: { scrollbarHidden: boolean; whitelist: string[] } | null = null;

const getCachedSyncState = async (): Promise<{ scrollbarHidden: boolean; whitelist: string[] }> => {
  if (cachedState) return cachedState;
  if (!getSyncState) return { scrollbarHidden: true, whitelist: [] };
  const state = await getSyncState();
  cachedState = {
    scrollbarHidden: state.scrollbarHidden !== false,
    whitelist: Array.isArray(state.whitelist) ? state.whitelist : [],
  };
  return cachedState;
};

const ICONS_ACTIVE = {
  16: '/assets/icons/icon16.png',
  32: '/assets/icons/icon32.png',
  48: '/assets/icons/icon48.png',
  128: '/assets/icons/icon128.png',
};

const ICONS_INACTIVE = {
  16: '/assets/icons/icon16-off.png',
  32: '/assets/icons/icon32-off.png',
  48: '/assets/icons/icon48-off.png',
  128: '/assets/icons/icon128-off.png',
};

const safeSetBadgeText = (details: chrome.action.BadgeTextDetails): void => {
  if (typeof chrome === 'undefined' || !chrome.action?.setBadgeText) return;
  try {
    chrome.action.setBadgeText(details, () => {
      void chrome.runtime?.lastError;
    });
  } catch (_) {}
};

const safeSetIcon = (details: chrome.action.TabIconDetails): void => {
  if (typeof chrome === 'undefined' || !chrome.action?.setIcon) return;
  try {
    chrome.action.setIcon(details, () => {
      void chrome.runtime?.lastError;
    });
  } catch (_) {}
};

const updateBadge = async (
  tabOrId: chrome.tabs.Tab | number | undefined,
  scrollbarHidden: boolean,
  whitelist: string[]
): Promise<void> => {
  if (tabOrId === undefined) return;
  let tabId: number | undefined;
  let tabUrl: string | undefined;

  if (typeof tabOrId === 'number') {
    tabId = tabOrId;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab || tab.id === undefined) return;
      tabUrl = tab.url;
    } catch (_) {
      // Tab closed or unavailable, stop immediately to avoid calling APIs on non-existent tab
      return;
    }
  } else {
    tabId = tabOrId.id;
    tabUrl = tabOrId.url;
  }

  if (tabId === undefined || tabId < 0) return;

  let restricted = false;
  let whitelisted = false;

  if (tabUrl) {
    restricted = isRestrictedUrl ? isRestrictedUrl(tabUrl) : false;
    if (!restricted && isWhitelisted) {
      try {
        whitelisted = isWhitelisted(new URL(tabUrl).hostname, whitelist);
      } catch (_) {
        whitelisted = false;
      }
    }
  } else {
    restricted = true;
  }

  // Clear badge text completely for a clean look
  safeSetBadgeText({ text: '', tabId });

  const active = !restricted && scrollbarHidden && !whitelisted;
  safeSetIcon({
    path: active ? ICONS_ACTIVE : ICONS_INACTIVE,
    tabId,
  });
};

const updateBadgeForTab = async (tabId: number | undefined): Promise<void> => {
  if (tabId === undefined || tabId < 0) return;
  const { scrollbarHidden, whitelist } = await getCachedSyncState();
  await updateBadge(tabId, scrollbarHidden, whitelist);
};

const updateAllBadges = async (): Promise<void> => {
  const { scrollbarHidden, whitelist } = await getCachedSyncState();
  safeSetIcon({
    path: scrollbarHidden ? ICONS_ACTIVE : ICONS_INACTIVE,
  });
  if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime?.lastError || !Array.isArray(tabs)) return;
      tabs.forEach((tab) => {
        if (tab && tab.id !== undefined && tab.id >= 0) {
          updateBadge(tab, scrollbarHidden, whitelist);
        }
      });
    });
  }
};

const injectAllTabs = async (): Promise<void> => {
  const { scrollbarHidden, whitelist } = await getCachedSyncState();

  if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime?.lastError || !Array.isArray(tabs)) return;
      tabs.forEach((tab) => {
        if (!tab || tab.id === undefined || tab.id < 0) return;
        updateBadge(tab, scrollbarHidden, whitelist);

        if (tab.url && (!isRestrictedUrl || !isRestrictedUrl(tab.url)) && chrome.scripting?.executeScript) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: [
              'src/shared/constants.js',
              'src/shared/storage.js',
              'src/features/whitelist.js',
              'src/entries/content.js',
            ],
          }, () => {
            void chrome.runtime?.lastError;
          });
        }
      });
    });
  }
};

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (tabId !== undefined && tabId >= 0) {
    updateBadgeForTab(tabId);
  }
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId !== undefined && tabId >= 0 && (info.status === 'loading' || info.status === 'complete' || info.url)) {
    updateBadgeForTab(tabId);
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    if (cachedState) {
      if (changes.scrollbarHidden) {
        cachedState.scrollbarHidden = Boolean(changes.scrollbarHidden.newValue);
      }
      if (changes.whitelist && Array.isArray(changes.whitelist.newValue)) {
        cachedState.whitelist = changes.whitelist.newValue as string[];
      }
    } else {
      cachedState = null;
    }
    updateAllBadges().catch(() => {});
  }
});

// Initialize tabs injection upon installation or update
chrome.runtime.onInstalled.addListener(() => {
  updateAllBadges().catch(() => {});
  injectAllTabs().catch(() => {});
});

// Run immediately whenever the service worker activates/wakes up
updateAllBadges().catch(() => {});

/* ── Keyboard Shortcuts & Messages ────────────────────────── */

const handleToggleScrollbar = async (): Promise<void> => {
  const { scrollbarHidden } = await getCachedSyncState();
  const newState = !scrollbarHidden;
  if (cachedState) {
    cachedState.scrollbarHidden = newState;
  }
  await chrome.storage.sync.set({ scrollbarHidden: newState });
  updateAllBadges().catch(() => {});
};

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-scrollbar') {
    handleToggleScrollbar();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.action === 'toggle-scrollbar') {
    handleToggleScrollbar()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  } else if (message && message.action === 'update-icons') {
    cachedState = null;
    updateAllBadges()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: true }));
    return true;
  }
  sendResponse({ ok: true });
  return false;
});

