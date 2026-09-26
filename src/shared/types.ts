/**
 * Type definitions for Hide Scrollbar Extension
 */

export type ThemeMode = 'system' | 'light' | 'dark';

export interface StorageData {
  scrollbarHidden?: boolean;
  whitelist?: string[];
  theme?: ThemeMode;
}

/** Strictly typed default state matching StorageData */
export type DefaultSyncState = Required<StorageData>;

/** Cached state used in memory by service worker */
export type CachedState = Required<Pick<StorageData, 'scrollbarHidden' | 'whitelist'>>;

export interface IconPaths {
  16: string;
  32: string;
  48: string;
  128: string;
  [size: number]: string;
}

export type ExtensionMessage =
  | { action: 'toggle-scrollbar' }
  | { action: 'update-icons' };
