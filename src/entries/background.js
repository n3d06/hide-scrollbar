// Chrome runs this as a service worker and loads dependencies here.
// Firefox runs it as an event page; manifest.firefox.json lists the dependencies instead.
if (typeof importScripts === 'function') {
  importScripts('/shared/constants.js', '/shared/storage.js', '/features/whitelist.js');
}

const { getSyncState } = globalThis.ScrollHideStorage;
const { buildMatcher, isRestrictedUrl, isWhitelisted, whitelistToExcludeMatches } = globalThis.ScrollHideWhitelist;
const { CSS_FILE, OFF_ATTR, SCRIPT_ID, STYLE_ID } = globalThis.ScrollHideConstants;

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

const ignore = () => {};

/* ── State ────────────────────────────────────────────────── */

// In-memory cache for the service worker lifetime
let cachedState = null;

const getState = async () => {
  if (cachedState) return cachedState;
  const state = await getSyncState();
  cachedState = {
    scrollbarHidden: state.scrollbarHidden !== false,
    whitelist: Array.isArray(state.whitelist) ? state.whitelist : [],
  };
  return cachedState;
};

const isActiveFor = (url, { scrollbarHidden, whitelist }) => {
  if (!scrollbarHidden || !url || isRestrictedUrl(url)) return false;
  try {
    return !isWhitelisted(new URL(url).hostname, whitelist);
  } catch (_) {
    return false;
  }
};

// Run async jobs one after another (avoids register/unregister races on fast toggles)
let queue = Promise.resolve();
const enqueue = (job) => {
  queue = queue.then(job).catch((err) => console.error('[Background]', err));
  return queue;
};

/* ── Toolbar icon ─────────────────────────────────────────── */

const setIcon = (details) => chrome.action.setIcon(details).catch(ignore);

const updateTabIcon = (tab, state) => {
  if (tab?.id === undefined || tab.id < 0) return;
  setIcon({ tabId: tab.id, path: isActiveFor(tab.url, state) ? ICONS_ACTIVE : ICONS_INACTIVE });
};

const updateAllIcons = async (state) => {
  setIcon({ path: state.scrollbarHidden ? ICONS_ACTIVE : ICONS_INACTIVE });
  const tabs = await chrome.tabs.query({});
  tabs.forEach((tab) => updateTabIcon(tab, state));
};

/* ── Registered CSS (new page loads) ──────────────────────── */

const syncRegisteredCss = async ({ scrollbarHidden, whitelist }) => {
  const [existing] = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });

  if (!scrollbarHidden) {
    if (existing) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return;
  }

  const excludeMatches = whitelistToExcludeMatches(whitelist);
  if (existing) {
    // Atomic update: no window where new pages load without the stylesheet
    await chrome.scripting.updateContentScripts([{ id: SCRIPT_ID, excludeMatches }]);
    return;
  }

  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches: ['<all_urls>'],
      excludeMatches,
      css: [CSS_FILE],
      allFrames: true,
      runAt: 'document_start',
      persistAcrossSessions: true,
    },
  ]);
};

/* ── Already-open tabs (no reload needed) ─────────────────── */

// Runs inside every frame. Must be self-contained: executeScript serializes it.
function applyInFrame(hidden, exact, wildcards, offAttr, legacyStyleId) {
  const host = location.hostname;
  const whitelisted = !!host && (exact.includes(host) || wildcards.some((apex) => host.endsWith(`.${apex}`)));
  const root = document.documentElement;
  if (!root) return;
  if (hidden && !whitelisted) {
    root.removeAttribute(offAttr);
  } else {
    root.setAttribute(offAttr, '');
  }
  // Clean up the <style> injected by versions before 2.2
  document.getElementById(legacyStyleId)?.remove();
}

const syncOpenTabs = async ({ scrollbarHidden, whitelist }) => {
  const { exact, wildcards } = buildMatcher(whitelist);
  const tabs = await chrome.tabs.query({});

  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined || tab.id < 0 || !tab.url || isRestrictedUrl(tab.url)) return;
      const target = { tabId: tab.id, allFrames: true };
      try {
        if (scrollbarHidden) {
          // Frames loaded while hiding was off have no stylesheet yet; remove first to avoid duplicates
          await chrome.scripting.removeCSS({ target, files: [CSS_FILE] }).catch(ignore);
          await chrome.scripting.insertCSS({ target, files: [CSS_FILE] });
        }
        await chrome.scripting.executeScript({
          target,
          func: applyInFrame,
          args: [scrollbarHidden, exact, wildcards, OFF_ATTR, STYLE_ID],
        });
      } catch (_) {
        // Tab not scriptable (Web Store, PDF viewer, discarded tab, ...)
      }
    }),
  );
};

const applyState = (state) =>
  enqueue(async () => {
    await syncRegisteredCss(state);
    await Promise.all([syncOpenTabs(state), updateAllIcons(state)]);
  });

/* ── Statistics ───────────────────────────────────────────── */

const incrementHideCount = () =>
  enqueue(async () => {
    const { hideCount = 0 } = await chrome.storage.local.get({ hideCount: 0 });
    await chrome.storage.local.set({ hideCount: hideCount + 1 });
  });

/* ── Events ───────────────────────────────────────────────── */

chrome.runtime.onInstalled.addListener(async () => {
  applyState(await getState());
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  enqueue(() => syncRegisteredCss(state));
  updateAllIcons(state).catch(ignore);
});

// Firefox lets users revoke site access; re-apply once it is granted again
chrome.permissions?.onAdded?.addListener(async () => {
  applyState(await getState());
});

chrome.tabs.onUpdated.addListener(async (_tabId, info, tab) => {
  if (!info.url && !info.status) return;
  const state = await getState();
  if (info.url || info.status === 'loading') {
    updateTabIcon(tab, state);
  }
  if (info.status === 'complete' && isActiveFor(tab.url, state)) {
    incrementHideCount();
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const [tab, state] = await Promise.all([chrome.tabs.get(tabId), getState()]);
    updateTabIcon(tab, state);
  } catch (_) {}
});

chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace !== 'sync' || (!changes.scrollbarHidden && !changes.whitelist)) return;
  const state = { ...(await getState()) };
  if (changes.scrollbarHidden) {
    state.scrollbarHidden = changes.scrollbarHidden.newValue !== false;
  }
  if (changes.whitelist) {
    state.whitelist = Array.isArray(changes.whitelist.newValue) ? changes.whitelist.newValue : [];
  }
  cachedState = state;
  applyState(state);
});

/* ── Keyboard shortcut ────────────────────────────────────── */

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-scrollbar') return;
  const { scrollbarHidden } = await getState();
  // storage.onChanged applies the new state
  await chrome.storage.sync.set({ scrollbarHidden: !scrollbarHidden });
});
