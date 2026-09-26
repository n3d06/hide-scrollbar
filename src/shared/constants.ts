import type { DefaultSyncState, IconPaths } from './types';

export const STORAGE_KEYS = {
  scrollbarHidden: 'scrollbarHidden',
  whitelist: 'whitelist',
  theme: 'theme',
} as const;

export const DEFAULT_SYNC_STATE: DefaultSyncState = {
  [STORAGE_KEYS.scrollbarHidden]: true,
  [STORAGE_KEYS.whitelist]: [],
  [STORAGE_KEYS.theme]: 'system',
};

export const ScrollHideConstants = {
  BACKUP_FILENAME: 'scrollhide-backup.json',
  BADGE_ACTIVE_COLOR: '#2772ed',
  BADGE_INACTIVE_COLOR: '#64748b',
  DEFAULT_SYNC_STATE,
  ICONS_ACTIVE: {
    16: 'assets/icons/icon16.png',
    32: 'assets/icons/icon32.png',
    48: 'assets/icons/icon48.png',
    128: 'assets/icons/icon128.png',
  } as IconPaths,
  ICONS_INACTIVE: {
    16: 'assets/icons/icon16-off.png',
    32: 'assets/icons/icon32-off.png',
    48: 'assets/icons/icon48-off.png',
    128: 'assets/icons/icon128-off.png',
  } as IconPaths,
  RESTRICTED_HOSTS: [] as string[],
  RESTRICTED_PROTOCOLS: [
    'chrome:',
    'chrome-extension:',
    'edge:',
    'about:',
    'view-source:',
    'devtools:',
  ],
  STORAGE_KEYS,
  STYLE_ID: 'hide-scrollbar-style',
};

// Global assignment for classic content script & HTML script tags
(globalThis as unknown as { ScrollHideConstants: typeof ScrollHideConstants }).ScrollHideConstants = ScrollHideConstants;
