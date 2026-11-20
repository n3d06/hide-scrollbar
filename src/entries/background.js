// Chrome runs this as a service worker and loads dependencies here.
// Firefox runs it as an event page; manifest.firefox.json lists the dependencies instead.
if (typeof importScripts === 'function') {
  importScripts('/shared/constants.js', '/shared/storage.js', '/features/whitelist.js');
}

const { getHideCount, getSyncState, normalizeSyncState, setHideCount } = globalThis.ScrollHideStorage;
const { buildMatcher, isRestrictedUrl, shouldHideOn, whitelistToExcludeMatches } = globalThis.ScrollHideWhitelist;
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

const setIcon = (details) => chrome.action.setIcon(details).catch(ignore);

const updateTabIcon = (tab, state) => {
  if (tab?.id === undefined || tab.id < 0) return;
  setIcon({ tabId: tab.id, path: shouldHideOn(tab.url, state) ? ICONS.active : ICONS.inactive });
};

const updateAllIcons = async (state) => {
  setIcon({ path: state.scrollbarHidden ? ICONS.active : ICONS.inactive });
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

// Runs inside every frame. Must be self-contained: executeScript serializes it.
// Turns hiding on or off for this frame (by its own hostname, so embedded frames follow
// their own whitelist rule) and returns true if the frame should hide but has no stylesheet:
// it was loaded while hiding was off, or while its site was on the whitelist.
function applyInFrame(hidden, exact, wildcards, offAttr, marker, legacyStyleId) {
  const root = document.documentElement;
  if (!root) return false;
  const host = location.hostname;
  const whitelisted = !!host && (exact.includes(host) || wildcards.some((apex) => host.endsWith(`.${apex}`)));
  const hide = hidden && !whitelisted;
  root.toggleAttribute(offAttr, !hide);
  // Clean up the <style> injected by versions before 2.2
  document.getElementById(legacyStyleId)?.remove();
  return hide && !getComputedStyle(root).getPropertyValue(marker);
}

// Brings already-open tabs in line with the state, without a reload. The stylesheet is
// inserted only into frames that lack it, so pages that already have it are not restyled.
const syncOpenTabs = async ({ scrollbarHidden, whitelist }) => {
  const { exact, wildcards } = buildMatcher(whitelist);
  const tabs = await chrome.tabs.query({});

  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined || tab.id < 0 || !tab.url || isRestrictedUrl(tab.url)) return;
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: applyInFrame,
          args: [scrollbarHidden, exact, wildcards, OFF_ATTR, CSS_MARKER, STYLE_ID],
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
  enqueue(() => Promise.all([updateAllIcons(state), syncRegisteredCss(state).then(() => syncOpenTabs(state))]));

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
  if (info.status === 'complete' && shouldHideOn(tab.url, state)) {
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
