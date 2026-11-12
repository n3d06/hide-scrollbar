(() => {
  const getDefaultSyncState = () => {
    const g = globalThis;
    return g.ScrollHideConstants?.DEFAULT_SYNC_STATE ?? {};
  };

  const toPromise = (executor) =>
    new Promise((resolve, reject) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
          resolve({});
          return;
        }
        executor((result) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          resolve(result);
        });
      } catch (_) {
        resolve({});
      }
    });

  const getSyncState = () =>
    toPromise((done) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.sync) {
          chrome.storage.sync.get(getDefaultSyncState(), done);
        } else {
          done(getDefaultSyncState());
        }
      } catch (_) {
        done(getDefaultSyncState());
      }
    });

  const getSyncValue = (defaults) =>
    toPromise((done) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.sync) {
          chrome.storage.sync.get(defaults, done);
        } else {
          done(defaults && typeof defaults === 'object' ? defaults : {});
        }
      } catch (_) {
        done(defaults && typeof defaults === 'object' ? defaults : {});
      }
    });

  const setSyncValue = (value) =>
    toPromise((done) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.sync) {
          chrome.storage.sync.set(value, done);
        } else {
          done();
        }
      } catch (_) {
        done();
      }
    });

  const applyTheme = (theme, target = document.documentElement) => {
    if (!target) return;
    if (theme === 'light' || theme === 'dark') {
      target.setAttribute('data-theme', theme);
    } else {
      target.removeAttribute('data-theme');
    }
  };

  const ScrollHideStorage = {
    getSyncState,
    getSyncValue,
    setSyncValue,
    applyTheme,
  };

  // Global assignment for HTML script tags
  globalThis.ScrollHideStorage = ScrollHideStorage;
})();
