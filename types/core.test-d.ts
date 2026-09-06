// The declarations of @usehenri/core, checked.
//
// A line marked `@ts-expect-error` must fail to compile: tsc reports the
// comment itself when the code below it turns out to be valid, so the wrong
// calls here are as much a test as the right ones.

import type {
  BootAnalysis,
  Boom,
  Configuration,
  Controller,
  Henri,
  HenriModule,
  Job,
  JobDefinition,
  JobStats,
  ModelFile,
  Page,
  Pagination,
  PublicUser,
  Request,
  Response,
  RoutesFile,
  ViewOptions,
} from '@usehenri/core';

/** Asserts that `Actual` and `Expected` are the same type. */
declare function expectType<Expected>(value: Expected): void;

declare const req: Request;
declare const res: Response;

// --- the henri global -------------------------------------------------------

expectType<Henri>(henri);
expectType<string>(henri.release);
expectType<boolean>(henri.isProduction);
expectType<string>(henri.cwd());
expectType<Promise<Error[]>>(henri.stop());
expectType<boolean>(henri.addMiddleware('metrics', (router) => router.use()));

// config.get() takes the type of the value from the caller
expectType<string>(henri.config.get<string>('stores.default.adapter'));
expectType<string | false>(henri.config.get<string>('mail', true));
expectType<boolean>(henri.config.has('baseRole'));

// pen.fatal() returns an error to throw, it does not throw one
expectType<Error>(henri.pen.fatal('view', 'unknown renderer'));
henri.pen.info('boot', 'ready', 42);

expectType<PublicUser | null>(henri.user.publicUser(req.user));

// The public projection carries the uuid, not the primary key
const publicUser = henri.user.publicUser(req.user);

if (publicUser) {
  expectType<string | undefined>(publicUser.externalId);
  expectType<string>(publicUser.email);
}
expectType<Promise<string>>(henri.user.encrypt('a-password', 12));
expectType<Record<string, string> | null>(henri.model.errors(new Error('x')));
expectType<string>(henri.gql`{ tasks { id } }`);

// --- the module system ------------------------------------------------------

// A module of an application: it says where it goes by name, not by number
const metrics: HenriModule = {
  name: 'metrics',
  needs: ['server'],
  before: ['router'],
  runlevel: 5,
  async init() {
    return 'metrics';
  },
  async release() {
    return true;
  },
};

expectType<boolean>(henri.modules.add(metrics));
expectType<Promise<string[]>>(henri.modules.discover());
expectType<HenriModule[]>(henri.modules.stopOrder);
expectType<BootAnalysis | null>(henri.analyze());
expectType<BootAnalysis | null>(henri.modules.analyze('router'));

const analysis = henri.analyze();

if (analysis) {
  expectType<boolean>(analysis.ok);
  expectType<number>(analysis.ceiling);
  expectType<string>(analysis.modules[0].name);
  expectType<'name' | 'runlevel'>(analysis.modules[0].pin);
  expectType<string>(analysis.modules[0].waitsOn[0].why);
  expectType<string[]>(analysis.chart[0].modules);
  expectType<string | null>(analysis.failed);
}

const badModule: HenriModule = {
  name: 'broken',
  // @ts-expect-error `needs` holds module names, not modules
  needs: [metrics],
  init() {
    return true;
  },
};

// @ts-expect-error a module has to implement init()
const noInit: HenriModule = {
  name: 'silent',
};

// @ts-expect-error `henri.pen.fatal` needs a name, not an object
henri.pen.fatal({ name: 'view' });

// @ts-expect-error there is no `henri.logger`
henri.logger.info('boot');

// @ts-expect-error `addMiddleware` takes a name and a function, in that order
henri.addMiddleware((router: unknown) => router, 'metrics');

// --- jobs -------------------------------------------------------------------

expectType<Promise<Job>>(henri.jobs.perform('welcome', { userId: 1 }));
expectType<Promise<Job>>(
  henri.jobs.perform('report', null, { priority: -10, queue: 'reports' })
);
expectType<Promise<Job>>(henri.jobs.performIn('5m', 'welcome', { userId: 1 }));
expectType<Promise<Job>>(henri.jobs.performAt(new Date(), 'welcome', null));
expectType<Promise<Job[]>>(henri.jobs.list({ state: 'pending' }));
expectType<Promise<JobStats>>(henri.jobs.stats());
expectType<Promise<Job | null>>(henri.jobs.dead.retry('an-id'));
expectType<Promise<number>>(henri.jobs.dead.discardAll({ queue: 'mailers' }));

const welcome: JobDefinition = {
  maxAttempts: 5,
  queue: 'mailers',
  timeout: '30s',

  perform: async (args, context) => {
    context.henri.pen.info('welcome', context.job.id, context.job.attempt);
    context.signal.throwIfAborted();

    return args;
  },
};

expectType<JobDefinition>(welcome);

// @ts-expect-error `pending` is a state, not a queue
henri.jobs.list({ state: 'sleeping' });

// @ts-expect-error a job file has to export a perform()
const broken: JobDefinition = { queue: 'default' };

// --- request ----------------------------------------------------------------

expectType<string>(req.id);
expectType<string | null>(req.apiVersion);
expectType<Record<string, unknown>>(req.permit('title', 'year'));
expectType<Record<string, unknown>>(req.permit(['title', 'year']));
expectType<Pagination>(req.pagination());
expectType<number>(req.pagination({ maxPerPage: 500 }).skip);
expectType<ViewOptions>(req._henri);
expectType<string | null>(req._henri.csrf);

