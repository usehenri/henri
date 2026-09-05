/**
 * The client helpers are ESM: loaded with import() (jest needs
 * --experimental-vm-modules, which `pnpm test` sets; vitest is native).
 */
const paths = {
  edit_tasks_path: { method: 'get', route: '/tasks/:id/edit' },
  index_tasks_path: { method: 'get', route: '/tasks' },
  show_users_path: { method: 'get', route: '/orgs/:org/users/:id' },
  update_tasks_path: { method: 'patch', route: '/tasks/:id' },
};

describe('paths', () => {
  let getRoute;
  let pathFor;
  let normalizeAction;
  let resolvePage;
  let warnings;
  let warn;

  beforeAll(async () => {
    ({ getRoute, pathFor } = await import('../src/paths.mjs'));
    ({ normalizeAction } = await import('../src/form.mjs').catch(() => ({
      // The form helpers need react and @inertiajs/react: skip when absent
      normalizeAction: null,
    })));
    ({ resolvePage } = await import('../src/resolve.mjs'));
  });

  /* eslint-disable no-console */
  beforeEach(() => {
    warnings = [];
    warn = console.warn;
    console.warn = (...args) => warnings.push(args);
  });

  afterEach(() => {
    console.warn = warn;
  });
  /* eslint-enable no-console */

  describe('pathFor', () => {
    test('returns the raw entry without params', () => {
      expect(pathFor(paths, 'index_tasks_path')).toEqual(
        paths.index_tasks_path
      );
    });

    test('fills :id from a string', () => {
      expect(pathFor(paths, 'edit_tasks_path', '42')).toBe('/tasks/42/edit');
    });

    test('fills :id from an object with an id and stringifies to the route', () => {
      const result = pathFor(paths, 'update_tasks_path', { id: 7 });

      expect(result.route).toBe('/tasks/7');
      expect(result.method).toBe('patch');
      expect(`${result}`).toBe('/tasks/7');
      expect(Object.keys(result)).toEqual(['method', 'route']);
    });

    test('fills several params', () => {
      const result = pathFor(paths, 'show_users_path', { id: 3, org: 'acme' });

      expect(result.route).toBe('/orgs/acme/users/3');
    });

    test('warns and returns undefined for unknown paths', () => {
      expect(pathFor(paths, 'nope_path', '1')).toBeUndefined();
      expect(warnings).toHaveLength(1);
    });

    test('warns when params cannot be matched', () => {
      expect(pathFor(paths, 'edit_tasks_path', {})).toBeUndefined();
      expect(warnings).toHaveLength(1);
    });
  });

  describe('getRoute', () => {
    test('returns the route', () => {
      expect(getRoute(paths, 'index_tasks_path')).toBe('/tasks');
    });

    test('replaces :id', () => {
      expect(getRoute(paths, 'edit_tasks_path', 9)).toBe('/tasks/9/edit');
    });

    test('returns route-not-found for unknown routes', () => {
      expect(getRoute(paths, 'missing_path')).toBe('route-not-found');
      expect(getRoute(undefined, 'index_tasks_path')).toBe('route-not-found');
    });
  });

  describe('normalizeAction (Form)', () => {
    test('accepts a route string, a pathFor() result and a url/method pair', () => {
      if (!normalizeAction) {
        return;
      }

      expect(normalizeAction('/tasks')).toEqual({
        method: 'post',
        url: '/tasks',
      });
      expect(normalizeAction('/tasks', 'DELETE')).toEqual({
        method: 'delete',
        url: '/tasks',
      });
      expect(
        normalizeAction(pathFor(paths, 'update_tasks_path', { id: 7 }))
      ).toEqual({ method: 'patch', url: '/tasks/7' });
      expect(normalizeAction(paths.index_tasks_path, 'post')).toEqual({
        method: 'post',
        url: '/tasks',
      });
      expect(normalizeAction({ method: 'put', url: '/x' })).toEqual({
        method: 'put',
        url: '/x',
      });
      expect(normalizeAction(undefined)).toEqual({ method: 'post', url: '' });
    });
  });

  describe('resolvePage', () => {
    const pages = {
      './pages/index.jsx': () => Promise.resolve({ default: 'home' }),
      './pages/tasks/index.jsx': () => Promise.resolve({ default: 'tasks' }),
      './pages/users/show.jsx': { default: 'user' },
    };

    test('maps a component name to its page module', async () => {
      expect(await resolvePage(pages, 'index')).toEqual({ default: 'home' });
      expect(await resolvePage(pages, '/index/')).toEqual({ default: 'home' });
      expect(await resolvePage(pages, 'tasks/index')).toEqual({
        default: 'tasks',
      });
      expect(await resolvePage(pages, 'tasks')).toEqual({ default: 'tasks' });
      expect(resolvePage(pages, 'users/show')).toEqual({ default: 'user' });
    });

    test('lists the candidates and the available pages when missing', () => {
      expect(() => resolvePage(pages, 'nope')).toThrow(
        /page 'nope' not found.*\.\/pages\/nope\.jsx.*Available pages: \.\/pages\/index\.jsx/
      );
    });
  });
});
