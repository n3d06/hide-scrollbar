// Chrome runs this as a service worker and loads dependencies here.
// Firefox runs it as an event page; manifest.firefox.json lists the dependencies instead.
if (typeof importScripts === 'function') {
  importScripts('/shared/constants.js', '/shared/storage.js', '/features/whitelist.js');
}

const { getHideCount, getSyncState, normalizeSyncState, setHideCount } = globalThis.ScrollHideStorage;
const { applyInFrame, buildMatcher, isRestrictedUrl, shouldHideOn, whitelistToExcludeMatches } =
  globalThis.ScrollHideWhitelist;
const { CSS_FILE, CSS_MARKER, ICONS, OFF_ATTR, SCRIPT_ID, STYLE_ID } = globalThis.ScrollHideConstants;

const ignore = () => {};

/* ── State ────────────────────────────────────────────────── */

// In-memory cache for the service worker lifetime
/** @type {SyncState | null} */
let cachedState = null;

const getState = async () => (cachedState ??= await getSyncState());

// Run async jobs one after another (avoids register/unregister races on fast toggles)
let queue = Promise.resolve();
const enqueue = (job) => {
  queue = queue.then(job).catch((err) => console.error('[Background]', err));
  return queue;
};

/* ── Toolbar icon ─────────────────────────────────────────── */

// setIcon({ path }) makes the browser fetch and decode every PNG on every call. Decode the
// two icon sets once and pass the pixels instead; fall back to paths if decoding fails.
const decodeIconSet = async (paths) => {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([size, path]) => {
      const blob = await (await fetch(chrome.runtime.getURL(path))).blob();
      const bitmap = await createImageBitmap(blob);
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
      if (!context) throw new Error('No 2D canvas');
      context.drawImage(bitmap, 0, 0);
      return [size, context.getImageData(0, 0, bitmap.width, bitmap.height)];
    }),
  );
  return Object.fromEntries(entries);
};

/** @type {Promise<{ active: Record<string, ImageData>, inactive: Record<string, ImageData> } | null> | null} */
let decodedIcons = null;

const iconDetails = async (active) => {
  decodedIcons ??= Promise.all([decodeIconSet(ICONS.active), decodeIconSet(ICONS.inactive)])
    .then(([activeSet, inactiveSet]) => ({ active: activeSet, inactive: inactiveSet }))
    .catch(() => null);
  const icons = await decodedIcons;
  if (icons) return { imageData: active ? icons.active : icons.inactive };
  return { path: active ? ICONS.active : ICONS.inactive };
};

// Icon last set per tab (and for the default), so unchanged tabs are skipped.
// Lost when the service worker stops; the next update then simply sets every tab again.
/** @type {Map<number, boolean>} */
const tabIcons = new Map();
/** @type {boolean | null} */
let defaultIcon = null;

const setTabIcon = async (tabId, active, { force = false } = {}) => {
  if (!force && tabIcons.get(tabId) === active) return;
  tabIcons.set(tabId, active); // before the await, so overlapping calls don't repeat it
  try {
    await chrome.action.setIcon({ tabId, ...(await iconDetails(active)) });
  } catch (_) {
    tabIcons.delete(tabId); // tab closed meanwhile
  }
};

const updateTabIcon = (tab, state, options) => {
  if (tab?.id === undefined || tab.id < 0) return;
  setTabIcon(tab.id, shouldHideOn(tab.url, state), options);
};

const updateAllIcons = async (state, tabs) => {
  if (defaultIcon !== state.scrollbarHidden) {
    defaultIcon = state.scrollbarHidden;
    await chrome.action.setIcon(await iconDetails(state.scrollbarHidden)).catch(ignore);
  }
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
    await chrome.scripting.updateContentScripts([{ id: SCRIPT_ID, css: [CSS_FILE], excludeMatches }]);
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

const FRAME_NAMES = { offAttr: OFF_ATTR, marker: CSS_MARKER, legacyStyleId: STYLE_ID };

// Brings already-open tabs in line with the state, without a reload. The stylesheet is
// inserted only into frames that lack it, so pages that already have it are not restyled.
const syncOpenTabs = async ({ scrollbarHidden, whitelist }, tabs) => {
  const matcher = buildMatcher(whitelist);

  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined || tab.id < 0 || !tab.url || isRestrictedUrl(tab.url)) return;
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: applyInFrame,
          args: [scrollbarHidden, matcher, FRAME_NAMES],
        });
        const frameIds = results.filter((r) => r.result === true).map((r) => r.frameId);
        if (frameIds.length) {
          await chrome.scripting.insertCSS({ target: { tabId: tab.id, frameIds }, files: [CSS_FILE] });
        }
      } catch (_) {
        // Tab not scriptable (Web Store, PDF viewer, discarded tab, ...)
      }
    }),
  );
};

const applyState = (state) =>
  enqueue(async () => {
    const tabs = await chrome.tabs.query({});
    await Promise.all([updateAllIcons(state, tabs), syncRegisteredCss(state).then(() => syncOpenTabs(state, tabs))]);
  });

/* ── Statistics ───────────────────────────────────────────── */

const incrementHideCount = () =>
  enqueue(async () => {
    await setHideCount((await getHideCount()) + 1);
  });

/* ── Events ───────────────────────────────────────────────── */

chrome.runtime.onInstalled.addListener(async () => {
  applyState(await getState());
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  enqueue(() => syncRegisteredCss(state));
  updateAllIcons(state, await chrome.tabs.query({})).catch(ignore);
});

// Firefox lets users revoke site access; re-apply once it is granted again
chrome.permissions?.onAdded?.addListener(async () => {
  applyState(await getState());
});

chrome.tabs.onUpdated.addListener(async (_tabId, info, tab) => {
  if (!info.url && !info.status) return;
  const state = await getState();
  if (info.url || info.status === 'loading') {
    // Firefox resets a tab's icon when it navigates, so don't trust what was set before
    updateTabIcon(tab, state, { force: true });
  }
  if (info.status === 'complete' && shouldHideOn(tab.url, state)) {
    incrementHideCount();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabIcons.delete(tabId);
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
  for (const [key, { newValue }] of Object.entries(changes)) state[key] = newValue;
  cachedState = normalizeSyncState(state);
  applyState(cachedState);
});

/* ── Keyboard shortcut ────────────────────────────────────── */

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-scrollbar') return;
  const { scrollbarHidden } = await getState();
  // storage.onChanged applies the new state
  await chrome.storage.sync.set({ scrollbarHidden: !scrollbarHidden });
});