// req.flash() is three functions in one
expectType<Record<string, unknown[]>>(req.flash());
expectType<unknown[]>(req.flash('notice'));
expectType<unknown[]>(req.flash('notice', 'Task saved'));

// express is still there
expectType<string>(req.originalUrl);
expectType<string | string[]>(req.params.id);

// @ts-expect-error `pagination` is a method, not a property
req.pagination.page;

// @ts-expect-error `permit` takes field names, not an object
req.permit({ title: true });

// @ts-expect-error there is no `req.paginate`
req.paginate();

// --- response ---------------------------------------------------------------

res.render('/tasks/index', { data: { tasks: [] } });
res.render('/tasks/index', { graphql: '{ tasks }' });
res.hbs('mail/welcome', { data: {} });
expectType<Boom>(res.boom);
res.boom.notFound('No such task', { id: 1 });
res.boom.badData('Invalid', { errors: { title: 'is required' } });
res.resource({ id: '1' }, { status: 201 });
res.collection([{ id: '1' }], { page: 1, perPage: 25, total: 1 });
res.collection([], { links: { search: '/tasks/search' } });
res.negotiate({ html: () => res.render('/tasks'), json: () => res.json([]) });
expectType<Promise<true>>(henri.user.compare('a-password', 'a-hash'));

// express is still there
res.status(204).json({ ok: true });
res.redirect('/tasks');

// @ts-expect-error `res.render()` does not take a callback, it is a promise
res.render('/tasks', {}, () => {});

// @ts-expect-error 500 is `internal`, there is no `res.boom.serverError`
res.boom.serverError('nope');

// @ts-expect-error `res.collection()` takes a list
res.collection({ id: '1' });

// @ts-expect-error `res.resource()` takes one record
res.resource([{ id: '1' }]);

// --- controllers ------------------------------------------------------------

const tasks: Controller = {
  before: {
    all: [(req, res, next) => next()],
    'show,edit': async (req) => {
      expectType<string>(req.id);
    },
  },
  index: async (req, res) => ({ tasks: await Promise.resolve([]) }),
  show: async (req, res) => {
    // the parameters are typed by the annotation alone
    expectType<Record<string, unknown>>(req.permit('id'));

    return res.boom.notFound();
  },
};

const listOfHooks: Controller = {
  before: [(req, res, next) => next(), { only: ['show'], run: async () => {} }],
  show: async () => ({}),
};

expectType<Controller>(tasks);
expectType<Controller>(listOfHooks);

const badHook: Controller = {
  // @ts-expect-error a `before` selector needs `run`
  before: [{ only: ['show'] }],
};

// --- routes -----------------------------------------------------------------

const routes: RoutesFile = {
  root: 'main#home',
  '/about': 'main#about',
  'get /tasks/mine': { controller: 'tasks#mine', roles: ['user'] },
  'post /tasks': 'tasks#create',
  'delete /tasks/:id': 'tasks#destroy',
  'resources tasks': {
    only: ['index', 'show', 'create'],
    collection: { 'get search': 'search' },
    member: { 'post archive': 'archive' },
    nested: { 'resources comments': 'comments' },
  },
  'crud items': { except: ['destroy'], roles: 'admin' },
  'namespace admin': {
    'resources users': { roles: ['admin'] },
    'get /dashboard': 'dashboard#index',
  },
};

expectType<RoutesFile>(routes);

const badRoutes: RoutesFile = {
  // @ts-expect-error `gett` is not a verb
  'gett /tasks': 'tasks#index',
};

const badResource: RoutesFile = {
  // @ts-expect-error `list` is not one of the seven resource actions
  'resources tasks': { only: ['list'] },
};

const badNamespace: RoutesFile = {
  // @ts-expect-error a namespace holds routes, not a controller name
  'namespace admin': 'admin#index',
};

// --- models -----------------------------------------------------------------

const model: ModelFile = {
  store: 'default',
  name: 'tasks',
  options: { paranoid: true, timestamps: true },
  schema: {
    title: { type: 'string', required: true, unique: true },
    body: 'text',
    status: { type: 'string', enum: ['todo', 'done'], default: 'todo' },
    meta: { type: 'json' },
  },
  associate(models) {
    expectType<Record<string, unknown>>(models);
  },
};

expectType<ModelFile>(model);

const badModel: ModelFile = {
  schema: {
    // @ts-expect-error `varchar` is not a henri field type
    title: { type: 'varchar', required: true },
  },
};

declare const page: Page<{ id: string }>;
expectType<{ id: string }[]>(page.records);
expectType<number>(page.pages);

// --- configuration ----------------------------------------------------------

const config: Configuration = {
  port: 3000,
  renderer: 'react',
  user: { model: 'user', public: ['name'], sessionMaxAge: 2592000000 },
  baseRole: 'guest',
  stores: { default: { adapter: 'disk', dbName: 'henri' } },
  api: { perPage: 25, maxPerPage: 100, strict: true, idempotency: false },
  rateLimit: { windowMs: 60000, max: 600, auth: { max: 10 } },
  helmet: false,
  requestTimeout: false,
};

expectType<Configuration>(config);

const badConfig: Configuration = {
  // @ts-expect-error `vue2` is not a renderer
  renderer: 'vue2',
};

const badStore: Configuration = {
  // @ts-expect-error `sqlite` is not an adapter package (use drizzle)
  stores: { default: { adapter: 'sqlite' } },
};

export {
  badConfig,
  badModule,
  noInit,
  badHook,
  badModel,
  badNamespace,
  badResource,
  badRoutes,
  badStore,
};
