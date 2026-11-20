(() => {
  // Every key exists in _locales/en (checked by test/verify-integrity.js), so a missing
  // message means a typo: show the key itself so it is easy to spot.
  const getMessage = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

  // data-i18n fills the text (or the placeholder of a form field); the others fill attributes
  const ATTRIBUTE_BINDINGS = [
    ['data-i18n-title', 'title'],
    ['data-i18n-aria-label', 'aria-label'],
  ];

  const applyI18n = (root = document) => {
    // Match document language and direction to the UI locale (needed for RTL languages such as Arabic)
    const html = document.documentElement;
    html.lang = chrome.i18n.getMessage('@@ui_locale').replace(/_/g, '-') || html.lang;
    html.dir = chrome.i18n.getMessage('@@bidi_dir') === 'rtl' ? 'rtl' : 'ltr';

    root.querySelectorAll('[data-i18n]').forEach((element) => {
      const message = getMessage(element.getAttribute('data-i18n'));
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        element.placeholder = message;
      } else {
        element.textContent = message;
      }
    });

    for (const [dataAttr, targetAttr] of ATTRIBUTE_BINDINGS) {
      root.querySelectorAll(`[${dataAttr}]`).forEach((element) => {
        element.setAttribute(targetAttr, getMessage(element.getAttribute(dataAttr)));
      });
    }
  };

  const ScrollHideI18n = { applyI18n, getMessage };

  // Global assignment for HTML script tags
  globalThis.ScrollHideI18n = ScrollHideI18n;
})();
