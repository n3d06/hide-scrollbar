(() => {
  /**
   * document.getElementById that fails loudly: a missing element or one of the wrong
   * kind is a bug in the page, better reported at startup than as a null later on.
   * @template {Element} T
   * @param {string} id
   * @param {new () => T} [type] expected element class (HTMLElement if omitted)
   * @returns {T}
   */
  const getElement = (id, type = /** @type {any} */ (HTMLElement)) => {
    const element = document.getElementById(id);
    if (!(element instanceof type)) {
      throw new Error(`#${id} ${element ? `is not a ${type.name}` : 'is missing'}`);
    }
    return element;
  };

  // Global assignment for HTML script tags
  globalThis.ScrollHideDom = { getElement };
})();
