import { ScrollHideConstants } from '../shared/constants';
import { getSyncState } from '../shared/storage';
import { isWhitelisted, isRestrictedUrl } from '../features/whitelist';

(function () {
  const STYLE_ID = ScrollHideConstants?.STYLE_ID || 'hide-scrollbar-style';

  const CSS_TEXT =
    '::-webkit-scrollbar,::-webkit-scrollbar-thumb,::-webkit-scrollbar-track,::-webkit-scrollbar-corner,::-webkit-scrollbar-button{display:none!important;background:transparent!important;width:0!important;height:0!important}html,body,*{scrollbar-width:none!important;-ms-overflow-style:none!important}div[data-visualcompletion="ignore"][data-thumb="1"],.os-scrollbar,.os-scrollbar-track,.os-scrollbar-handle,.simplebar-scrollbar,.simplebar-track,.ps__rail-x,.ps__rail-y,.nicescroll-rails,.mCSB_scrollTools,.mCSB_dragger,.nano-pane,.nano-slider,.mac-scrollbar{display:none!important;visibility:hidden!important;opacity:0!important;width:0!important;height:0!important}';

  const SESSION_CACHE_KEY = '__scrollhide_state__';

  const readSessionCache = (): boolean | null => {
    try {
      const val = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (val === '0') return false;
      if (val === '1') return true;
    } catch (_) {}
    return null;
  };

  const writeSessionCache = (hide: boolean): void => {
    try {
      sessionStorage.setItem(SESSION_CACHE_KEY, hide ? '1' : '0');
    } catch (_) {}
  };

  const applyStyle = (hide: boolean): void => {
    let style = document.getElementById(STYLE_ID);
    if (hide) {
      if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS_TEXT;
        const target = document.head || document.documentElement;
        if (target) {
          target.appendChild(style);
        } else {
          const observer = new MutationObserver(() => {
            const el = document.head || document.documentElement;
            if (el) {
              if (!document.getElementById(STYLE_ID)) {
                el.appendChild(style!);
              }
              observer.disconnect();
            }
          });
          observer.observe(document, { childList: true });
          document.addEventListener('DOMContentLoaded', () => {
            observer.disconnect();
            if (!document.getElementById(STYLE_ID)) {
              (document.head || document.documentElement)?.appendChild(style!);
            }
          }, { once: true });
        }
      }
    } else if (style) {
      style.remove();
    }
  };

  // Instant zero-latency injection at document_start to eliminate Flash of Scrollbar
  const isRestricted = isRestrictedUrl ? isRestrictedUrl(window.location.href) : false;
  if (!isRestricted) {
    const cached = readSessionCache();
    if (cached !== false) {
      applyStyle(true);
    }
  }

  let hasIncremented = false;

  let currentContentState: { scrollbarHidden: boolean; whitelist: string[] } = {
    scrollbarHidden: true,
    whitelist: [],
  };

  const update = async (
    forcedState?: { scrollbarHidden?: boolean; whitelist?: string[] }
  ): Promise<void> => {
    if (!getSyncState || typeof chrome === 'undefined' || !chrome.runtime?.id) return;
    try {
      if (forcedState) {
        if (forcedState.scrollbarHidden !== undefined) {
          currentContentState.scrollbarHidden = forcedState.scrollbarHidden;
        }
        if (forcedState.whitelist !== undefined) {
          currentContentState.whitelist = forcedState.whitelist;
        }
      } else {
        const state = await getSyncState();
        if (state) {
          currentContentState = {
            scrollbarHidden: state.scrollbarHidden !== false,
            whitelist: Array.isArray(state.whitelist) ? (state.whitelist as string[]) : [],
          };
        }
      }

      const isWhite = isWhitelisted
        ? isWhitelisted(window.location.hostname, currentContentState.whitelist)
        : false;
      const shouldHide =
        currentContentState.scrollbarHidden !== false && !isWhite && !isRestricted;

      writeSessionCache(shouldHide);
      applyStyle(shouldHide);

      // Defer analytics counter write to browser idle time so it never competes with initial page rendering
      if (shouldHide && !hasIncremented && window === window.top && typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
        hasIncremented = true;
        const incrementCounter = () => {
          try {
            if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.storage?.local) return;
            chrome.storage.local.get({ hideCount: 0 }, (res) => {
              if (chrome.runtime?.lastError || !chrome.runtime?.id) return;
              chrome.storage.local.set({ hideCount: ((res?.hideCount as number) || 0) + 1 });
            });
          } catch (_) {}
        };

        if ('requestIdleCallback' in window) {
          (window as any).requestIdleCallback(incrementCounter, { timeout: 3000 });
        } else {
          setTimeout(incrementCounter, 1000);
        }
      }
    } catch (err: any) {
      if (err?.message?.includes('Extension context invalidated')) {
        return;
      }
      console.error('[Content] Failed to read sync state', { error: err });
    }
  };

  update();

  if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.onChanged) {
    try {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
        if (namespace === 'sync' && (changes.scrollbarHidden || changes.whitelist)) {
          const partial: { scrollbarHidden?: boolean; whitelist?: string[] } = {};
          if (changes.scrollbarHidden) {
            partial.scrollbarHidden = Boolean(changes.scrollbarHidden.newValue);
          }
          if (changes.whitelist && Array.isArray(changes.whitelist.newValue)) {
            partial.whitelist = changes.whitelist.newValue as string[];
          }
          update(partial);
        }
      });
    } catch (_) {}
  }
})();
