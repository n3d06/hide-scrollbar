const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');

require('../../src/shared/constants.js');
require('../../src/shared/storage.js');

const { getSyncState, setSyncValue, applyTheme } = globalThis.ScrollHideStorage;
const { DEFAULT_SYNC_STATE } = globalThis.ScrollHideConstants;

// Minimal chrome.storage.sync mock with the MV3 Promise API
const mockChrome = (initial = {}) => {
  const data = { ...initial };
  globalThis.chrome = {
    runtime: { id: 'test-extension' },
    storage: {
      sync: {
        get: async (defaults) => ({ ...defaults, ...data }),
        set: async (value) => Object.assign(data, value),
      },
    },
  };
  return data;
};

afterEach(() => {
  delete globalThis.chrome;
});

describe('getSyncState', () => {
  test('fills in defaults for missing keys', async () => {
    mockChrome({ whitelist: ['a.com'] });
    assert.deepEqual(await getSyncState(), { ...DEFAULT_SYNC_STATE, whitelist: ['a.com'] });
  });

  test('returns a copy of the defaults outside an extension', async () => {
    const state = await getSyncState();
    assert.deepEqual(state, DEFAULT_SYNC_STATE);
    assert.notEqual(state, DEFAULT_SYNC_STATE);
  });

  test('returns defaults when the extension context is gone', async () => {
    mockChrome({ scrollbarHidden: false });
    delete globalThis.chrome.runtime.id;
    assert.deepEqual(await getSyncState(), DEFAULT_SYNC_STATE);
  });

  test('propagates storage errors', async () => {
    mockChrome();
    globalThis.chrome.storage.sync.get = async () => {
      throw new Error('QUOTA');
    };
    await assert.rejects(getSyncState(), /QUOTA/);
  });
});

describe('setSyncValue', () => {
  test('writes to chrome.storage.sync', async () => {
    const data = mockChrome();
    await setSyncValue({ scrollbarHidden: false });
    assert.equal(data.scrollbarHidden, false);
  });

  test('is a no-op outside an extension', async () => {
    await assert.doesNotReject(setSyncValue({ scrollbarHidden: false }));
  });
});

describe('applyTheme', () => {
  const fakeElement = () => {
    const attrs = new Map();
    return {
      attrs,
      setAttribute: (k, v) => attrs.set(k, v),
      removeAttribute: (k) => attrs.delete(k),
    };
  };

  test('sets data-theme for light and dark', () => {
    const el = fakeElement();
    applyTheme('dark', el);
    assert.equal(el.attrs.get('data-theme'), 'dark');
    applyTheme('light', el);
    assert.equal(el.attrs.get('data-theme'), 'light');
  });

  test('removes data-theme for system or unknown values', () => {
    const el = fakeElement();
    applyTheme('dark', el);
    applyTheme('system', el);
    assert.equal(el.attrs.has('data-theme'), false);
    applyTheme('dark', el);
    applyTheme('purple', el);
    assert.equal(el.attrs.has('data-theme'), false);
  });

  test('does nothing without a target (service worker)', () => {
    assert.doesNotThrow(() => applyTheme('dark'));
  });
});
