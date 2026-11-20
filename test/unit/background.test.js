const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakeChrome, loadExtension, settle } = require('../helpers/fake-browser.js');

// Same order as manifest.firefox.json (Chrome loads them with importScripts)
const BACKGROUND = ['shared/constants.js', 'shared/storage.js', 'features/whitelist.js', 'entries/background.js'];
const SCRIPT_ID = 'scrollhide-css';

const frame = (frameId, hostname, extra = {}) => ({ frameId, hostname, hasCss: true, off: false, ...extra });

// news.com embeds a video.com iframe; one tab is a browser page, one can't be scripted
const makeTabs = () => [
  { id: 1, url: 'https://news.com/a', frames: [frame(0, 'news.com'), frame(5, 'video.com')] },
  { id: 2, url: 'https://shop.com/', frames: [frame(0, 'shop.com')] },
  { id: 3, url: 'chrome://settings/', frames: [] },
  { id: 4, url: 'https://broken.com/', unscriptable: true, frames: [] },
];

const start = async ({ sync, local, tabs = makeTabs(), globals, event = 'onInstalled' } = {}) => {
  const chrome = createFakeChrome({ sync, local, tabs });
  loadExtension(chrome, BACKGROUND, globals);
  await chrome.runtime[event].fire({ reason: 'install' });
  await settle();
  return chrome;
};

const reset = (chrome) => Object.values(chrome.calls).forEach((list) => (list.length = 0));
const setSync = async (chrome, values) => {
  await chrome.storage.sync.set(values);
  await settle();
};
const tabIconCalls = (chrome) => chrome.calls.setIcon.filter((c) => c.tabId !== undefined);
const isActiveIcon = (details) => /icon16\.png$/.test(details.path[16]);
const frameOf = (chrome, tabId, frameId) =>
  chrome.tabsData.find((t) => t.id === tabId).frames.find((f) => f.frameId === frameId);

describe('install', () => {
  test('registers the stylesheet for new page loads', async () => {
    const chrome = await start({ sync: { whitelist: ['shop.com'] } });
    assert.deepEqual(chrome.registered.get(SCRIPT_ID), {
      id: SCRIPT_ID,
      matches: ['<all_urls>'],
      excludeMatches: ['*://shop.com/*', '*://www.shop.com/*'],
      css: ['assets/styles/hide-scrollbar.css'],
      allFrames: true,
      runAt: 'document_start',
      persistAcrossSessions: true,
    });
  });

  test('hides in already-open tabs, inserting the stylesheet only where it is missing', async () => {
    const tabs = makeTabs();
    tabs[0].frames[1].hasCss = false; // iframe loaded before install
    const chrome = await start({ tabs });
    assert.equal(frameOf(chrome, 1, 0).off, false);
    assert.equal(frameOf(chrome, 1, 5).off, false);
    assert.deepEqual(chrome.calls.insertCSS, [
      { target: { tabId: 1, frameIds: [5] }, files: ['assets/styles/hide-scrollbar.css'] },
    ]);
  });

  test('skips browser pages and survives tabs it cannot script', async () => {
    const chrome = await start();
    const scripted = chrome.calls.executeScript.map((c) => c.tabId).sort();
    assert.deepEqual(scripted, [1, 2, 4]); // not 3 (chrome://); 4 throws and is ignored
    assert.equal(frameOf(chrome, 2, 0).off, false);
  });

  test('sets the default icon and one icon per tab', async () => {
    const chrome = await start({ sync: { whitelist: ['shop.com'] } });
    const byTab = Object.fromEntries(tabIconCalls(chrome).map((c) => [c.tabId, isActiveIcon(c)]));
    assert.deepEqual(byTab, { 1: true, 2: false, 3: false, 4: true });
    assert.equal(chrome.calls.setIcon.filter((c) => c.tabId === undefined).length, 1);
  });
});

