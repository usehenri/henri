// The models, the migrations and the routes table.
//
// The test database is pushed from the models on boot (config/test.json has
// no "sync": false), while development and production go through
// db/migrations. This file is what keeps the two honest: it asks the adapter
// for the difference between the last migration and the current models, and
// fails when somebody changed a model without running `henri db:generate`.
const routes = require('../config/routes');

describe('the schema', () => {
  test('db/migrations is up to date with the models', async () => {
    const { migrations } = henri.model.stores.default;
    const journal = migrations.journal();
    const previous = await migrations.lastSnapshot(journal);
    const current = await migrations.snapshot(undefined, previous.id);
    const statements = await migrations.diff(previous, current);

    expect(journal.entries.length).toBeGreaterThan(0);
    expect(statements).toEqual([]);
  });

  test('the store is Drizzle on PostgreSQL', async () => {
    const store = henri.model.stores.default;

    expect(store.adapterName).toBe('drizzle');
    expect(store.dialect.name).toBe('postgres');
    expect(await store.ping()).toBe(true);
  });

  test('every model is a global', () => {
    expect(Object.keys(henri.model.stores.default.getModels()).sort()).toEqual([
      'Event',
      'Proposal',
      'Review',
      'Track',
      'User',
    ]);
  });

  test('the associations are declared on both sides', () => {
    const named = (Model) =>
      Model.associations.map((entry) => `${entry.kind}:${entry.as}`).sort();

    expect(named(Proposal)).toEqual([
      'belongsTo:event',
      'belongsTo:speaker',
      'belongsTo:track',
      'hasMany:reviews',
    ]);
    expect(named(Event)).toEqual(['hasMany:proposals', 'hasMany:tracks']);
    expect(named(Review)).toEqual(['belongsTo:proposal', 'belongsTo:reviewer']);
  });

  test('the user model gets email, password and roles from the adapter', () => {
    expect(User.fields.email).toMatchObject({ required: true, unique: true });
    expect(User.fields.password).toMatchObject({ hidden: true });
    expect(User.fields.roles).toMatchObject({ type: 'json' });
  });

  test('Proposal is paranoid and Review is not', () => {
    expect(Proposal.paranoid).toBe(true);
    expect(Review.paranoid).toBe(false);
  });
});

describe('the routes table', () => {
  /**
   * The expanded route for a verb and a path
   *
   * @param {string} verb The http verb
   * @param {string} path The path
   * @returns {?object} The route
   */
  const route = (verb, path) => henri.router.routes[`${verb} ${path}`];

  test('config/routes.js expands to what the application answers', () => {
    expect(Object.keys(henri.router.routes)).toHaveLength(31);
  });

  test('root maps GET / to an action', () => {
    expect(routes.root).toBe('main#home');
    expect(route('get', '/').controller).toBe('main#home');
  });

  test('`except` drops the destroy route of the proposals', () => {
    expect(route('delete', '/proposals/:id')).toBeUndefined();
    expect(route('get', '/proposals/:id').controller).toBe('proposals#show');
    expect(route('patch', '/proposals/:id').controller).toBe(
      'proposals#update'
    );
  });

  test('`only` keeps two actions of the editions', () => {
    expect(route('get', '/events').controller).toBe('events#index');
    expect(route('get', '/events/:id').controller).toBe('events#show');
    expect(route('post', '/events')).toBeUndefined();
    expect(route('get', '/events/new')).toBeUndefined();
  });

  test('a collection route is registered before /:id', () => {
    const paths = Object.keys(henri.router.routes);

    expect(paths.indexOf('get /proposals/mine')).toBeLessThan(
      paths.indexOf('get /proposals/:id')
    );
  });

  test('member routes hang under one record', () => {
    expect(route('post', '/proposals/:id/submit').controller).toBe(
      'proposals#submit'
    );
    expect(route('post', '/proposals/:id/withdraw').roles).toEqual(['speaker']);
  });

  test('the namespace prefixes the path and the controller', () => {
    expect(route('get', '/admin').controller).toBe('admin/dashboard#index');
    expect(route('get', '/admin/proposals').controller).toBe(
      'admin/proposals#index'
    );
    expect(route('get', '/admin/users').roles).toEqual(['admin']);
  });

  test('the nested resource is parameterized by its parent', () => {
    expect(route('get', '/proposals/:proposal_id/reviews').controller).toBe(
      'reviews#index'
    );
    expect(route('post', '/proposals/:proposal_id/reviews').roles).toEqual([
      'admin',
    ]);
  });

  test('the proposals routes declare an API version', () => {
    expect(route('get', '/proposals').version).toBe('v1');
  });

  test('every route points at an action that exists', () => {
    const missing = Object.values(henri.router.routes).filter(
      (entry) => typeof henri.controllers.get(entry.controller) !== 'function'
    );

    expect(missing.map((entry) => entry.controller)).toEqual([]);
  });
});
