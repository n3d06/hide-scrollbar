(() => {
  const { applyI18n, getMessage } = globalThis.ScrollHideI18n;
  const { applyTheme, getHideCount, getSyncState, normalizeSyncState, setSyncValue } = globalThis.ScrollHideStorage;
  const { describeUrl, isWhitelisted, sanitizeDomain } = globalThis.ScrollHideWhitelist;

  const { getElement: $ } = globalThis.ScrollHideDom;
  const ui = {
    toggle: $('toggleScroll', HTMLButtonElement),
    domain: $('domainDisplay'),
    status: $('statusValue'),
    exceptions: $('exceptionsCount'),
    cleaned: $('cleanedCount'),
    permissionNotice: $('permissionNotice'),
    grantPermission: $('grantPermissionBtn', HTMLButtonElement),
    restrictedNotice: $('restrictedNotice'),
    whitelistedNotice: $('whitelistedNotice'),
    addCurrent: $('addCurrentBtn', HTMLButtonElement),
    addCurrentVertical: $('addCurrentVertical', SVGLineElement),
    reloadTab: $('reloadTabBtn', HTMLButtonElement),
    openSettings: $('openSettingsBtn', HTMLButtonElement),
  };

  const ALL_SITES = { origins: ['<all_urls>'] };

  // Status dot class -> tooltip
  const STATUS_TEXT = {
    restricted: getMessage('statusRestricted'),
    whitelisted: getMessage('statusWhitelisted'),
    active: getMessage('statusActive'),
    disabled: getMessage('statusDisabled'),
  };

  /** @type {chrome.tabs.Tab | null} */
  let tab = null;
  let page = describeUrl('');
  let state = normalizeSyncState({});

  /* ── Rendering ────────────────────────────────────────────── */

  const render = () => {
    const inList = !!page.host && isWhitelisted(page.host, state.whitelist);
    const hiding = state.scrollbarHidden && !inList && !page.restricted;

    ui.domain.textContent = page.label || getMessage('cantAddPage');

    ui.toggle.classList.toggle('active', hiding);
    ui.toggle.setAttribute('aria-checked', String(hiding));
    ui.toggle.disabled = inList || page.restricted;

    let status = 'disabled';
    if (page.restricted) status = 'restricted';
    else if (inList) status = 'whitelisted';
    else if (hiding && page.label) status = 'active';
    ui.status.className = `status-dot ${status}`;
    ui.status.title = STATUS_TEXT[status];

    ui.exceptions.textContent = String(state.whitelist.length);

    ui.restrictedNotice.classList.toggle('visible', page.restricted);
    ui.whitelistedNotice.classList.toggle('visible', inList);

    const addLabel = inList ? getMessage('removeCurrentHost') : getMessage('addCurrentHost');
    ui.addCurrent.disabled = page.restricted || !page.host;
    ui.addCurrent.title = addLabel;
    ui.addCurrent.setAttribute('aria-label', addLabel);
    ui.addCurrentVertical.style.display = inList ? 'none' : ''; // "+" becomes "−"

    ui.reloadTab.disabled = page.restricted;
  };

  const renderHideCount = (count) => {
    ui.cleaned.textContent = count.toLocaleString();
  };

  // Update the UI right away, then save; storage.onChanged re-renders with what was saved
  const save = async (patch) => {
    state = { ...state, ...patch };
    render();
    try {
      await setSyncValue(patch);
    } catch (err) {
      console.error('[Popup] Failed to save', patch, err);
      state = await getSyncState();
      render();
    }
  };

  /* ── Actions ──────────────────────────────────────────────── */

  ui.toggle.addEventListener('click', (e) => {
    // Segmented control: clicking the side that is already selected does nothing
    const segment = e.target instanceof Element ? e.target.closest('[data-value]') : null;
    const isHideSegment = segment?.getAttribute('data-value') === 'hide';
    if (segment && isHideSegment === ui.toggle.classList.contains('active')) return;
    save({ scrollbarHidden: !state.scrollbarHidden });
  });

  ui.addCurrent.addEventListener('click', () => {
    if (!page.host || page.restricted) return;
    if (isWhitelisted(page.host, state.whitelist)) {
      // Remove every rule that matches the host (exact, www alias or *.wildcard)
      save({ whitelist: state.whitelist.filter((rule) => !isWhitelisted(page.host, [rule])) });
    } else {
      save({ whitelist: [...state.whitelist, sanitizeDomain(page.host)].sort() });
    }
  });

  ui.reloadTab.addEventListener('click', async () => {
    if (page.restricted || tab?.id === undefined) return;
    await chrome.tabs.reload(tab.id).catch(() => {});
    window.close();
  });

  ui.openSettings.addEventListener('click', async () => {
    // Focuses the options tab if it is already open
    await chrome.runtime.openOptionsPage();
    window.close();
  });

  // Site access: Firefox lets users revoke it, Chrome can be set to "on click"
  ui.grantPermission.addEventListener('click', async () => {
    try {
      // Must be the first await in the click handler (needs the user gesture)
      const granted = await chrome.permissions.request(ALL_SITES);
      if (granted) ui.permissionNotice.classList.remove('visible');
    } catch (err) {
      console.error('[Popup] Permission request failed', err);
    }
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.hideCount) {
      renderHideCount(changes.hideCount.newValue ?? 0);
    }
    if (namespace === 'sync') {
      const raw = { ...state };
      for (const [key, { newValue }] of Object.entries(changes)) raw[key] = newValue;
      state = normalizeSyncState(raw);
      applyTheme(state.theme);
      render();
    }
  });

  /* ── Init ─────────────────────────────────────────────────── */

  const init = async () => {
    applyI18n();
    const [[activeTab], syncState, hideCount, hasAllSites] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      getSyncState(),
      getHideCount(),
      chrome.permissions.contains(ALL_SITES).catch(() => true),
    ]);
    tab = activeTab ?? null;
    page = describeUrl(tab?.url ?? '');
    state = syncState;
    applyTheme(state.theme);
    renderHideCount(hideCount);
    ui.permissionNotice.classList.toggle('visible', !hasAllSites);
    render();
  };

  init().catch((err) => console.error('[Popup] Init failed', err));
})();