describe('turning hiding off and on', () => {
  test('off: unregisters the stylesheet and shows scrollbars in open tabs', async () => {
    const chrome = await start();
    reset(chrome);
    await setSync(chrome, { scrollbarHidden: false });
    assert.equal(chrome.registered.has(SCRIPT_ID), false);
    assert.equal(frameOf(chrome, 1, 0).off, true);
    assert.equal(frameOf(chrome, 1, 5).off, true);
    assert.equal(chrome.calls.insertCSS.length, 0);
  });

  test('on again: re-registers, and inserts only into frames loaded while off', async () => {
    const chrome = await start({ sync: { scrollbarHidden: false } });
    chrome.tabsData.push({ id: 9, url: 'https://new.com/', frames: [frame(0, 'new.com', { hasCss: false })] });
    reset(chrome);
    await setSync(chrome, { scrollbarHidden: true });
    assert.equal(chrome.registered.has(SCRIPT_ID), true);
    assert.deepEqual(
      chrome.calls.insertCSS.map((c) => c.target),
      [{ tabId: 9, frameIds: [0] }],
    );
    assert.equal(frameOf(chrome, 9, 0).off, false);
  });

  test('fast toggles are applied in order and end in the last state', async () => {
    const chrome = await start();
    for (const value of [false, true, false, true, false]) chrome.storage.sync.set({ scrollbarHidden: value });
    await settle();
    assert.equal(chrome.registered.has(SCRIPT_ID), false);
    assert.equal(frameOf(chrome, 2, 0).off, true);
  });

  test('keyboard shortcut flips the stored value', async () => {
    const chrome = await start();
    await chrome.commands.onCommand.fire('toggle-scrollbar');
    await settle();
    assert.equal(chrome.storage.sync.data.scrollbarHidden, false);
    await chrome.commands.onCommand.fire('something-else');
    assert.equal(chrome.storage.sync.data.scrollbarHidden, false);
  });
});

describe('whitelist changes', () => {
  test('updates the registered exclusions in place', async () => {
    const chrome = await start();
    reset(chrome);
    await setSync(chrome, { whitelist: ['video.com'] });
    assert.deepEqual(chrome.calls.update, [
      {
        id: SCRIPT_ID,
        css: ['assets/styles/hide-scrollbar.css'],
        excludeMatches: ['*://video.com/*', '*://www.video.com/*'],
      },
    ]);
    assert.equal(chrome.calls.register.length + chrome.calls.unregister.length, 0);
  });

  test('an embedded frame follows its own site rule, without restyling anything', async () => {
    const chrome = await start();
    reset(chrome);
    await setSync(chrome, { whitelist: ['video.com'] });
    assert.equal(frameOf(chrome, 1, 5).off, true); // video.com iframe shows its scrollbar
    assert.equal(frameOf(chrome, 1, 0).off, false); // news.com page still hides
    assert.equal(chrome.calls.insertCSS.length, 0);
  });

  test('removing a site that loaded while whitelisted inserts the stylesheet there only', async () => {
    const tabs = makeTabs();
    tabs[1].frames[0].hasCss = false; // shop.com loaded while excluded
    const chrome = await start({ tabs, sync: { whitelist: ['shop.com'] } });
    assert.equal(frameOf(chrome, 2, 0).off, true);
    reset(chrome);
    await setSync(chrome, { whitelist: [] });
    assert.deepEqual(
      chrome.calls.insertCSS.map((c) => c.target),
      [{ tabId: 2, frameIds: [0] }],
    );
    assert.equal(frameOf(chrome, 2, 0).off, false);
  });

  test('only tabs whose icon changes get a new icon', async () => {
    const chrome = await start();
    reset(chrome);
    await setSync(chrome, { whitelist: ['shop.com'] });
    assert.deepEqual(
      tabIconCalls(chrome).map((c) => [c.tabId, isActiveIcon(c)]),
      [[2, false]],
    );
    assert.equal(chrome.calls.setIcon.length, 1, 'default icon unchanged, not set again');
  });

  test('unrelated sync changes (theme) do nothing', async () => {
    const chrome = await start();
    reset(chrome);
    await setSync(chrome, { theme: 'dark' });
    assert.equal(chrome.calls.executeScript.length + chrome.calls.setIcon.length + chrome.calls.update.length, 0);
  });
});

