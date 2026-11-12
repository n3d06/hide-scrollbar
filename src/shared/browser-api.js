(() => {
  const getActiveTab = async () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0] || null;
    }
    return null;
  };

  const ScrollHideBrowserApi = {
    getActiveTab,
  };

  // Global assignment for HTML script tags
  globalThis.ScrollHideBrowserApi = ScrollHideBrowserApi;
})();
