const warned = new Set();

/**
 * Warn once per component type when a field is used outside a Form
 *
 * @param {object} context the form context
 * @param {string} component the component name
 * @returns {boolean} warned?
 */
export function warnOutsideForm(context, component) {
  if (context && context._henriForm) {
    return false;
  }

  if (!warned.has(component)) {
    warned.add(component);
    // eslint-disable-next-line no-console
    console.warn(`${component} component used outside henri form.`);
  }

  return true;
}
