const {
  controllerOf,
  expand,
  expandEntry,
  normalize,
  singularize,
  table,
} = require('../base/routes');

/**
 * The `verb path` keys of an expansion, in order
 *
 * @param {Array<object>} routes expanded routes
 * @returns {Array<string>} the keys
 */
const keys = (routes) =>
  routes.map((route) => `${route.verb.toUpperCase()} ${route.route}`);

/**
 * The path helpers of an expansion, in order
 *
 * @param {Array<object>} routes expanded routes
 * @returns {Array<string>} the helper names
 */
const helpers = (routes) => routes.map((route) => route.path);

describe('routes dsl', () => {
  describe('plain routes', () => {
    test('a key without a verb defaults to get', () => {
      expect(expandEntry('/', 'main#home')).toEqual([
        {
          controller: 'main#home',
          path: 'home_main_path',
          route: '/',
          verb: 'get',
        },
      ]);
      expect(expandEntry('/test', 'user#info')[0].verb).toBe('get');
    });

    test('an unknown verb falls back to get and keeps the path', () => {
      expect(expandEntry('teleport /there', 'main#there')[0]).toMatchObject({
        route: '/there',
        verb: 'get',
      });
    });

    test('the options of the entry travel with the route', () => {
      const [route] = expandEntry('post /reports', {
        controller: 'reports#create',
        rateLimit: { max: 5, windowMs: 60000 },
        roles: ['admin'],
      });

      expect(route).toMatchObject({
        controller: 'reports#create',
        path: 'create_reports_path',
        rateLimit: { max: 5, windowMs: 60000 },
        roles: ['admin'],
        verb: 'post',
      });
      expect(route.resource).toBeUndefined();
    });

    test('an entry without a controller is dropped', () => {
      expect(expandEntry('get /nothing', {})).toEqual([]);
    });
  });

  describe('root', () => {
    test('maps / to a controller action', () => {
      expect(expandEntry('root', 'main#home')).toEqual([
        {
          controller: 'main#home',
          path: 'home_main_path',
          route: '/',
          verb: 'get',
        },
      ]);
    });

    test('takes options like any other route', () => {
      expect(
        expandEntry('root', { controller: 'admin#index', roles: 'admin' })[0]
      ).toMatchObject({ roles: 'admin', route: '/' });
    });
  });

  describe('resources and crud', () => {
    test('resources expands into the seven rails actions', () => {
      const routes = expandEntry('resources tasks', 'tasks');

      expect(keys(routes)).toEqual([
        'GET /tasks',
        'POST /tasks',
        'PATCH /tasks/:id',
        'PUT /tasks/:id',
        'DELETE /tasks/:id',
        'GET /tasks/:id/edit',
        'GET /tasks/new',
        'GET /tasks/:id',
      ]);
      expect(helpers(routes)).toEqual([
        'index_tasks_path',
        'create_tasks_path',
        'update_tasks_path',
        'update_tasks_path',
        'destroy_tasks_path',
        'edit_tasks_path',
        'new_tasks_path',
        'show_tasks_path',
      ]);
      expect(routes.every((route) => route.resource === true)).toBe(true);
    });

    test('the controller defaults to the name of the resource', () => {
      expect(expandEntry('crud items', { scope: 'api' })[0]).toMatchObject({
        controller: 'items#index',
        route: '/api/items',
      });
    });

    test('crud stops at the four json actions', () => {
      expect(keys(expandEntry('crud items', 'items'))).toEqual([
        'GET /items',
        'POST /items',
        'PATCH /items/:id',
        'PUT /items/:id',
        'DELETE /items/:id',
      ]);
    });

    test('only keeps the actions it lists, in the rails order', () => {
      expect(
        keys(
          expandEntry('resources tasks', {
            controller: 'tasks',
            only: ['show', 'index'],
          })
        )
      ).toEqual(['GET /tasks', 'GET /tasks/:id']);
    });

    test('except drops the actions it lists', () => {
      expect(
        keys(
          expandEntry('resources tasks', {
            controller: 'tasks',
            except: ['destroy', 'edit', 'new'],
          })
        )
      ).toEqual([
        'GET /tasks',
        'POST /tasks',
        'PATCH /tasks/:id',
        'PUT /tasks/:id',
        'GET /tasks/:id',
      ]);
    });

    test('omit still works as an alias of except', () => {
      expect(
        keys(
          expandEntry('crud items', {
            controller: 'items',
            omit: ['destroy'],
            scope: 'api',
          })
        )
      ).toEqual([
        'GET /api/items',
        'POST /api/items',
        'PATCH /api/items/:id',
        'PUT /api/items/:id',
      ]);
    });

    test('only and except accept a single string', () => {
      expect(
        keys(expandEntry('crud items', { controller: 'items', only: 'index' }))
      ).toEqual(['GET /items']);
      expect(
        keys(
          expandEntry('crud items', { controller: 'items', except: 'index' })
        )
      ).toEqual([
        'POST /items',
        'PATCH /items/:id',
        'PUT /items/:id',
        'DELETE /items/:id',
      ]);
    });

    test('the structural options never reach a route', () => {
      const [route] = expandEntry('resources tasks', {
        collection: {},
        controller: 'tasks',
        except: ['show'],
        member: {},
        nested: {},
        only: ['index'],
        param: 'task_id',
        roles: ['admin'],
      });

      expect(route.roles).toEqual(['admin']);
      expect(Object.keys(route).sort()).toEqual([
        'controller',
        'path',
        'resource',
        'roles',
        'route',
        'verb',
      ]);
    });
  });

  describe('member and collection', () => {
    test('adds routes on the collection and on one record', () => {
      const routes = expandEntry('resources tasks', {
        collection: { 'get search': 'search' },
        controller: 'tasks',
        member: { 'post archive': 'archive' },
        only: ['index', 'show'],
      });

      expect(keys(routes)).toEqual([
        'GET /tasks',
        'GET /tasks/search',
        'POST /tasks/:id/archive',
        'GET /tasks/:id',
      ]);
      expect(helpers(routes)).toEqual([
        'index_tasks_path',
        'search_tasks_path',
        'archive_tasks_path',
        'show_tasks_path',
      ]);
    });

    test('the collection routes come before /:id so they are reachable', () => {
      const routes = expandEntry('resources tasks', {
        collection: ['get search'],
        controller: 'tasks',
      });
      const search = keys(routes).indexOf('GET /tasks/search');
      const show = keys(routes).indexOf('GET /tasks/:id');

      expect(search).toBeGreaterThan(-1);
      expect(search).toBeLessThan(show);
    });

    test('an array of keys names the action after the segment', () => {
      expect(
        expandEntry('resources tasks', {
          controller: 'tasks',
          member: ['post archive', 'preview'],
          only: [],
        })
      ).toEqual([
        {
          controller: 'tasks#archive',
          path: 'archive_tasks_path',
          route: '/tasks/:id/archive',
          verb: 'post',
        },
        {
          controller: 'tasks#preview',
          path: 'preview_tasks_path',
          route: '/tasks/:id/preview',
          verb: 'get',
        },
      ]);
    });

    test('an extra route inherits the options of the resource and may override them', () => {
      const [search, archive] = expandEntry('resources tasks', {
        collection: { 'get search': 'search' },
        controller: 'tasks',
        member: { 'post archive': { action: 'archive', roles: ['admin'] } },
        only: [],
        roles: ['member'],
      });

      expect(search.roles).toEqual(['member']);
      expect(archive.roles).toEqual(['admin']);
      expect(search.resource).toBeUndefined();
    });

    test('a full controller#action may be given', () => {
      expect(
        expandEntry('resources tasks', {
          collection: { 'get stats': 'reports#tasks' },
          controller: 'tasks',
          only: [],
        })[0]
      ).toMatchObject({
        controller: 'reports#tasks',
        path: 'tasks_reports_path',
        route: '/tasks/stats',
      });
    });
  });

  describe('namespace', () => {
    test('prefixes the path and the controller', () => {
      const routes = expandEntry('namespace admin', {
        'get /dashboard': 'dashboard#index',
        'resources users': { only: ['index'] },
      });

      expect(routes).toEqual([
        {
          controller: 'admin/dashboard#index',
          path: 'index_admin/dashboard_path',
          route: '/admin/dashboard',
          verb: 'get',
        },
        {
          controller: 'admin/users#index',
          path: 'index_admin/users_path',
          resource: true,
          route: '/admin/users',
          verb: 'get',
        },
      ]);
    });

    test('nests', () => {
      expect(
        expandEntry('namespace admin', {
          'namespace reports': { 'get /daily': 'daily#index' },
        })[0]
      ).toMatchObject({
        controller: 'admin/reports/daily#index',
        route: '/admin/reports/daily',
      });
    });

    test('a controller already namespaced is not prefixed twice', () => {
      expect(
        expandEntry('namespace admin', { 'get /users': 'admin/users#index' })[0]
          .controller
      ).toBe('admin/users#index');
    });

    test('an empty or invalid namespace yields nothing', () => {
      expect(expandEntry('namespace admin', 'oops')).toEqual([]);
    });
  });

  describe('nested resources', () => {
    test('nests under the singular parameter of the parent', () => {
      const routes = expandEntry('resources tasks', {
        controller: 'tasks',
        nested: { 'resources comments': { only: ['index', 'create'] } },
        only: ['index'],
      });

      expect(keys(routes)).toEqual([
        'GET /tasks',
        'GET /tasks/:task_id/comments',
        'POST /tasks/:task_id/comments',
      ]);
      expect(routes[1].path).toBe('index_comments_path');
    });

    test('singularizes the usual plurals', () => {
      expect(singularize('tasks')).toBe('task');
      expect(singularize('categories')).toBe('category');
      expect(singularize('boxes')).toBe('box');
      expect(singularize('addresses')).toBe('address');
      expect(singularize('status')).toBe('status');
      expect(singularize('media')).toBe('media');
    });

    test('param overrides the parameter name', () => {
      expect(
        expandEntry('resources categories', {
          controller: 'categories',
          nested: { 'get /tree': 'tree#show' },
          only: [],
          param: 'slug',
        })[0].route
      ).toBe('/categories/:slug/tree');
    });

    test('a plain route nests too, and namespaces travel down', () => {
      expect(
        expandEntry('namespace admin', {
          'resources tasks': {
            nested: { 'post /import': 'imports#create' },
            only: [],
          },
        })[0]
      ).toMatchObject({
        controller: 'admin/imports#create',
        route: '/admin/tasks/:task_id/import',
        verb: 'post',
      });
    });
  });

  describe('expand and table', () => {
    test('later keys win and keep the position of the first one', () => {
      const routes = expand({
        'get /admin': { controller: 'admin#index', roles: ['admin'] },
        'get /same': 'a#one',
        // eslint-disable-next-line sort-keys
        'GET /same': 'b#two',
      });

      expect(routes).toHaveLength(2);
      expect(routes[0].roles).toEqual(['admin']);
      expect(routes[1].controller).toBe('b#two');
    });

    test('null and undefined entries are skipped', () => {
      expect(expand({ 'get /a': null, 'get /b': undefined })).toEqual([]);
      expect(expand()).toEqual([]);
    });

    test('table keys the routes by verb and path', () => {
      const raw = { root: 'main#home' };

      raw['resources tasks'] = 'tasks';

      expect(Object.keys(table(raw))).toEqual([
        'get /',
        'get /tasks',
        'post /tasks',
        'patch /tasks/:id',
        'put /tasks/:id',
        'delete /tasks/:id',
        'get /tasks/:id/edit',
        'get /tasks/new',
        'get /tasks/:id',
      ]);
    });

    test('finds the controller of an entry', () => {
      expect(controllerOf('main#home')).toBe('main');
      expect(controllerOf({ controller: 'items#index' })).toBe('items');
      expect(controllerOf({})).toBeNull();
    });

    test('normalizes the paths', () => {
      expect(normalize('tasks')).toBe('/tasks');
      expect(normalize('/api//v1/tasks/')).toBe('/api/v1/tasks');
      expect(normalize('/')).toBe('/');
    });
  });

  describe('refusing what will not resolve', () => {
    test('a controller with a space is refused where it is written', () => {
      // A trailing space used to travel to the loader and surface as a
      // missing controller, sending the reader to look for a file that is
      // right there
      expect(() =>
        expand({ 'resources ship': { controller: 'ship ' } })
      ).toThrow(/not a controller name/);
      expect(() => expand({ 'get /x': 'a b#index' })).toThrow(
        /not a controller name/
      );
      expect(() => expand({ 'get /y': 'tasks#in dex' })).toThrow(
        /not an action name/
      );
    });

    test('a namespaced controller is still a name', () => {
      expect(expand({ 'get /a': 'admin/tasks#index' })).toHaveLength(1);
      expect(expand({ 'get /b': 'my-tasks#index' })).toHaveLength(1);
      expect(expand({ 'get /c': 'tasks_2#index' })).toHaveLength(1);
    });
  });

  describe('a route that overrides another', () => {
    test('says which entry took it, and from whom', () => {
      const overrides = [];

      expand(
        {
          'get /tasks': 'legacy#index',
          'resources tasks': { controller: 'tasks' },
        },
        { onOverride: (event) => overrides.push(event) }
      );

      expect(overrides).toHaveLength(1);
      expect(overrides[0]).toMatchObject({
        by: 'resources tasks',
        controller: 'tasks#index',
        declaredBy: 'get /tasks',
        previous: 'legacy#index',
        route: 'get /tasks',
      });
    });

    test('stays quiet when the same entry is simply repeated', () => {
      const overrides = [];

      expand(
        { 'get /tasks': 'tasks#index' },
        { onOverride: (event) => overrides.push(event) }
      );

      expect(overrides).toHaveLength(0);
    });
  });
});
