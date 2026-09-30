const initPopup = () => {
  const { applyI18n } = (globalThis as any).ScrollHideI18n || {};
  const { getActiveTab } = (globalThis as any).ScrollHideBrowserApi || {};
  const { getSyncState, setSyncValue, applyTheme } = (globalThis as any).ScrollHideStorage || {};
  const { isRestrictedUrl, isWhitelisted, sanitizeDomain } = (globalThis as any).ScrollHideWhitelist || {};

  const toggle = document.getElementById('toggleScroll') as HTMLButtonElement | null;
  const addCurrentBtn = document.getElementById('addCurrentBtn') as HTMLButtonElement | null;
  const addCurrentVertical = document.getElementById('addCurrentVertical') as HTMLElement | null;
  const whitelistedNotice = document.getElementById('whitelistedNotice') as HTMLElement | null;
  const restrictedNotice = document.getElementById('restrictedNotice') as HTMLElement | null;
  const reloadTabBtn = document.getElementById('reloadTabBtn') as HTMLButtonElement | null;
  const openWhitelistBtn = document.getElementById('openWhitelistBtn') as HTMLButtonElement | null;
  const openReportBtn = document.getElementById('openReportBtn') as HTMLButtonElement | null;
  const openSettingsBtn = document.getElementById('openSettingsBtn') as HTMLButtonElement | null;
  const openReviewBtn = document.getElementById('openReviewBtn') as HTMLButtonElement | null;
  const buyCoffeeBtn = document.getElementById('buyCoffeeBtn') as HTMLElement | null;
  const domainDisplay = document.getElementById('domainDisplay') as HTMLElement;
  const statusVal = document.getElementById('statusValue');
  const exceptionsCnt = document.getElementById('exceptionsCount');
  const cleanedCnt = document.getElementById('cleanedCount');

  let currentHostname = '';
  let isRestricted = false;
  let currentWhitelist: string[] = [];
  let currentScrollbarHidden = true;
  let currentTabId: number | undefined;

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

  const applyImmediateToolbarIcon = (hidden: boolean, inWhitelist: boolean): void => {
    if (typeof chrome === 'undefined' || !chrome.action?.setIcon) return;
    const isTabActive = hidden && !inWhitelist && !isRestricted;
    if (currentTabId !== undefined) {
      chrome.action.setIcon({
        path: isTabActive ? ICONS_ACTIVE : ICONS_INACTIVE,
        tabId: currentTabId,
      }).catch(() => {});
    }
    chrome.action.setIcon({
      path: hidden ? ICONS_ACTIVE : ICONS_INACTIVE,
    }).catch(() => {});
  };

  if (applyI18n) {
    applyI18n();
  }

  const applyRestrictedState = (): void => {
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

  const updateAddButtonState = (inList: boolean): void => {
    if (!addCurrentBtn || !addCurrentVertical) return;
    const labelKey = inList ? 'removeCurrentHost' : 'addCurrentHost';
    const label = chrome?.i18n?.getMessage ? chrome.i18n.getMessage(labelKey) : '';
    const fallback = inList ? 'Remove site from whitelist' : 'Add site to whitelist';
    const finalLabel = label || fallback;
    addCurrentVertical.style.display = inList ? 'none' : 'block';
    addCurrentBtn.setAttribute('aria-label', finalLabel);
    addCurrentBtn.title = finalLabel;
  };

  const updateStats = (whitelist: string[], scrollbarHidden: boolean): void => {
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

  const updateNotice = (whitelist: string[], scrollbarHidden: boolean): void => {
    if (!currentHostname) {
      if (whitelistedNotice) whitelistedNotice.style.display = 'none';
      if (domainDisplay) {
        domainDisplay.textContent = (chrome?.i18n?.getMessage && chrome.i18n.getMessage('cantAddPage')) || 'Invalid Page';
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
      toggle.style.opacity = (inList || isRestricted) ? '0.4' : '1';
      toggle.style.pointerEvents = (inList || isRestricted) ? 'none' : 'auto';
    }

    updateStats(whitelist, scrollbarHidden && !inList);

    if (addCurrentBtn) addCurrentBtn.disabled = isRestricted;
    if (reloadTabBtn) reloadTabBtn.disabled = isRestricted;
  };

  const addDomain = async (raw: string): Promise<void> => {
    const domain = sanitizeDomain ? sanitizeDomain(raw) : raw.trim();
    if (!domain || !setSyncValue) return;

    if (currentWhitelist.includes(domain)) return;
    const newList = [...currentWhitelist, domain].sort();
    currentWhitelist = newList;
    applyImmediateToolbarIcon(currentScrollbarHidden, true);
    updateNotice(newList, currentScrollbarHidden);

    try {
      await setSyncValue({ whitelist: newList });
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ action: 'update-icons' }).catch(() => {});
      }
    } catch (err) {
      console.error('[Popup] Failed to add domain', { domain, error: err });
    }
  };

  const removeDomain = async (raw: string): Promise<void> => {
    const domain = sanitizeDomain ? sanitizeDomain(raw) : raw.trim();
    if (!domain || !setSyncValue) return;

    const cleanRaw = domain.toLowerCase();
    const withoutWww = cleanRaw.startsWith('www.') ? cleanRaw.slice(4) : cleanRaw;
    const withWww = `www.${withoutWww}`;

    const newList = currentWhitelist.filter((item) => {
      const cleanItem = item.trim().toLowerCase();
      return cleanItem !== cleanRaw && cleanItem !== withoutWww && cleanItem !== withWww;
    });
    currentWhitelist = newList;
    applyImmediateToolbarIcon(currentScrollbarHidden, false);
    updateNotice(newList, currentScrollbarHidden);

    try {
      await setSyncValue({ whitelist: newList });
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ action: 'update-icons' }).catch(() => {});
      }
    } catch (err) {
      console.error('[Popup] Failed to remove domain', { domain, error: err });
    }
  };

  if (toggle) {
    toggle.addEventListener('click', async () => {
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
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ action: 'update-icons' }).catch(() => {});
          }
        } catch (err) {
          console.error('[Popup] Failed to toggle scrollbar state', { hidden, error: err });
        }
      }
    });
  }

  if (addCurrentBtn) {
    addCurrentBtn.addEventListener('click', () => {
      if (!currentHostname || isRestricted) return;

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
      if (tab?.id && typeof chrome !== 'undefined' && chrome.tabs?.reload) {
        chrome.tabs.reload(tab.id);
        window.close();
      }
    });
  }

  const openOrFocusSettingsTab = (tabName: string = ''): void => {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;
    const settingsUrl = chrome.runtime.getURL('options.html');
    const targetUrl = `${settingsUrl}?tab=${tabName || 'settings'}`;

    chrome.tabs.query({}, (tabs) => {
      const existingTab = tabs.find((t) => t.url && (t.url.startsWith(settingsUrl) || t.url.includes('/options.html')));
      if (existingTab && existingTab.id) {
        chrome.tabs.update(existingTab.id, { active: true, url: targetUrl });
        if (existingTab.windowId && chrome.windows?.update) {
          chrome.windows.update(existingTab.windowId, { focused: true });
        }
      } else {
        chrome.tabs.create({ url: targetUrl });
      }
      window.close();
    });
  };

  if (openWhitelistBtn) {
    openWhitelistBtn.addEventListener('click', () => {
      openOrFocusSettingsTab('whitelist');
    });
  }

  if (openReportBtn) {
    openReportBtn.addEventListener('click', () => {
      openOrFocusSettingsTab('report');
    });
  }

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', () => {
      openOrFocusSettingsTab('settings');
    });
  }

  if (openReviewBtn) {
    openReviewBtn.addEventListener('click', () => {
      const extId = typeof chrome !== 'undefined' && chrome.runtime?.id;
      const reviewUrl = extId
        ? `https://chromewebstore.google.com/detail/${extId}/reviews`
        : 'https://github.com/n3d06/hide-scrollbar';
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: reviewUrl });
      } else {
        window.open(reviewUrl, '_blank');
      }
      window.close();
    });
  }

  if (buyCoffeeBtn) {
    buyCoffeeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const coffeeUrl = 'https://buymeacoffee.com/n3d06';
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: coffeeUrl });
      } else {
        window.open(coffeeUrl, '_blank');
      }
      window.close();
    });
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.hideCount && cleanedCnt) {
        cleanedCnt.textContent = ((changes.hideCount.newValue as number) || 0).toLocaleString();
      }
      if (namespace === 'sync' && changes.theme) {
        if (applyTheme) applyTheme(changes.theme.newValue as string);
      }
      if (namespace === 'sync' && changes.scrollbarHidden !== undefined) {
        currentScrollbarHidden = Boolean(changes.scrollbarHidden.newValue);
        updateNotice(currentWhitelist, currentScrollbarHidden);
      }
      if (namespace === 'sync' && changes.whitelist) {
        currentWhitelist = (changes.whitelist.newValue as string[]) || [];
        updateNotice(currentWhitelist, currentScrollbarHidden);
      }
    });
  }

  // --- PARALLEL INSTANT INITIALIZATION ---
  const fetchActiveTab = async (): Promise<chrome.tabs.Tab | null> => {
    if (getActiveTab) {
      try {
        return await getActiveTab();
      } catch (_) {}
    }
    return null;
  };

  const fetchSyncData = async (): Promise<Record<string, unknown>> => {
    if (getSyncState) {
      try {
        return await getSyncState();
      } catch (_) {}
    }
    return {};
  };

  const fetchLocalCount = (): Promise<number> =>
    new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get({ hideCount: 0 }, (res) => resolve(res?.hideCount || 0));
      } else {
        resolve(0);
      }
    });

  Promise.all([fetchActiveTab(), fetchSyncData(), fetchLocalCount()]).then(
    ([tab, syncData, hideCount]) => {
      currentTabId = tab?.id;

      if (cleanedCnt) {
        cleanedCnt.textContent = hideCount.toLocaleString();
      }

      if (applyTheme && syncData.theme) {
        applyTheme(syncData.theme as string);
      }

      currentScrollbarHidden = syncData.scrollbarHidden !== false;
      currentWhitelist = Array.isArray(syncData.whitelist) ? (syncData.whitelist as string[]) : [];

      const tabUrl = tab?.url || '';
      isRestricted = isRestrictedUrl ? isRestrictedUrl(tabUrl) : false;

      if (tabUrl) {
        try {
          const parsed = new URL(tabUrl);
          const RESTRICTED_PROTOCOLS = (globalThis as any).ScrollHideConstants?.RESTRICTED_PROTOCOLS || [];
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
    }
  );
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}

