(() => {
  const initPopup = () => {
    const { applyI18n } = globalThis.ScrollHideI18n || {};
    const { getActiveTab } = globalThis.ScrollHideBrowserApi || {};
    const { getSyncState, setSyncValue, applyTheme } = globalThis.ScrollHideStorage || {};
    const { isRestrictedUrl, isWhitelisted, sanitizeDomain } = globalThis.ScrollHideWhitelist || {};

    const toggle = document.getElementById('toggleScroll');
    const addCurrentBtn = document.getElementById('addCurrentBtn');
    const addCurrentVertical = document.getElementById('addCurrentVertical');
    const whitelistedNotice = document.getElementById('whitelistedNotice');
    const restrictedNotice = document.getElementById('restrictedNotice');
    const reloadTabBtn = document.getElementById('reloadTabBtn');
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const domainDisplay = document.getElementById('domainDisplay');
    const statusVal = document.getElementById('statusValue');
    const exceptionsCnt = document.getElementById('exceptionsCount');
    const cleanedCnt = document.getElementById('cleanedCount');

    let currentHostname = '';
    let isRestricted = false;
    let canWhitelist = false; // only real hostnames (http/https) can be added
    let currentWhitelist = [];
    let currentScrollbarHidden = true;
    let currentTabId;

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

    const applyImmediateToolbarIcon = (hidden, inWhitelist) => {
      if (typeof chrome === 'undefined' || !chrome.action?.setIcon) return;
      const isTabActive = hidden && !inWhitelist && !isRestricted;
      if (currentTabId !== undefined && currentTabId >= 0) {
        try {
          chrome.action.setIcon(
            {
              path: isTabActive ? ICONS_ACTIVE : ICONS_INACTIVE,
              tabId: currentTabId,
            },
            () => {
              void chrome.runtime?.lastError;
            },
          );
        } catch (_) {}
      }
      try {
        chrome.action.setIcon(
          {
            path: hidden ? ICONS_ACTIVE : ICONS_INACTIVE,
          },
          () => {
            void chrome.runtime?.lastError;
          },
        );
      } catch (_) {}
    };

    if (applyI18n) {
      applyI18n();
    }

    const applyRestrictedState = () => {
      if (toggle) {
        toggle.classList.remove('active');
        toggle.disabled = true;
        toggle.style.opacity = '0.4';
        toggle.style.pointerEvents = 'none';
      }
      if (restrictedNotice) restrictedNotice.style.display = 'flex';
      if (addCurrentBtn) addCurrentBtn.disabled = true;
      if (reloadTabBtn) reloadTabBtn.disabled = true;
    };

    const updateAddButtonState = (inList) => {
      if (!addCurrentBtn || !addCurrentVertical) return;
      const labelKey = inList ? 'removeCurrentHost' : 'addCurrentHost';
      const label = chrome?.i18n?.getMessage ? chrome.i18n.getMessage(labelKey) : '';
      const fallback = inList ? 'Remove site from whitelist' : 'Add site to whitelist';
      const finalLabel = label || fallback;
      addCurrentVertical.style.display = inList ? 'none' : 'block';
      addCurrentBtn.setAttribute('aria-label', finalLabel);
      addCurrentBtn.title = finalLabel;
    };

    const updateStats = (whitelist, scrollbarHidden) => {
      if (exceptionsCnt) {
        exceptionsCnt.textContent = String(Array.isArray(whitelist) ? whitelist.length : 0);
      }

      if (statusVal) {
        statusVal.className = 'status-dot';
        statusVal.textContent = '';

        let statusText = '';
        if (isRestricted) {
          statusText = (chrome?.i18n?.getMessage && chrome.i18n.getMessage('statusRestricted')) || 'Restricted';
          statusVal.classList.add('restricted');
        } else if (isWhitelisted && isWhitelisted(currentHostname, whitelist)) {
          statusText = (chrome?.i18n?.getMessage && chrome.i18n.getMessage('statusWhitelisted')) || 'Whitelisted';
          statusVal.classList.add('whitelisted');
        } else if (scrollbarHidden) {
          statusText = (chrome?.i18n?.getMessage && chrome.i18n.getMessage('statusActive')) || 'Active';
          statusVal.classList.add('active');
        } else {
          statusText = (chrome?.i18n?.getMessage && chrome.i18n.getMessage('statusDisabled')) || 'Disabled';
          statusVal.classList.add('disabled');
        }
        statusVal.title = statusText;
      }
    };

    const updateNotice = (whitelist, scrollbarHidden) => {
      if (!currentHostname) {
        if (whitelistedNotice) whitelistedNotice.style.display = 'none';
        if (domainDisplay) {
          domainDisplay.textContent =
            (chrome?.i18n?.getMessage && chrome.i18n.getMessage('cantAddPage')) || 'Invalid Page';
        }
        if (addCurrentBtn) addCurrentBtn.disabled = true;
        updateAddButtonState(false);
        updateStats(whitelist, false);
        return;
      }

      if (domainDisplay) domainDisplay.textContent = currentHostname;

      const inList = isWhitelisted ? isWhitelisted(currentHostname, whitelist) : false;
      if (whitelistedNotice) whitelistedNotice.style.display = inList ? 'flex' : 'none';
      updateAddButtonState(inList);

      if (toggle) {
        const shouldBeActive = !inList && !isRestricted && scrollbarHidden;
        toggle.classList.toggle('active', shouldBeActive);
        toggle.setAttribute('aria-checked', String(shouldBeActive));
        toggle.disabled = inList || isRestricted;
        toggle.style.opacity = inList || isRestricted ? '0.4' : '1';
        toggle.style.pointerEvents = inList || isRestricted ? 'none' : 'auto';
      }

      updateStats(whitelist, scrollbarHidden && !inList);

      if (addCurrentBtn) addCurrentBtn.disabled = isRestricted || !canWhitelist;
      if (reloadTabBtn) reloadTabBtn.disabled = isRestricted;
    };

    const addDomain = async (raw) => {
      const domain = sanitizeDomain ? sanitizeDomain(raw) : raw.trim();
      if (!domain || !setSyncValue) return;

      if (currentWhitelist.includes(domain)) return;
      const newList = [...currentWhitelist, domain].sort();
      currentWhitelist = newList;
      applyImmediateToolbarIcon(currentScrollbarHidden, true);
      updateNotice(newList, currentScrollbarHidden);

      try {
        await setSyncValue({ whitelist: newList });
      } catch (err) {
        console.error('[Popup] Failed to add domain', { domain, error: err });
      }
    };

    // Remove every rule that matches the host (exact, www alias or *.wildcard)
    const removeDomain = async (host) => {
      if (!host || !setSyncValue || !isWhitelisted) return;

      const newList = currentWhitelist.filter((item) => !isWhitelisted(host, [item]));
      if (newList.length === currentWhitelist.length) return;
      currentWhitelist = newList;
      applyImmediateToolbarIcon(currentScrollbarHidden, false);
      updateNotice(newList, currentScrollbarHidden);

      try {
        await setSyncValue({ whitelist: newList });
      } catch (err) {
        console.error('[Popup] Failed to remove domain', { host, error: err });
      }
    };

    if (toggle) {
      toggle.addEventListener('click', async (e) => {
        // Segmented control: clicking the already-selected side does nothing
        const seg = e.target instanceof Element ? e.target.closest('[data-value]') : null;
        if (seg && (seg.getAttribute('data-value') === 'hide') === toggle.classList.contains('active')) return;
        toggle.classList.toggle('active');
        const hidden = toggle.classList.contains('active');
        toggle.setAttribute('aria-checked', String(hidden));
        currentScrollbarHidden = hidden;
        const inList = isWhitelisted ? isWhitelisted(currentHostname, currentWhitelist) : false;
        applyImmediateToolbarIcon(hidden, inList);
        updateStats(currentWhitelist, hidden);

        if (setSyncValue) {
          try {
            await setSyncValue({ scrollbarHidden: hidden });
          } catch (err) {
            console.error('[Popup] Failed to toggle scrollbar state', { hidden, error: err });
          }
        }
      });
    }

    if (addCurrentBtn) {
      addCurrentBtn.addEventListener('click', () => {
        if (!currentHostname || isRestricted || !canWhitelist) return;

        if (isWhitelisted && isWhitelisted(currentHostname, currentWhitelist)) {
          removeDomain(currentHostname);
        } else {
          addDomain(currentHostname);
        }
      });
    }

    if (reloadTabBtn) {
      reloadTabBtn.addEventListener('click', async () => {
        if (isRestricted || !getActiveTab) return;
        const tab = await getActiveTab();
        if (tab?.id !== undefined && tab.id >= 0 && typeof chrome !== 'undefined' && chrome.tabs?.reload) {
          try {
            chrome.tabs.reload(tab.id, () => {
              void chrome.runtime?.lastError;
            });
          } catch (_) {}
          window.close();
        }
      });
    }

    const openOrFocusSettingsTab = (tabName = '') => {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
      const settingsUrl = chrome.runtime.getURL('options.html');
      const targetUrl = `${settingsUrl}?tab=${tabName || 'settings'}`;

      chrome.tabs.query({}, (tabs) => {
        if (chrome.runtime?.lastError || !Array.isArray(tabs)) return;
        const existingTab = tabs.find(
          (t) => t.url && (t.url.startsWith(settingsUrl) || t.url.includes('/options.html')),
        );
        if (existingTab && existingTab.id !== undefined && existingTab.id >= 0) {
          chrome.tabs.update(existingTab.id, { active: true, url: targetUrl }, () => {
            void chrome.runtime?.lastError;
          });
          if (existingTab.windowId && chrome.windows?.update) {
            chrome.windows.update(existingTab.windowId, { focused: true }, () => {
              void chrome.runtime?.lastError;
            });
          }
        } else if (chrome.tabs.create) {
          chrome.tabs.create({ url: targetUrl }, () => {
            void chrome.runtime?.lastError;
          });
        }
        window.close();
      });
    };

    // Site access: Firefox lets users revoke it, Chrome can be set to "on click"
    const permissionNotice = document.getElementById('permissionNotice');
    const grantPermissionBtn = document.getElementById('grantPermissionBtn');
    const ALL_SITES = { origins: ['<all_urls>'] };

    if (permissionNotice && typeof chrome !== 'undefined' && chrome.permissions?.contains) {
      chrome.permissions
        .contains(ALL_SITES)
        .then((granted) => permissionNotice.classList.toggle('visible', !granted))
        .catch(() => {});
    }

    if (grantPermissionBtn) {
      grantPermissionBtn.addEventListener('click', () => {
        if (typeof chrome === 'undefined' || !chrome.permissions?.request) return;
        // Must be called directly in the click handler (user gesture)
        chrome.permissions
          .request(ALL_SITES)
          .then((granted) => {
            if (granted && permissionNotice) permissionNotice.classList.remove('visible');
          })
          .catch((err) => console.error('[Popup] Permission request failed', err));
      });
    }

    if (openSettingsBtn) {
      openSettingsBtn.addEventListener('click', () => {
        openOrFocusSettingsTab('settings');
      });
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.hideCount && cleanedCnt) {
          cleanedCnt.textContent = (changes.hideCount.newValue || 0).toLocaleString();
        }
        if (namespace === 'sync' && changes.theme) {
          if (applyTheme) applyTheme(changes.theme.newValue);
        }
        if (namespace === 'sync' && changes.scrollbarHidden !== undefined) {
          currentScrollbarHidden = Boolean(changes.scrollbarHidden.newValue);
          updateNotice(currentWhitelist, currentScrollbarHidden);
        }
        if (namespace === 'sync' && changes.whitelist) {
          currentWhitelist = changes.whitelist.newValue || [];
          updateNotice(currentWhitelist, currentScrollbarHidden);
        }
      });
    }

    // --- PARALLEL INSTANT INITIALIZATION ---
    const fetchActiveTab = async () => {
      if (getActiveTab) {
        try {
          return await getActiveTab();
        } catch (_) {}
      }
      return null;
    };

    const fetchSyncData = async () => {
      if (getSyncState) {
        try {
          return await getSyncState();
        } catch (_) {}
      }
      return {};
    };

    const fetchLocalCount = () =>
      new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.get({ hideCount: 0 }, (res) => resolve(res?.hideCount || 0));
        } else {
          resolve(0);
        }
      });

    Promise.all([fetchActiveTab(), fetchSyncData(), fetchLocalCount()]).then(([tab, syncData, hideCount]) => {
      currentTabId = tab?.id;

      if (cleanedCnt) {
        cleanedCnt.textContent = hideCount.toLocaleString();
      }

      if (applyTheme && syncData.theme) {
        applyTheme(syncData.theme);
      }

      currentScrollbarHidden = syncData.scrollbarHidden !== false;
      currentWhitelist = Array.isArray(syncData.whitelist) ? syncData.whitelist : [];

      const tabUrl = tab?.url || '';
      isRestricted = isRestrictedUrl ? isRestrictedUrl(tabUrl) : false;

      if (tabUrl) {
        try {
          const parsed = new URL(tabUrl);
          const RESTRICTED_PROTOCOLS = globalThis.ScrollHideConstants?.RESTRICTED_PROTOCOLS || [];
          if (RESTRICTED_PROTOCOLS.includes(parsed.protocol) || parsed.protocol === 'file:') {
            if (parsed.protocol === 'about:') {
              currentHostname = parsed.href;
            } else if (parsed.protocol === 'file:') {
              const segments = parsed.pathname.split('/').filter(Boolean);
              const fileName = segments.pop() || '';
              currentHostname = fileName ? `file://.../${fileName}` : 'file://local-file';
            } else {
              currentHostname = parsed.protocol + '//' + parsed.hostname;
            }
          } else {
            currentHostname = parsed.hostname;
            canWhitelist = Boolean(parsed.hostname);
          }
        } catch (_) {
          currentHostname = '';
        }
      }

      if (isRestricted) {
        applyRestrictedState();
      }

      const inList = isWhitelisted ? isWhitelisted(currentHostname, currentWhitelist) : false;
      applyImmediateToolbarIcon(currentScrollbarHidden, inList);

      updateNotice(currentWhitelist, currentScrollbarHidden);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPopup);
  } else {
    initPopup();
  }
})();
