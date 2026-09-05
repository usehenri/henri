/**
 * Resolve an Inertia component name to a page module of `import.meta.glob()`
 *
 * The name is the route passed to res.render() without its leading slash
 * ('tasks/index'). Both `pages/<name>.jsx` and `pages/<name>/index.jsx` are
 * accepted, so `res.render('/tasks')` finds `pages/tasks/index.jsx`.
 *
 * @param {object} pages the glob result (lazy or eager)
 * @param {string} name the component name
 * @param {object} [options] options
 * @param {string} [options.dir='./pages'] the glob prefix
 * @param {string[]} [options.extensions] extensions to try
 * @returns {(Promise<object>|object)} the page module
 * @throws when no page matches
 */
export function resolvePage(
  pages,
  name,
  { dir = './pages', extensions = ['jsx', 'tsx', 'js', 'ts'] } = {}
) {
  const clean = String(name || 'index')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  const candidates = [];

  for (const ext of extensions) {
    candidates.push(`${dir}/${clean}.${ext}`, `${dir}/${clean}/index.${ext}`);
  }

  const key = candidates.find((candidate) =>
    Object.prototype.hasOwnProperty.call(pages, candidate)
  );

  if (!key) {
    throw new Error(
      `inertia: page '${clean}' not found (looked for ${candidates.join(
        ', '
      )}). Available pages: ${Object.keys(pages).join(', ') || 'none'}`
    );
  }

  const page = pages[key];

  return typeof page === 'function' ? page() : page;
}