describe('tab events', () => {
  test('navigation always re-sets the icon (Firefox resets it)', async () => {
    const chrome = await start();
    reset(chrome);
    await chrome.tabs.onUpdated.fire(2, { status: 'loading' }, { id: 2, url: 'https://shop.com/next' });
    await chrome.tabs.onUpdated.fire(2, { status: 'loading' }, { id: 2, url: 'https://shop.com/next' });
    assert.equal(tabIconCalls(chrome).length, 2);
  });

  test('switching tabs only sets an icon that is out of date', async () => {
    const chrome = await start();
    reset(chrome);
    await chrome.tabs.onActivated.fire({ tabId: 1 });
    assert.equal(chrome.calls.setIcon.length, 0);
  });

  test('a closed tab is forgotten', async () => {
    const chrome = await start();
    chrome.tabsData.splice(1, 1);
    await chrome.tabs.onRemoved.fire(2);
    reset(chrome);
    chrome.tabsData.push({ id: 2, url: 'https://shop.com/', frames: [frame(0, 'shop.com')] });
    await chrome.tabs.onActivated.fire({ tabId: 2 });
    await settle();
    assert.equal(tabIconCalls(chrome).length, 1, 'tab id reused: icon set again');
  });

  test('counts finished page loads where scrollbars are hidden', async () => {
    const chrome = await start({ sync: { whitelist: ['shop.com'] }, local: { hideCount: 3 } });
    const complete = (url) => chrome.tabs.onUpdated.fire(1, { status: 'complete' }, { id: 1, url });
    await complete('https://news.com/');
    await complete('https://shop.com/'); // whitelisted
    await complete('chrome://newtab/'); // restricted
    await chrome.tabs.onUpdated.fire(1, { title: 'x' }, { id: 1, url: 'https://news.com/' }); // not a load
    await complete('https://news.com/2');
    await settle();
    assert.equal(chrome.storage.local.data.hideCount, 5);
  });
});

describe('browser restart and site access', () => {
  test('startup keeps the registration in line with stored settings', async () => {
    const chrome = createFakeChrome({ sync: { whitelist: ['a.com'] }, tabs: makeTabs() });
    chrome.registered.set(SCRIPT_ID, { id: SCRIPT_ID, excludeMatches: [] }); // persisted from last session
    loadExtension(chrome, BACKGROUND);
    await chrome.runtime.onStartup.fire();
    await settle();
    assert.deepEqual(chrome.registered.get(SCRIPT_ID).excludeMatches, ['*://a.com/*', '*://www.a.com/*']);
    assert.equal(chrome.calls.executeScript.length, 0, 'tabs restored at startup load the registered CSS');
    assert.ok(tabIconCalls(chrome).length > 0);
  });

  test('granting site access again re-applies to open tabs', async () => {
    const tabs = makeTabs();
    tabs[1].frames[0].hasCss = false;
    const chrome = createFakeChrome({ tabs });
    loadExtension(chrome, BACKGROUND);
    await chrome.permissions.onAdded.fire({ origins: ['<all_urls>'] });
    await settle();
    assert.deepEqual(
      chrome.calls.insertCSS.map((c) => c.target),
      [{ tabId: 2, frameIds: [0] }],
    );
  });
});

describe('toolbar icon decoding', () => {
  // Minimal fetch / createImageBitmap / OffscreenCanvas that count decodes
  const decodingGlobals = () => {
    const counts = { fetch: 0 };
    return {
      counts,
      globals: {
        fetch: async (url) => {
          counts.fetch++;
          return { blob: async () => ({ url }) };
        },
        createImageBitmap: async (blob) => ({ width: 16, height: 16, url: blob.url }),
        OffscreenCanvas: class {
          getContext() {
            let drawn;
            return {
              drawImage: (bitmap) => (drawn = bitmap.url),
              getImageData: () => ({ decodedFrom: drawn }),
            };
          }
        },
      },
    };
  };

  test('decodes each icon file once and passes pixels to setIcon', async () => {
    const { counts, globals } = decodingGlobals();
    const chrome = await start({ globals });
    await setSync(chrome, { whitelist: ['shop.com'] });
    await setSync(chrome, { scrollbarHidden: false });
    await setSync(chrome, { scrollbarHidden: true });
    assert.equal(counts.fetch, 8, '4 sizes x 2 icon sets, however many updates');
    assert.ok(chrome.calls.setIcon.length > 4);
    for (const call of chrome.calls.setIcon) {
      assert.equal(call.path, undefined);
      assert.match(call.imageData[16].decodedFrom, /icon16(-off)?\.png$/);
    }
  });

  test('falls back to icon paths when decoding is unavailable', async () => {
    const chrome = await start(); // no fetch / OffscreenCanvas in this context
    assert.ok(chrome.calls.setIcon.length > 0);
    for (const call of chrome.calls.setIcon) assert.match(call.path[16], /\/assets\/icons\/icon16(-off)?\.png$/);
  });
});
