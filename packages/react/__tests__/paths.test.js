/**
 * Runs against the compiled output: build the package first (`pnpm build`).
 */
const { fill, getRoute, pathFor } = require('../dist/lib/paths');

/* eslint-disable camelcase */
const paths = {
  edit_tasks_path: { method: 'get', route: '/tasks/:id/edit' },
  index_tasks_path: { method: 'get', route: '/tasks' },
  show_docs_path: { method: 'get', route: '/docs/:identifier/:id' },
  show_users_path: { method: 'get', route: '/orgs/:org/users/:id' },
  update_tasks_path: { method: 'patch', route: '/tasks/:id' },
};
/* eslint-enable camelcase */

describe('paths', () => {
  let warn;
  let warnings;

  beforeEach(() => {
    warnings = [];
    warn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
  });

  afterEach(() => {
    console.warn = warn;
  });

  describe('fill', () => {
    test('replaces whole parameter names only', () => {
      expect(fill('/docs/:identifier/:id', 'id', 5)).toBe(
        '/docs/:identifier/5'
      );
      expect(fill('/a/:id/b/:id', 'id', 'x')).toBe('/a/x/b/x');
      expect(fill('/a/:id.json', 'id', 1)).toBe('/a/1.json');
    });
  });

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

    test('does not confuse :id with :identifier', () => {
      expect(pathFor(paths, 'show_docs_path', '9')).toBe('/docs/:identifier/9');
      expect(
        pathFor(paths, 'show_docs_path', { id: 9, identifier: 'readme' }).route
      ).toBe('/docs/readme/9');
    });

    test('stringifies ObjectId-like params', () => {
      const oid = { toString: () => '64b0c2f4e1a2b3c4d5e6f708' };

      expect(pathFor(paths, 'update_tasks_path', { id: oid }).route).toBe(
        '/tasks/64b0c2f4e1a2b3c4d5e6f708'
      );
    });

    test('warns and returns undefined for unknown paths', () => {
      expect(pathFor(paths, 'nope_path', '1')).toBeUndefined();
      expect(warnings.length).toBe(1);
    });

    test('warns when params cannot be matched', () => {
      expect(pathFor(paths, 'edit_tasks_path', {})).toBeUndefined();
      expect(warnings.length).toBe(1);
    });
  });

  describe('getRoute', () => {
    test('returns the route', () => {
      expect(getRoute(paths, 'index_tasks_path')).toBe('/tasks');
    });

    test('replaces :id', () => {
      expect(getRoute(paths, 'edit_tasks_path', 9)).toBe('/tasks/9/edit');
      expect(getRoute(paths, 'show_docs_path', 9)).toBe('/docs/:identifier/9');
    });

    test('returns route-not-found for unknown routes', () => {
      expect(getRoute(paths, 'missing_path')).toBe('route-not-found');
      expect(getRoute(undefined, 'index_tasks_path')).toBe('route-not-found');
    });
  });
});
