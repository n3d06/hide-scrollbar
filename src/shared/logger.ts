/**
 * Dev-only structured logger for Hide Scrollbar Extension.
 * Logs are suppressed in production (Web Store installs have `update_url` in manifest).
 */

const isDev = (): boolean => {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.getManifest) return true;
    return !('update_url' in chrome.runtime.getManifest());
  } catch (_) {
    return false;
  }
};

const _isDev = isDev();

export const log = {
  info: (msg: string, ctx?: unknown): void => {
    if (_isDev) console.log(`[ScrollHide] ${msg}`, ctx !== undefined ? ctx : '');
  },
  warn: (msg: string, ctx?: unknown): void => {
    if (_isDev) console.warn(`[ScrollHide] ${msg}`, ctx !== undefined ? ctx : '');
  },
  error: (msg: string, ctx?: unknown): void => {
    if (_isDev) console.error(`[ScrollHide] ${msg}`, ctx !== undefined ? ctx : '');
  },
};

export const ScrollHideLogger = { log };

// Global assignment for HTML script tags
(globalThis as unknown as { ScrollHideLogger: typeof ScrollHideLogger }).ScrollHideLogger = ScrollHideLogger;
