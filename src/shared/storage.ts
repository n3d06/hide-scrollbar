import type { DefaultSyncState, StorageData } from './types';

const FALLBACK_DEFAULT_SYNC_STATE: DefaultSyncState = {
  scrollbarHidden: true,
  whitelist: [],
  theme: 'system',
};

export const getDefaultSyncState = (): DefaultSyncState => {
  const g = globalThis as unknown as { ScrollHideConstants?: { DEFAULT_SYNC_STATE: DefaultSyncState } };
  return g.ScrollHideConstants?.DEFAULT_SYNC_STATE ?? FALLBACK_DEFAULT_SYNC_STATE;
};

export const getSyncState = async (): Promise<StorageData> => {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.sync) {
      return (await chrome.storage.sync.get(getDefaultSyncState())) as StorageData;
    }
  } catch (_) {}
  return getDefaultSyncState();
};

export const setSyncValue = async (value: Partial<StorageData> | Record<string, unknown>): Promise<void> => {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.sync) {
      await chrome.storage.sync.set(value);
    }
  } catch (_) {}
};

export const applyTheme = (theme?: string, target: HTMLElement = document.documentElement): void => {
  if (!target) return;
  if (theme === 'light' || theme === 'dark') {
    target.setAttribute('data-theme', theme);
  } else {
    target.removeAttribute('data-theme');
  }
};

export const ScrollHideStorage = {
  getDefaultSyncState,
  getSyncState,
  setSyncValue,
  applyTheme,
};

// Global assignment for HTML script tags & background service worker
(globalThis as unknown as { ScrollHideStorage: typeof ScrollHideStorage }).ScrollHideStorage = ScrollHideStorage;
