/**
 * A minimal henri stand-in
 *
 * The engine only ever touches `config`, `pen`, `isProduction`,
 * `addMiddleware` and `utils.isLoopback`, so the suites build one of these
 * rather than booting an application: the module is what is under test, not
 * core.
 *
 * @param {object} [options={}] `graphql` (the configured endpoint or block)
 * @returns {object} A fake henri, with the pen calls in `calls` and the
 *   registered middlewares in `middlewares`
 */
const fakeHenri = (options = {}) => {
  const calls = [];
  const middlewares = [];
  const pen = {};

  for (const level of ['error', 'info', 'warn']) {
    pen[level] = (...args) => calls.push([level, ...args]);
  }

  return {
    addMiddleware: (name, func) => middlewares.push([name, func]),
    calls,
    config: {
      get: () => options.graphql,
      has: (key) => key === 'graphql' && typeof options.graphql !== 'undefined',
    },
    isProduction: false,
    middlewares,
    pen,
    // The same predicate core uses, reached the way the engine reaches it
    utils: { isLoopback: require('@usehenri/core/src/utils').isLoopback },
  };
};

module.exports = { fakeHenri };
