const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');

require('../../src/shared/constants.js');
require('../../src/features/whitelist.js');
require('../../src/shared/storage.js');

const { applyTheme, getHideCount, getSyncState, normalizeSyncState, parseBackup, setHideCount, setSyncValue } =
  globalThis.ScrollHideStorage;
const { DEFAULT_SYNC_STATE } = globalThis.ScrollHideConstants;

// Minimal chrome.storage mock with the MV3 Promise API
const mockArea = (initial = {}) => {
  const data = { ...initial };
  return {
    data,
    get: async (defaults) => ({ ...defaults, ...data }),
    set: async (value) => Object.assign(data, value),
  };
};

const mockChrome = ({ sync = {}, local = {} } = {}) => {
  globalThis.chrome = {
    runtime: { id: 'test-extension' },
    storage: { sync: mockArea(sync), local: mockArea(local) },
  };
  return globalThis.chrome.storage;
};

afterEach(() => {
  delete globalThis.chrome;
});

describe('normalizeSyncState', () => {
  test('defaults for an empty or invalid object', () => {
    for (const raw of [undefined, null, 'x', {}]) {
      assert.deepEqual(normalizeSyncState(raw), DEFAULT_SYNC_STATE);
    }
  });

  test('hiding stays on unless explicitly false', () => {
    assert.equal(normalizeSyncState({ scrollbarHidden: undefined }).scrollbarHidden, true);
    assert.equal(normalizeSyncState({ scrollbarHidden: 0 }).scrollbarHidden, true);
    assert.equal(normalizeSyncState({ scrollbarHidden: false }).scrollbarHidden, false);
  });

  test('drops non-string whitelist entries and unknown themes', () => {
    const state = normalizeSyncState({ whitelist: ['a.com', 1, null], theme: 'purple' });
    assert.deepEqual(state.whitelist, ['a.com']);
    assert.equal(state.theme, 'system');
  });

  test('keeps valid values', () => {
    const raw = { scrollbarHidden: false, whitelist: ['a.com'], theme: 'dark' };
    assert.deepEqual(normalizeSyncState(raw), raw);
  });
});

describe('parseBackup', () => {
  test('restores only valid keys', () => {
    assert.deepEqual(
      parseBackup({ scrollbarHidden: 'yes', whitelist: ['B.com', '# note', 'a.com'], theme: 'dark', extra: 1 }),
      { whitelist: ['a.com', 'b.com'], theme: 'dark' },
    );
  });

  test('a partial backup leaves other settings out', () => {
    assert.deepEqual(parseBackup({ scrollbarHidden: false }), { scrollbarHidden: false });
  });

  test('rejects anything that is not an object', () => {
    for (const data of [null, 'x', 42, ['a.com']]) assert.equal(parseBackup(data), null);
  });
});

describe('getSyncState', () => {
  test('fills in defaults for missing keys', async () => {
    mockChrome({ sync: { whitelist: ['a.com'] } });
    assert.deepEqual(await getSyncState(), { ...DEFAULT_SYNC_STATE, whitelist: ['a.com'] });
  });

  test('normalizes what is stored', async () => {
    mockChrome({ sync: { scrollbarHidden: null, theme: 42 } });
    assert.deepEqual(await getSyncState(), DEFAULT_SYNC_STATE);
  });

  test('returns defaults outside an extension', async () => {
    assert.deepEqual(await getSyncState(), DEFAULT_SYNC_STATE);
  });

  test('returns defaults when the extension context is gone', async () => {
    mockChrome({ sync: { scrollbarHidden: false } });
    delete globalThis.chrome.runtime.id;
    assert.deepEqual(await getSyncState(), DEFAULT_SYNC_STATE);
  });

  test('propagates storage errors', async () => {
    mockChrome().sync.get = async () => {
      throw new Error('QUOTA');
    };
    await assert.rejects(getSyncState(), /QUOTA/);
  });
});

describe('setSyncValue', () => {
  test('writes to chrome.storage.sync', async () => {
    const { sync } = mockChrome();
    await setSyncValue({ scrollbarHidden: false });
    assert.equal(sync.data.scrollbarHidden, false);
  });

  test('is a no-op outside an extension', async () => {
    await assert.doesNotReject(setSyncValue({ scrollbarHidden: false }));
  });
});

describe('hide counter', () => {
  test('reads and writes chrome.storage.local', async () => {
    const { local } = mockChrome({ local: { hideCount: 5 } });
    assert.equal(await getHideCount(), 5);
    await setHideCount(6);
    assert.equal(local.data.hideCount, 6);
  });

  test('0 when unset, corrupt or outside an extension', async () => {
    assert.equal(await getHideCount(), 0);
    mockChrome({ local: { hideCount: 'NaN' } });
    assert.equal(await getHideCount(), 0);
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
