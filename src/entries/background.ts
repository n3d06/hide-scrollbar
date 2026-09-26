export {};

import type { CachedState, ExtensionMessage } from '../shared/types';

declare function importScripts(...urls: string[]): void;

if (typeof importScripts === 'function') {
  importScripts(
    '/src/shared/logger.js',
    '/src/shared/constants.js',
    '/src/shared/storage.js',
    '/src/features/whitelist.js'
  );
}

const { ICONS_ACTIVE, ICONS_INACTIVE } = (globalThis as any).ScrollHideConstants || {};
const { getSyncState } = (globalThis as any).ScrollHideStorage || {};
const { isRestrictedUrl, isWhitelisted } = (globalThis as any).ScrollHideWhitelist || {};
const { log } = (globalThis as any).ScrollHideLogger || { log: { warn: () => {}, error: () => {} } };

// In-memory cache for Service Worker lifespan + native chrome.storage.session
let cachedState: CachedState | null = null;

const getCachedSyncState = async (): Promise<CachedState> => {
  if (cachedState) return cachedState;

  // Try native chrome.storage.session (RAM-backed, survives SW restarts)
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    try {
      const res = await chrome.storage.session.get('cachedState');
      if (res && res.cachedState) {
        cachedState = res.cachedState as CachedState;
        return cachedState;
      }
    } catch (_) {}
  }

  if (!getSyncState) return { scrollbarHidden: true, whitelist: [] };
  const state = await getSyncState();
  cachedState = {
    scrollbarHidden: state.scrollbarHidden !== false,
    whitelist: Array.isArray(state.whitelist) ? state.whitelist : [],
  };

  // Cache into native chrome.storage.session
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    chrome.storage.session.set({ cachedState }).catch(() => {});
  }

  return cachedState;
};

// ICONS_ACTIVE & ICONS_INACTIVE are now sourced from ScrollHideConstants

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
      tabUrl = tab?.url;
    } catch (_) {
      tabUrl = undefined;
    }
  } else {
    tabId = tabOrId.id;
    tabUrl = tabOrId.url;
  }

  if (tabId === undefined) return;

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
  chrome.action.setBadgeText({ text: '', tabId }).catch(e => log.warn('setBadgeText failed', e));

  const active = !restricted && scrollbarHidden && !whitelisted;
  chrome.action.setIcon({
    path: active ? ICONS_ACTIVE : ICONS_INACTIVE,
    tabId,
  }).catch(e => log.warn('setIcon failed', e));
};

const updateBadgeForTab = async (tabId: number | undefined): Promise<void> => {
  if (tabId === undefined) return;
  const { scrollbarHidden, whitelist } = await getCachedSyncState();
  await updateBadge(tabId, scrollbarHidden, whitelist);
};

const updateAllBadges = async (): Promise<void> => {
  const { scrollbarHidden, whitelist } = await getCachedSyncState();
  chrome.action.setIcon({
    path: scrollbarHidden ? ICONS_ACTIVE : ICONS_INACTIVE,
  }).catch(e => log.warn('setIcon (global) failed', e));
  try {
    const tabs = await chrome.tabs.query({});
    tabs.forEach((tab) => updateBadge(tab, scrollbarHidden, whitelist));
  } catch (e) {
    log.warn('tabs.query failed', e);
  }
};

const injectAllTabs = async (): Promise<void> => {
  const { scrollbarHidden, whitelist } = await getCachedSyncState();

  try {
    const tabs = await chrome.tabs.query({});
    tabs.forEach((tab) => {
      updateBadge(tab, scrollbarHidden, whitelist);

      if (tab.id && tab.url && (!isRestrictedUrl || !isRestrictedUrl(tab.url)) && chrome.scripting) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['src/entries/content.js'],
        }).catch(e => log.warn('scripting.executeScript failed', e));
      }
    });
  } catch (e) {
    log.warn('tabs.query failed', e);
  }
};

chrome.tabs.onActivated.addListener(({ tabId }) => updateBadgeForTab(tabId));

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' || info.status === 'complete' || info.url) {
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
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      if (cachedState) {
        chrome.storage.session.set({ cachedState }).catch(() => {});
      } else {
        chrome.storage.session.remove('cachedState').catch(() => {});
      }
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
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      chrome.storage.session.set({ cachedState }).catch(() => {});
    }
  }
  await chrome.storage.sync.set({ scrollbarHidden: newState });
  updateAllBadges().catch(() => {});
};

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-scrollbar') {
    handleToggleScrollbar();
  }
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message && message.action === 'toggle-scrollbar') {
    handleToggleScrollbar()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  } else if (message && message.action === 'update-icons') {
    cachedState = null;
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      chrome.storage.session.remove('cachedState').catch(() => {});
    }
    updateAllBadges()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: true }));
    return true;
  }
  sendResponse({ ok: true });
  return false;
});

