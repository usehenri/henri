/**
 * Runs against the compiled output: build the package first (`yarn build`).
 */
const { getRoute, pathFor } = require('../dist/lib/paths');

const paths = {
  edit_tasks_path: { method: 'get', route: '/tasks/:id/edit' },
  index_tasks_path: { method: 'get', route: '/tasks' },
  show_users_path: { method: 'get', route: '/orgs/:org/users/:id' },
  update_tasks_path: { method: 'patch', route: '/tasks/:id' },
};

describe('paths', () => {
  let warn;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('pathFor', () => {
    test('returns the raw entry without params', () => {
      expect(pathFor(paths, 'index_tasks_path')).toEqual(paths.index_tasks_path);
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
      expect(warn).toHaveBeenCalledTimes(1);
    });

    test('warns when params cannot be matched', () => {
      expect(pathFor(paths, 'edit_tasks_path', {})).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
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
});
