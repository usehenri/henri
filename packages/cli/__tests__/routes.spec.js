const { controllerOf, expand, expandEntry } = require('../scripts/routing');
const { table } = require('../scripts/routes');
const { cleanup, henri, scaffold } = require('./helpers');

describe('routes expansion', () => {
  test('expands a plain route with a default verb', () => {
    expect(expandEntry('/', 'main#home')).toEqual([
      {
        controller: 'main#home',
        path: 'home_main_path',
        route: '/',
        verb: 'get',
      },
    ]);
    expect(expandEntry('post /login', 'user#login')[0]).toMatchObject({
      route: '/login',
      verb: 'post',
    });
  });

  test('expands resources into the eight rails actions', () => {
    const routes = expandEntry('resources tasks', 'tasks');

    expect(routes.map((route) => `${route.verb} ${route.route}`)).toEqual([
      'get /tasks',
      'post /tasks',
      'patch /tasks/:id',
      'put /tasks/:id',
      'delete /tasks/:id',
      'get /tasks/:id/edit',
      'get /tasks/new',
      'get /tasks/:id',
    ]);
    expect(routes[0]).toMatchObject({
      controller: 'tasks#index',
      path: 'index_tasks_path',
    });
    expect(routes[7].controller).toBe('tasks#show');
  });

  test('expands crud without the page actions and honours omit and scope', () => {
    const routes = expandEntry('crud items', {
      controller: 'items',
      omit: ['destroy'],
      scope: 'api',
    });

    expect(routes.map((route) => `${route.verb} ${route.route}`)).toEqual([
      'get /api/items',
      'post /api/items',
      'patch /api/items/:id',
      'put /api/items/:id',
    ]);
  });

  test('keeps roles and lets later keys win', () => {
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

  test('finds the controller of an entry', () => {
    expect(controllerOf('main#home')).toBe('main');
    expect(controllerOf('tasks')).toBe('tasks');
    expect(controllerOf({ controller: 'items#index' })).toBe('items');
    expect(controllerOf({})).toBeNull();
  });

  test('renders an aligned table', () => {
    const out = table(
      expand({ 'get /': 'main#home', 'resources tasks': 'tasks' })
    );
    const lines = out.split('\n');

    expect(lines[0]).toMatch(/^Verb\s+Path\s+Controller\s+Helper$/);
    expect(lines[1]).toMatch(/^GET\s+\/\s+main#home\s+home_main_path$/);
    expect(lines).toHaveLength(10);
  });
});

describe('henri routes', () => {
  let dir;
  let app;

  beforeAll(() => {
    ({ app, dir } = scaffold());
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('prints the routes of the app without booting it', () => {
    const { status, stdout } = henri(['routes'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toMatch(/GET\s+\/\s+main#home\s+home_main_path/);
    expect(stdout).toMatch(/POST\s+\/tasks\s+tasks#create\s+create_tasks_path/);
    expect(stdout).toContain('9 routes');
  });

  test('prints json with --json', () => {
    const { status, stdout } = henri(['routes', '--json'], { cwd: app });

    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toHaveLength(9);
  });

  test('refuses to run outside of a project with exit code 3', () => {
    const { status } = henri(['routes'], { cwd: dir });

    expect(status).toBe(3);
  });
});
