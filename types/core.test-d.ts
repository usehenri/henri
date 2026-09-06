// The declarations of @usehenri/core, checked.
//
// A line marked `@ts-expect-error` must fail to compile: tsc reports the
// comment itself when the code below it turns out to be valid, so the wrong
// calls here are as much a test as the right ones.

import type {
  AccountResult,
  AccountSettings,
  BootAnalysis,
  Boom,
  Cache,
  CacheStats,
  Configuration,
  Controller,
  Henri,
  HenriModule,
  Job,
  JobDefinition,
  JobStats,
  EncryptionFieldStatus,
  ErasureReceipt,
  ModelFile,
  Page,
  ParamRule,
  PersonalExport,
  UnreadableValue,
  Pagination,
  Policy,
  PoliciesModule,
  PublicUser,
  Request,
  Response,
  RoutesFile,
  SharedStore,
  StoredFile,
  UploadedFile,
  ViewOptions,
  WebhookDelivery,
  WebhookEndpoint,
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
expectType<Error>(
  henri.pen.fatal(
    'view',
    'unknown renderer',
    null,
    null,
    'HENRI_VIEW_UNKNOWN_RENDERER'
  )
);
henri.pen.info('boot', 'ready', 42);

expectType<PublicUser | null>(henri.user.publicUser(req.user));

// The public projection carries the uuid, not the primary key
const publicUser = henri.user.publicUser(req.user);

if (publicUser) {
  expectType<string | undefined>(publicUser.externalId);
  expectType<string>(publicUser.email);
}
expectType<Promise<string>>(henri.user.encrypt('a-password', 12));
// A hash bound to the record it belongs to
expectType<Promise<string>>(
  henri.user.encrypt('a-password', { identity: req.user })
);
expectType<Promise<string>>(
  henri.user.encrypt('a-password', { identity: 'a-uuid', rounds: 12 })
);
expectType<string | null>(henri.user.identityOf(req.user));
expectType<boolean>(henri.user.bindsPasswords());

// @ts-expect-error the second argument is the options, not the identity itself
henri.user.encrypt('a-password', 'a-uuid');

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
expectType<string[]>(henri.modules.fromDirectory());
expectType<string[]>(henri.modules.fromPackages());
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

// The module arrives from @usehenri/jobs, so an application that does not
// depend on the package has none: reading it is a check, not a given
expectType<boolean | undefined>(henri.jobs?.enabled);

const jobs = henri.jobs!;

expectType<Promise<Job>>(jobs.perform('welcome', { userId: 1 }));
expectType<Promise<Job>>(
  jobs.perform('report', null, { priority: -10, queue: 'reports' })
);
expectType<Promise<Job>>(jobs.performIn('5m', 'welcome', { userId: 1 }));
expectType<Promise<Job>>(jobs.performAt(new Date(), 'welcome', null));
expectType<Promise<Job[]>>(jobs.list({ state: 'pending' }));
expectType<Promise<JobStats>>(jobs.stats());
expectType<Promise<Job | null>>(jobs.dead.retry('an-id'));
expectType<Promise<number>>(jobs.dead.discardAll({ queue: 'mailers' }));

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
jobs.list({ state: 'sleeping' });

// @ts-expect-error `henri.jobs` may be undefined: check it first
henri.jobs.perform('welcome');

// @ts-expect-error a job file has to export a perform()
const broken: JobDefinition = { queue: 'default' };

// --- webhooks ---------------------------------------------------------------

// The module arrives from @usehenri/webhooks, like the queue it delivers
// through: reading it is a check, not a given
expectType<boolean | undefined>(henri.webhooks?.enabled);

const webhooks = henri.webhooks!;

expectType<Promise<WebhookEndpoint>>(
  webhooks.register({ events: ['invoice.*'], url: 'https://acme.example/h' })
);
expectType<Promise<WebhookEndpoint>>(
  webhooks.register({
    description: 'Acme production',
    events: '*',
    headers: { 'x-acme-env': 'production' },
    owner: 'tenant-42',
    url: 'https://acme.example/h',
  })
);
expectType<Promise<WebhookDelivery[]>>(
  webhooks.emit('invoice.paid', { total: 4200 }, { owner: 'tenant-42' })
);
expectType<Promise<WebhookDelivery>>(
  webhooks.deliverTo('an-id', 'invoice.paid')
);
expectType<Promise<WebhookEndpoint | null>>(webhooks.endpoint('an-id'));
expectType<Promise<WebhookEndpoint[]>>(webhooks.endpoints({ disabled: true }));
expectType<Promise<string[]>>(webhooks.secrets('an-id'));
expectType<Promise<WebhookEndpoint>>(
  webhooks.rotate('an-id', { grace: 86400000 })
);
expectType<Promise<boolean>>(webhooks.remove('an-id'));

// @ts-expect-error an endpoint needs a url and what it subscribes to
webhooks.register({ url: 'https://acme.example/h' });

// @ts-expect-error `henri.webhooks` may be undefined: check it first
henri.webhooks.emit('invoice.paid');

// --- graphql ----------------------------------------------------------------

// The module arrives from @usehenri/graphql, so an application that does not
// depend on the package has none: reading it is a check, not a given
expectType<boolean | undefined>(henri.graphql?.active);
expectType<string | undefined>(henri.graphql?.endpoint);

if (henri.graphql) {
  expectType<boolean>(henri.graphql.active);
  expectType<string>(henri.graphql.endpoint);
}

// @ts-expect-error `henri.graphql` may be undefined: check it first
henri.graphql.run('{ tasks }');

// --- uploads ----------------------------------------------------------------

// The module arrives from @usehenri/uploads, so an application that does not
// depend on it has neither `henri.uploads` nor `req.files`
expectType<boolean | undefined>(henri.uploads?.enabled);

const uploads = henri.uploads!;
const scan = req.files!.scan[0];

expectType<UploadedFile>(scan);
expectType<string>(scan.type);
expectType<string | null>(scan.declaredType);
expectType<boolean>(scan.mistyped);
expectType<Promise<StoredFile>>(scan.store());
expectType<Promise<StoredFile>>(scan.store({ prefix: 'artworks' }));
expectType<Promise<boolean>>(scan.discard());
expectType<UploadedFile | null>(req.file!('scan'));
expectType<Record<string, UploadedFile[]>>(req.permitFiles!('scan', 'cv'));
expectType<Promise<boolean>>(uploads.delete(await scan.store()));

uploads.send(res, await scan.store(), { disposition: 'inline' });

// @ts-expect-error `henri.uploads` may be undefined: check it first
henri.uploads.send(res, 'a-key');

// @ts-expect-error a disposition is `attachment` or `inline`, nothing else
uploads.send(res, 'a-key', { disposition: 'embed' });

// @ts-expect-error `uploads` is not a configuration key of the file store
const badUploads: Configuration = { uploads: { maxFileSize: true } };

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
// A bound hash needs the record it belongs to, so the user is what it wants
expectType<Promise<true>>(henri.user.compare('a-password', { id: 1 }));

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

const declared: Controller = {
  params: {
    all: { format: { type: 'string', enum: ['html', 'json'] } },
    create: {
      tags: { type: 'array', of: 'uuid', maxLength: 5 },
      title: { type: 'string', required: true, maxLength: 120 },
      // the short form is the type itself
      year: 'integer',
    },
    'index,search': { page: { type: 'integer', min: 1, default: 1 } },
  },
  create: async (req, res) => {
    // with a declaration, `permit()` with no field is what it accepted
    expectType<Record<string, unknown>>(req.permit());

    return res.boom.notFound();
  },
};

expectType<Controller>(declared);

const badParams: Controller = {
  params: {
    // @ts-expect-error a rule names a type henri has
    create: { title: { type: 'strng' } },
  },
};

const badRule: Controller = {
  params: {
    // @ts-expect-error `pattern` is a regular expression
    create: { title: { type: 'string', pattern: '^a' } },
  },
};

const badKey: Controller = {
  params: {
    // @ts-expect-error a rule takes no key of its own
    create: { title: { type: 'string', requird: true } },
  },
};

expectType<Controller>(badParams);
expectType<Controller>(badRule);
expectType<Controller>(badKey);

// `henri.controllers` answers what an action declared
expectType<Record<string, ParamRule> | null>(
  henri.controllers.accepts('tasks#create')
);

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
  options: {
    paranoid: true,
    timestamps: true,
    personal: { onErase: 'anonymize', subject: 'ownerId' },
  },
  schema: {
    title: { type: 'string', required: true, unique: true },
    body: 'text',
    status: { type: 'string', enum: ['todo', 'done'], default: 'todo' },
    meta: { type: 'json' },
    author: { type: 'string', personal: true },
    phone: { type: 'string', personal: { expose: false, erase: 'retain' } },
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

const badMark: ModelFile = {
  schema: {
    // @ts-expect-error a personal field is erased, anonymized or retained
    title: { type: 'string', personal: { erase: 'shred' } },
  },
};

const badStrategy: ModelFile = {
  // @ts-expect-error the records of an erased person go one of four ways
  options: { personal: { onErase: 'burn' } },
  schema: { title: 'string' },
};

// --- personal data ----------------------------------------------------------

expectType<Set<string>>(henri.privacy.keys);
expectType<Set<string>>(henri.privacy.private);
expectType<string | null>(henri.privacy.subjectModel);
expectType<{ name: string; phone: string }>(
  henri.privacy.strip({ name: 'Ada', phone: '555' })
);
expectType<{ name: string }>(henri.privacy.strip({ name: 'Ada' }, ['phone']));

declare const receipt: ErasureReceipt;
expectType<string>(receipt.subject.digest);
expectType<'anonymize' | 'delete' | 'orphan' | 'retain'>(
  receipt.records[0].action
);

async function erasing(): Promise<void> {
  const document: PersonalExport = await henri.privacy.export('ada@x.test');

  expectType<Record<string, number>>(document.counts);
  expectType<ErasureReceipt>(await henri.privacy.erase('ada@x.test'));
  expectType<ErasureReceipt>(
    await henri.privacy.erase('ada@x.test', { dryRun: true })
  );

  // @ts-expect-error `henri.privacy.erase()` needs somebody to erase
  await henri.privacy.erase();
}

expectType<Promise<void>>(erasing());

// --- encrypted attributes ---------------------------------------------------

// A field says it next to its type, and both schemes are accepted
const encryptedModel: ModelFile = {
  schema: {
    badge: { encrypted: { deterministic: true }, type: 'string', unique: true },
    ssn: { encrypted: true, personal: true, type: 'string' },
  },
};

void encryptedModel;

const wrongMark: ModelFile = {
  // @ts-expect-error `encrypted` is true or { deterministic }, nothing else
  schema: { ssn: { encrypted: 'yes', type: 'string' } },
};

void wrongMark;

expectType<boolean>(henri.encryption.enabled);
expectType<string[]>(henri.encryption.keys);
expectType<string | null>(henri.encryption.primary);
expectType<boolean>(henri.encryption.readPlaintext);
expectType<string | null>(henri.encryption.keyIdIn('henri:v1:r:00000000:x'));
expectType<string[]>(
  henri.encryption.candidates('B-1', { context: 'Person.badge' })
);

async function rotating(): Promise<void> {
  const status = await henri.encryption.status();

  expectType<boolean>(status.ok);
  expectType<EncryptionFieldStatus[]>(status.fields);

  const report = await henri.encryption.rotate({ dryRun: true });

  expectType<number>(report.rotated);
  expectType<string>(report.failures[0].record);

  // The one way past a value that will not open, and it says what it cost
  const read = await henri.encryption.tolerate(async () => 'a plaintext');

  expectType<string>(read.value);
  expectType<UnreadableValue[]>(read.failures);

  // @ts-expect-error a rotation takes options, not a model name
  await henri.encryption.rotate('Person');
}

expectType<Promise<void>>(rotating());

// The export and the receipt say which encrypted fields would not open
declare const exported: PersonalExport;
expectType<UnreadableValue[]>(exported.unreadable);
expectType<UnreadableValue[]>(receipt.unreadable);

// The private fields of a payload are dropped unless the answer asks
res.render('/account', { data: { user: {} }, include: ['phone'] });
res.resource({ id: '1' }, { include: ['phone'] });
// @ts-expect-error `include` names fields, not a boolean
res.resource({ id: '1' }, { include: true });

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
  shutdown: { delay: 0, drain: 10000, signals: true },
};

expectType<Configuration>(config);

const badShutdown: Configuration = {
  // @ts-expect-error the drain deadline is a number of milliseconds
  shutdown: { drain: '10s' },
};

expectType<boolean>(henri.server.draining);
expectType<Promise<void>>(henri.server.shutdown('SIGTERM'));

// The account flows: the configuration, and the service behind the endpoints
const accounts: Configuration = {
  url: 'https://example.com',
  user: {
    model: 'user',
    signup: { after: '/', fields: ['name'] },
    passwordReset: { expiresIn: '1h' },
    confirmation: { required: true },
  },
};

expectType<Configuration>(accounts);
expectType<AccountSettings>(henri.accounts.settings);
expectType<number>(henri.accounts.settings.passwordReset.expiresIn);
expectType<Promise<AccountResult>>(
  henri.accounts.register({ email: 'ada@example.com', password: 'a-password' })
);
expectType<Promise<AccountResult>>(
  henri.accounts.resetPassword('h1.a.b', 'another-password')
);
expectType<Promise<void>>(henri.accounts.requestPasswordReset('ada@x.co'));
expectType<Promise<AccountResult>>(henri.accounts.confirm('h1.a.b'));
expectType<boolean>(henri.accounts.allowed(req.user));
expectType<Promise<boolean>>(henri.accounts.drain());

// Policies: one question, and the file that answers it
expectType<PoliciesModule>(henri.policies);
expectType<Promise<boolean>>(henri.can(req.user, 'update', { id: 1 }));
expectType<Promise<boolean>>(henri.can(req.user, 'index', null, 'proposal'));
expectType<Promise<boolean>>(req.can('update', { id: 1 }));
expectType<Promise<{ id: number }>>(req.authorize('update', { id: 1 }));
expectType<Promise<any>>(req.scope('proposal'));
expectType<Promise<any>>(henri.policies.scope(req.user, 'proposal'));
expectType<403 | 404>(henri.policies.settings.status);
expectType<string[]>(henri.policies.names());

const proposalPolicy: Policy = {
  index: (user) => Boolean(user),
  show: (user, proposal: any) => proposal.speakerId === user.id,
  scope: (user) => ({ speakerId: user && user.id }),
};

const policyRoutes: RoutesFile = {
  'resources proposals': { policy: true, roles: ['speaker'] },
  // eslint-disable-next-line sort-keys
  'get /proposals/mine': { controller: 'proposals#mine', policy: 'proposal' },
};

const badPolicyRoute: RoutesFile = {
  // @ts-expect-error a policy is named, or true; never a list
  'resources proposals': { policy: ['proposal'] },
};

const policiesConfig: Configuration = {
  policies: { status: 403, verify: false },
};

const badPolicies: Configuration = {
  // @ts-expect-error a refusal answers 403 or 404, nothing else
  policies: { status: 401 },
};

const badFlow: Configuration = {
  // @ts-expect-error a flow is a boolean or its settings, never a string
  user: { model: 'user', signup: 'yes' },
};

const badConfig: Configuration = {
  // @ts-expect-error `vue2` is not a renderer
  renderer: 'vue2',
};

const badStore: Configuration = {
  // @ts-expect-error `sqlite` is not an adapter package (use drizzle)
  stores: { default: { adapter: 'sqlite' } },
};

// The shared store: one backend for the rate limit, the lockout and the keys
const sharedConfig: Configuration = {
  shared: {
    adapter: 'redis',
    url: 'redis://127.0.0.1:6379',
    prefix: 'lineup:',
    onError: 'open',
    // Anything else reaches the driver
    database: 3,
  },
};

expectType<Configuration>(sharedConfig);
expectType<SharedStore | null>(henri.shared);
expectType<SharedStore | null>(henri.api.shared);

const badShared: Configuration = {
  // @ts-expect-error a failure policy is `closed` or `open`, nothing else
  shared: { adapter: 'redis', onError: 'maybe' },
};

const namelessShared: Configuration = {
  // @ts-expect-error a shared store must name its adapter
  shared: { url: 'redis://127.0.0.1:6379' },
};

// --- the cache --------------------------------------------------------------

const cacheConfig: Configuration = {
  cache: { maxEntries: 500, maxEntrySize: '128kb', ttl: '30s' },
};

expectType<Configuration>(cacheConfig);
expectType<Configuration>({ cache: false });

expectType<Promise<unknown>>(henri.cache.get('top'));
expectType<Promise<number | undefined>>(henri.cache.get<number>('visits'));
expectType<Promise<boolean>>(henri.cache.set(['user', 1], { name: 'ada' }));
expectType<Promise<boolean>>(henri.cache.set('top', [1, 2], { ttl: '2h' }));
expectType<Promise<boolean>>(henri.cache.delete(['user', 1]));
expectType<Promise<number>>(henri.cache.clear());
expectType<CacheStats>(henri.cache.stats());
expectType<number>(henri.cache.settings.ttl);

// `fetch` answers what the function answers, with or without options
expectType<Promise<number>>(henri.cache.fetch('visits', () => 12));
expectType<Promise<string[]>>(
  henri.cache.fetch('tags', { ttl: '5m' }, async () => ['a'])
);
expectType<Promise<number>>(
  henri.cache.scope('reports').fetch('daily', { force: true }, () => 1)
);
expectType<Cache>(henri.cache.scope('reports'));

const badCache: Configuration = {
  // @ts-expect-error `maxEntries` is a number of entries
  cache: { maxEntries: 'many' },
};

// --- logs and error reporting -----------------------------------------------

expectType<Configuration>({ logs: { format: 'json' } });
expectType<Configuration>({ logs: { format: 'auto' } });

const badLogs: Configuration = {
  // @ts-expect-error the formats are auto, json and pretty
  logs: { format: 'logfmt' },
};

// --- the content security policy nonce --------------------------------------

expectType<Configuration>({ csp: { nonce: true } });

const badCsp: Configuration = {
  // @ts-expect-error `nonce` is on or off, not a value you pick
  csp: { nonce: 'a-nonce-of-my-own' },
};

// @ts-expect-error `fetch` needs a function to run on a miss
henri.cache.fetch('visits');

// @ts-expect-error a cache key is not built out of nothing
henri.cache.get(null);

export {
  badCache,
  badCsp,
  badLogs,
  cacheConfig,
  badConfig,
  badFlow,
  badPolicies,
  badPolicyRoute,
  badShared,
  namelessShared,
  policiesConfig,
  policyRoutes,
  proposalPolicy,
  sharedConfig,
  badShutdown,
  badModule,
  noInit,
  badHook,
  badModel,
  badNamespace,
  badResource,
  badRoutes,
  badStore,
};
