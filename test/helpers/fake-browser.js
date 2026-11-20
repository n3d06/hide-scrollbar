// A small in-memory stand-in for the chrome.* APIs the extension uses, plus a loader that
// runs the real extension scripts against it in an isolated VM context.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.resolve(__dirname, '../../src');

const makeEvent = () => {
  const listeners = [];
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    fire: (...args) => Promise.all(listeners.map((fn) => fn(...args))),
  };
};

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * Tabs are { id, url, unscriptable?, frames: [{ frameId, hostname, hasCss, off }] }.
 * A frame's `hasCss` mirrors whether the stylesheet is applied, `off` the data-scrollhide-off attribute.
 */
const createFakeChrome = ({ sync = {}, local = {}, tabs = [] } = {}) => {
  const calls = { setIcon: [], insertCSS: [], executeScript: [], register: [], update: [], unregister: [] };
  const registered = new Map();
  const onChanged = makeEvent();

  const makeArea = (name, data) => ({
    data,
    get: async (defaults) => {
      const keys = typeof defaults === 'string' ? { [defaults]: undefined } : defaults || {};
      return clone({ ...keys, ...data });
    },
    set: async (values) => {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        if (JSON.stringify(data[key]) === JSON.stringify(value)) continue;
        changes[key] = { oldValue: clone(data[key]), newValue: clone(value) };
        data[key] = clone(value);
      }
      if (Object.keys(changes).length) await onChanged.fire(changes, name);
    },
  });

  const findTab = (tabId) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) throw new Error(`No tab with id: ${tabId}`);
    return tab;
  };

  const chrome = {
    calls,
    registered,
    tabsData: tabs,
    runtime: {
      id: 'test-extension',
      getURL: (p) => `chrome-extension://test-extension/${p.replace(/^\//, '')}`,
      onInstalled: makeEvent(),
      onStartup: makeEvent(),
    },
    storage: { sync: makeArea('sync', sync), local: makeArea('local', local), onChanged },
    permissions: { onAdded: makeEvent() },
    commands: { onCommand: makeEvent() },
    action: {
      setIcon: async (details) => {
        calls.setIcon.push(details);
        if (details.tabId !== undefined) findTab(details.tabId);
      },
    },
    tabs: {
      query: async () => tabs.map(({ id, url }) => ({ id, url })),
      get: async (tabId) => {
        const { id, url } = findTab(tabId);
        return { id, url };
      },
      onUpdated: makeEvent(),
      onActivated: makeEvent(),
      onRemoved: makeEvent(),
    },
    scripting: {
      getRegisteredContentScripts: async ({ ids }) =>
        ids.filter((id) => registered.has(id)).map((id) => clone(registered.get(id))),
      registerContentScripts: async (scripts) => {
        for (const s of scripts) {
          if (registered.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
          registered.set(s.id, clone(s));
          calls.register.push(clone(s));
        }
      },
      updateContentScripts: async (scripts) => {
        for (const s of scripts) {
          if (!registered.has(s.id)) throw new Error(`No script with ID '${s.id}'`);
          registered.set(s.id, { ...registered.get(s.id), ...clone(s) });
          calls.update.push(clone(s));
        }
      },
      unregisterContentScripts: async ({ ids }) => {
        ids.forEach((id) => registered.delete(id));
        calls.unregister.push(ids);
      },
      // Filled in by loadExtension: runs `func` once per frame with that frame's globals
      executeScript: null,
      insertCSS: async ({ target, files }) => {
        calls.insertCSS.push(clone({ target, files }));
        const tab = findTab(target.tabId);
        tab.frames.filter((f) => target.frameIds.includes(f.frameId)).forEach((f) => (f.hasCss = true));
      },
    },
  };
  return chrome;
};

/** Make a frame's DOM globals, backed by the frame record. */
const frameGlobals = (frame, { offAttr, marker }) => ({
  document: {
    documentElement: {
      toggleAttribute: (name, force) => {
        if (name === offAttr) frame.off = force;
      },
    },
    getElementById: () => null,
  },
  location: { hostname: frame.hostname },
  getComputedStyle: () => ({ getPropertyValue: (p) => (frame.hasCss && p === marker ? ' 1' : '') }),
});

/**
 * Run the given extension scripts (paths relative to src/) in a fresh context that has
 * `chrome` and optional extra globals. Returns the context.
 */
const loadExtension = (chrome, scripts, extraGlobals = {}) => {
  const context = vm.createContext({ chrome, console, URL, ...extraGlobals });
  chrome.scripting.executeScript ??= async ({ target, func, args }) => {
    chrome.calls.executeScript.push({ tabId: target.tabId });
    const tab = chrome.tabsData.find((t) => t.id === target.tabId);
    if (!tab || tab.unscriptable) throw new Error('Cannot access contents of the page');
    const { OFF_ATTR, CSS_MARKER } = context.ScrollHideConstants;
    return tab.frames.map((frame) => {
      Object.assign(context, frameGlobals(frame, { offAttr: OFF_ATTR, marker: CSS_MARKER }));
      return { frameId: frame.frameId, result: func(...args) };
    });
  };
  for (const file of scripts) {
    vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), context, { filename: file });
  }
  return context;
};

/** Let queued promise chains (the background's job queue) run to completion. */
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
};

module.exports = { createFakeChrome, frameGlobals, loadExtension, settle };
