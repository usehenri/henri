// Type definitions for @usehenri/core
//
// Hand-written, and deliberately so: henri is CommonJS JavaScript and stays
// that way. These declarations describe the API an application touches -- the
// `henri` global, the request and response helpers, the controller, model and
// routes files, and the configuration. They are checked by `pnpm test:types`
// (see `types/` at the root of the repository).
//
// Nothing here changes what the framework does at runtime; a JavaScript
// application picks them up through `jsconfig.json` (`"types":
// ["@usehenri/core"]`, which `henri new` writes) and annotates a file with
// JSDoc where a plain object needs a shape:
//
//     /** @type {import('@usehenri/core').Controller} */
//     module.exports = { index: async (req, res) => ({ tasks: await Task.find() }) };

import type {
  NextFunction,
  Request as ExpressRequest,
  Response as ExpressResponse,
  Router as ExpressRouter,
  Express,
} from 'express';
import type { Server as HttpServer } from 'node:http';

/**
 * Boots the application in the current working directory and resolves with
 * the running instance. This is what `henri server` and `@usehenri/testing`
 * call; an application rarely calls it itself.
 */
declare function start(): Promise<start.Henri>;

declare namespace start {
  // ---------------------------------------------------------------------------
  // Configuration (config/default.json, config/<NODE_ENV>.json)
  // ---------------------------------------------------------------------------

  /** The adapters `stores.<name>.adapter` accepts. */
  type AdapterName =
    | 'disk'
    | 'drizzle'
    | 'mariadb'
    | 'mongoose'
    | 'mssql'
    | 'mysql'
    | 'postgresql';

  /**
   * One entry of `config.stores`. The keys an adapter does not know are
   * forwarded to the driver (Sequelize takes `logging`, `pool`,
   * `dialectOptions`, ...), which is what the index signature stands for.
   */
  interface StoreConfig {
    adapter: AdapterName;
    /** Connection string (mongoose and SQL); required unless `host` is given. */
    url?: string;
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    /** mongoose: options passed to `mongoose.connect()`. */
    opts?: Record<string, unknown>;
    /** mongoose and SQL: options of the session store. */
    session?: Record<string, unknown>;
    /** disk: data directory, relative to the application (`.henri/data`). */
    path?: string;
    /** disk: database name (`henri`). */
    dbName?: string;
    /** drizzle: the dialect, whose driver the application installs. */
    dialect?: 'mysql' | 'postgres' | 'sqlite';
    /** drizzle: `false` stops the development boot from pushing the schema. */
    sync?: boolean;
    /** drizzle: apply `db/migrations` on a production boot. */
    migrate?: boolean;
    [key: string]: unknown;
  }

  /** `config.user` when it is an object rather than the model name. */
  interface UserConfig {
    /** Name of the user model (`user`). */
    model?: string;
    /** Fields, besides `id`, `email` and `roles`, that may leave the server. */
    public?: string[];
    /** Where browsers are sent when a route denies them (`/login`). */
    loginPath?: string;
    /** Where they land after a form login (`/`). */
    afterLogin?: string;
    /** Session lifetime in milliseconds (30 days). */
    sessionMaxAge?: number;
  }

  /** The normalized `config.user`, as `henri.user.settings`. */
  interface UserSettings extends Required<UserConfig> {}

  /** `config.api`: the JSON API. */
  interface ApiConfig {
    /** Default page size of `req.pagination()` (`25`). */
    perPage?: number;
    /** Largest page size a client may ask for (`100`). */
    maxPerPage?: number;
    /** Refuse (500) a JSON answer without `_links` on a resource route. */
    strict?: boolean;
    /** `Idempotency-Key` replays; `false` disables the feature. */
    idempotency?:
      | false
      | {
          /** How long answers are kept (`86400000`). */
          ttl?: number;
          /** Module exporting a shared `{ get, set, delete }` store. */
          store?: string | null;
        };
  }

  /** `config.rateLimit`: `false` disables every limit. */
  interface RateLimitConfig {
    /** The window of the global limit (`60000`). */
    windowMs?: number;
    /** Requests per window and per user or ip (`600`). */
    max?: number;
    /** Alias of `max`, the name express-rate-limit 8 uses. */
    limit?: number;
    /** The limit on `POST` to the login and register-style paths. */
    auth?:
      | false
      | {
          windowMs?: number;
          max?: number;
          /** Overrides the list of guarded paths. */
          paths?: string[];
        };
    /** Module exporting an express-rate-limit store, or a factory. */
    store?: string | null;
  }

  /** `config.inertia`: the options of the Inertia renderer. */
  interface InertiaConfig {
    /** Server render the pages (`true`). */
    ssr?: boolean;
    /** Id of the root element (`app`). */
    id?: string;
    /** Client entry, relative to `app/views` (`main.jsx`). */
    entry?: string;
    /** Server entry, relative to `app/views` (`ssr.jsx`). */
    ssrEntry?: string;
    /** Html shell, relative to `app/views` (`index.html`). */
    template?: string;
  }

  /**
   * The shape of `config/default.json` and of every `config/<NODE_ENV>.json`.
   * Annotate a configuration file read from JavaScript, or use it to keep a
   * hand-written config object honest.
   */
  interface Configuration {
    /** Port to listen on (`3000`). */
    port?: number;
    /** Interface to bind; `HENRI_HOST` wins over the file. */
    host?: string;
    /** `true` for the cors defaults, an object for its options. */
    cors?: boolean | Record<string, unknown>;
    /** View engine (`template`). */
    renderer?: 'inertia' | 'react' | 'template' | 'vue';
    inertia?: InertiaConfig;
    /** Opt-in to the unmaintained renderers. */
    experimental?: { vue?: boolean };
    stores?: Record<string, StoreConfig>;
    /** Session and token secret; usually provided by `HENRI_SECRET`. */
    secret?: string;
    /** Name of the user model, or its settings. */
    user?: string | UserConfig;
    /** Role, or roles, given to every new user. */
    baseRole?: string | string[];
    /** Express `trust proxy` (`true`). */
    trustProxy?: boolean | number | string;
    /** `false` disables the CSRF protection. */
    csrf?: boolean;
    /** Path of the GraphQL endpoint (`/_henri/gql`). */
    graphql?: string;
    /** Nodemailer transport options, or `"test"` for an Ethereal account. */
    mail?: 'test' | Record<string, unknown>;
    api?: ApiConfig;
    rateLimit?: boolean | RateLimitConfig;
    /** Options merged over henri's helmet defaults; `false` disables it. */
    helmet?: false | Record<string, unknown>;
    /** Parameter names masked in the logs. */
    filterParameters?: string[];
    /** Maximum size of a JSON or form body (`"1mb"`). */
    bodyLimit?: string | number;
    /** Milliseconds before a running request is answered 503. */
    requestTimeout?: number | false;
    [key: string]: unknown;
  }

  /** `henri.api.settings`: the configuration above, normalized. */
  interface ApiSettings {
    bodyLimit: string | number;
    filterParameters: string[];
    idempotency: false | { store: string | null; ttl: number };
    pagination: { maxPerPage: number; perPage: number };
    rateLimit:
      | false
      | {
          auth:
            | false
            | {
                loginPath: string;
                max: number;
                paths?: string[];
                windowMs: number;
              };
          max: number;
          store: string | null;
          windowMs: number;
        };
    requestTimeout: number | false;
    strict: boolean;
  }

  // ---------------------------------------------------------------------------
  // config/routes.js
  // ---------------------------------------------------------------------------

  /** The http verbs a route key may use. */
  type Verb =
    | 'checkout'
    | 'copy'
    | 'delete'
    | 'get'
    | 'head'
    | 'lock'
    | 'm-search'
    | 'merge'
    | 'mkactivity'
    | 'mkcol'
    | 'move'
    | 'notify'
    | 'options'
    | 'patch'
    | 'post'
    | 'purge'
    | 'put'
    | 'report'
    | 'search'
    | 'subscribe'
    | 'trace'
    | 'unlock'
    | 'unsubscribe';

  /** The seven actions `resources` expands to. */
  type ResourceAction =
    'create' | 'destroy' | 'edit' | 'index' | 'new' | 'show' | 'update';

  /** Options every route accepts; they end up on the route object. */
  interface RouteOptions {
    /** `controller#action`. */
    controller?: string;
    /** Roles allowed to reach the route; anything else gets a 401 or a 403. */
    roles?: string | string[];
    /** Answer 406 to clients asking for another api version. */
    version?: string;
    /** A rate limit of its own for this route. */
    rateLimit?: { windowMs?: number; max?: number };
    /** `false` opts a mutating route out of `Idempotency-Key`. */
    idempotent?: boolean;
    [key: string]: unknown;
  }

  /**
   * The `member` and `collection` routes of a resource: an array of segments
   * (`['archive']`, a GET), or `'<verb> <segment>': '<action>'`.
   */
  type ResourceExtras =
    | string[]
    | Record<string, string | null | (RouteOptions & { action?: string })>;

  /** Options of a `resources` or `crud` entry. */
  interface ResourceOptions extends RouteOptions {
    /** Only these actions. */
    only?: ResourceAction | ResourceAction[];
    /** Every action but these (`omit` is an alias). */
    except?: ResourceAction | ResourceAction[];
    omit?: ResourceAction | ResourceAction[];
    /** Routes on one record: `/tasks/:id/<segment>`. */
    member?: ResourceExtras;
    /** Routes on the collection: `/tasks/<segment>`. */
    collection?: ResourceExtras;
    /** Resources nested under this one, below `/tasks/:task_id`. */
    nested?: RoutesFile;
    /** The parameter nested resources use (`task_id`). */
    param?: string;
    /** A prefix inserted before the resource name. */
    scope?: string;
  }

  /**
   * `config/routes.js`.
   *
   * The keys are checked as far as a type can check them: `root`, a path
   * (`/about`), `<verb> <path>`, `resources <name>`, `crud <name>` and
   * `namespace <name>`. Their order is load-bearing -- henri registers the
   * routes in file order -- so keep `get /tasks/mine` above `get /tasks/:id`.
   */
  type RoutesFile = {
    [key in `namespace ${string}`]?: RoutesFile;
  } & {
    [key in `crud ${string}` | `resources ${string}`]?:
      string | ResourceOptions;
  } & {
    [key in 'root' | `${Verb} ${string}` | `/${string}`]?:
      string | RouteOptions;
  };

  /** One expanded route, as `henri.router.routes` holds them. */
  interface Route extends RouteOptions {
    verb: Verb;
    route: string;
    controller: string;
    /** Name of the path helper, always `<action>_<controller>_path`. */
    path: string;
    /** True for the routes `resources` and `crud` expanded. */
    resource?: boolean;
  }

  /** One entry of the `paths` a view receives. */
  interface PathHelper {
    route: string;
    method: string;
    roles?: string | string[] | null;
  }

  /** The path helpers a user may follow, keyed `<action>_<controller>_path`. */
  type Paths = Record<string, PathHelper>;

  // ---------------------------------------------------------------------------
  // Request and response
  // ---------------------------------------------------------------------------

  /** The page `req.pagination()` describes. */
  interface Pagination {
    page: number;
    perPage: number;
    /** `(page - 1) * perPage`, for Mongoose. */
    skip: number;
    /** The same number, for Sequelize. */
    offset: number;
    /** `perPage`, for both. */
    limit: number;
  }

  /** Flash messages by type, as the views receive them. */
  type FlashBag = Record<string, unknown[]>;

  /**
   * `req.flash()`: queue a message, or read and clear what is queued.
   * Messages live in the session, so this is a no-op without a user model.
   */
  interface Flash {
    /** Reads and clears everything. */
    (): FlashBag;
    /** Reads and clears one type. */
    (type: string): unknown[];
    /** Queues a message (arrays are flattened). */
    (type: string, message: unknown): unknown[];
  }

  /** The current user as it may leave the server. */
  interface PublicUser {
    id: string;
    email: string;
    roles: string[];
    /** Plus the fields listed in `config.user.public`. */
    [field: string]: unknown;
  }

  /**
   * What `req._henri` carries and what a view engine receives: set on every
   * request, then completed by `res.render()` with `data`, `errors` and
   * `graphql`.
   */
  interface ViewOptions {
    csrf: string | null;
    flash: FlashBag;
    localUrl: string;
    paths: Paths;
    query: Record<string, unknown>;
    user: PublicUser | null;
    /** What the action passed to `res.render({ data })`. */
    data?: Record<string, unknown>;
    /** The GraphQL errors, when the page was rendered from a query. */
    errors?: readonly unknown[] | null;
    graphql?: { endpoint: string | false; query: string | false };
  }

  /** The second argument of `res.render()` and `res.hbs()`. */
  interface RenderOptions {
    /** What the page receives as `data`. */
    data?: Record<string, unknown>;
    /** A GraphQL query run for the page; its result becomes `data`. */
    graphql?: string;
  }

  /** Options of `res.resource()`. */
  interface ResourceOptions {
    /** Controller name; defaults to the one of the current route. */
    type?: string;
    /** Extra links, as `{ rel: href }` or as HAL links. */
    links?: Record<string, string | { href: string; method?: string }>;
    /** `201` also sets `Location`. */
    status?: number;
  }

  /** Options of `res.collection()`. */
  interface CollectionOptions extends ResourceOptions {
    page?: number;
    perPage?: number;
    /** Total number of records; without it there is no `last` link. */
    total?: number;
  }

  /**
   * `res.boom.<name>(message, data)`: a JSON error
   * `{ statusCode, error, message, data }`.
   */
  interface Boom {
    /** 400 */
    badRequest(message?: string, data?: unknown): ExpressResponse;
    /** 401 */
    unauthorized(message?: string, data?: unknown): ExpressResponse;
    /** 403 */
    forbidden(message?: string, data?: unknown): ExpressResponse;
    /** 404 */
    notFound(message?: string, data?: unknown): ExpressResponse;
    /** 405 */
    methodNotAllowed(message?: string, data?: unknown): ExpressResponse;
    /** 409 */
    conflict(message?: string, data?: unknown): ExpressResponse;
    /** 422 */
    badData(message?: string, data?: unknown): ExpressResponse;
    /** 429 */
    tooManyRequests(message?: string, data?: unknown): ExpressResponse;
    /** 500 */
    internal(message?: string, data?: unknown): ExpressResponse;
    /** 501 */
    notImplemented(message?: string, data?: unknown): ExpressResponse;
    /** 502 */
    badGateway(message?: string, data?: unknown): ExpressResponse;
    /** 503 */
    serverUnavailable(message?: string, data?: unknown): ExpressResponse;
  }

  /**
   * The request henri hands a controller: an Express request plus what the
   * framework adds.
   *
   * `user`, `session`, `isAuthenticated()`, `logIn()` and `logout()` come from
   * passport and express-session, which core owns; they are declared here so
   * that an application needs no `@types/passport` of its own. A project that
   * installs those typings should annotate with Express's own `Request`
   * instead of this one.
   */
  interface Request extends ExpressRequest {
    /** `X-Request-Id`, accepted from the client or generated. */
    id: string;
    /** `'v1'` when the client asked for `application/vnd.henri.v1+json`. */
    apiVersion: string | null;
    /** The CSRF token of the request, with a user model. */
    csrfToken?: string;
    /** What the view engine reads. */
    _henri: ViewOptions;
    /**
     * The listed fields from the query string, body and path parameters
     * (later sources win); missing fields are omitted.
     */
    permit(...fields: Array<string | string[]>): Record<string, unknown>;
    /** `{ page, perPage, skip, limit, offset }`, bounded by `config.api`. */
    pagination(overrides?: {
      perPage?: number;
      maxPerPage?: number;
    }): Pagination;
    flash: Flash;
    /**
     * The logged-in user: a model instance, whose shape only the application
     * knows. Cast it, or declare your own model type.
     */
    user?: any;
    session?: any;
    isAuthenticated?(): boolean;
    isUnauthenticated?(): boolean;
    logIn?(user: any, done: (error: unknown) => void): void;
    logOut?(done: (error: unknown) => void): void;
    logout?(done: (error: unknown) => void): void;
    /** With the Inertia renderer. */
    inertia?: { request: boolean; errors: Record<string, string> | null };
  }

  /**
   * The response henri hands a controller. `render` is henri's, not Express's:
   * it takes a route and `{ data }` or `{ graphql }`, and answers JSON when the
   * client asks for it.
   */
  interface Response extends Omit<ExpressResponse, 'render'> {
    /**
     * Renders a page with `{ data }` or `{ graphql }`, or answers the view
     * options as JSON when the client asks for it.
     *
     * It resolves once the engine has been handed the request, not once the
     * page is written, and the value it resolves with is the response itself
     * (Express's content negotiation returns it) -- there is nothing useful
     * to read from it.
     */
    render(route: string, options?: RenderOptions): Promise<ExpressResponse>;
    /** The same, through Handlebars whatever the renderer. */
    hbs(route: string, options?: RenderOptions): Promise<ExpressResponse>;
    boom: Boom;
    /** One HAL resource: the record plus `_links`. A list is refused. */
    resource<T extends object>(
      record: T extends readonly unknown[] ? never : T,
      options?: ResourceOptions
    ): ExpressResponse;
    /** A HAL collection: `_embedded`, `_links` and the paging headers. */
    collection(
      records: readonly object[],
      options?: CollectionOptions
    ): ExpressResponse;
    /**
     * Runs `html` for browsers and `json` for API clients. The handler is not
     * awaited: what comes back is the response, not what the handler returned.
     */
    negotiate(handlers: {
      html?: () => unknown;
      json?: () => unknown;
    }): ExpressResponse;
    /** With the Inertia renderer. */
    inertia?: {
      errors(errors: Record<string, string>): ExpressResponse;
      location(url: string): ExpressResponse | void;
    };
  }

  // ---------------------------------------------------------------------------
  // app/controllers/*.js
  // ---------------------------------------------------------------------------

  /**
   * A controller action. Returning without answering renders
   * `/<controller>/<action>` with what was returned as `data`.
   */
  type Action = (req: Request, res: Response) => unknown;

  /**
   * A `before` hook. Take `next` and call it, or leave it out and return a
   * promise; a hook that answers ends the request.
   */
  type Hook = (req: Request, res: Response, next: NextFunction) => unknown;

  /** A hook with the rails selectors. */
  interface HookSelector {
    run: Hook | Hook[];
    only?: string | string[];
    except?: string | string[];
  }

  /**
   * The `before` block: keyed by action (`all`, `'show,edit'`), or a list of
   * hooks and selectors.
   */
  type BeforeBlock = Record<string, Hook | Hook[]> | Array<Hook | HookSelector>;

  /**
   * A controller file. Every exported function is an action (`tasks#index`);
   * `before` is the only reserved key.
   *
   *     /** @type {import('@usehenri/core').Controller} *\/
   *     module.exports = {
   *       before: { 'show,edit': loadTask },
   *       index: async (req, res) => ({ tasks: await Task.find() }),
   *     };
   */
  interface Controller {
    before?: BeforeBlock;
    [action: string]: Action | BeforeBlock | undefined;
  }

  // ---------------------------------------------------------------------------
  // app/models/*.js
  // ---------------------------------------------------------------------------

  /** The field types every adapter understands. */
  type FieldType =
    | 'boolean'
    | 'date'
    | 'float'
    | 'integer'
    | 'json'
    | 'number'
    | 'string'
    | 'text'
    | 'uuid';

  /**
   * One field of a model schema.
   *
   * The keys below are the ones every adapter honours. Each also accepts its
   * own: Mongoose passes anything it does not know straight to the path
   * (`ref`, `select`, `lowercase`, `validate`, ...), while Sequelize and
   * Drizzle throw at boot on a key they do not know -- which is why this is an
   * open interface rather than an exact one.
   */
  interface FieldDefinition {
    type: FieldTypeValue;
    /** `NOT NULL`, or `required` on Mongoose. */
    required?: boolean;
    /** A value, or a function returning one. */
    default?: unknown;
    /** Allowed values (an ENUM on mysql and postgres, a validation elsewhere). */
    enum?: unknown[];
    unique?: boolean;
    index?: boolean;
    [key: string]: unknown;
  }

  /**
   * Anything the `type` of a field accepts.
   *
   * Only the names henri normalizes are listed. An adapter's own types are
   * passed as values rather than as names -- a Sequelize `DataTypes.DECIMAL`,
   * a Mongoose sub-schema, `[String]` -- which is what the last three members
   * stand for. Sequelize also resolves an uppercase `DataTypes` name
   * (`'DECIMAL'`); that spelling is deliberately not typed, because Mongoose
   * would take the same string for something else.
   */
  type FieldTypeValue =
    | FieldType
    /** Mongoose: `{ type: 'ObjectId', ref: 'User' }`. */
    | 'ObjectId'
    /** A constructor (`String`, `Number`, `Date`) or a Sequelize DataType. */
    | Function
    /** A list (`[String]`, `['string']`) or a nested schema. */
    | readonly unknown[]
    | object;

  /**
   * One entry of a schema: a type name, a definition, or -- on Mongoose -- a
   * nested schema.
   */
  type SchemaValue =
    | FieldType
    | 'ObjectId'
    | Function
    | readonly unknown[]
    | FieldDefinition
    | Schema;

  /** A schema: field name to type name or definition. */
  type Schema = { [field: string]: SchemaValue };

  /**
   * `model.options`. `timestamps` and `paranoid` are henri's; every other key
   * goes to the ORM (`tableName`, `indexes`, `defaultScope`, ... on Sequelize,
   * anything `new mongoose.Schema()` takes on Mongoose).
   */
  interface ModelOptions {
    /** `createdAt` and `updatedAt` (`true`). */
    timestamps?: boolean;
    /** Soft deletes: `deletedAt` instead of a real delete. */
    paranoid?: boolean;
    [key: string]: unknown;
  }

  /**
   * A model file. Core adds `identity` (the lowercased file name) and
   * `globalId` (the file name) before handing it to the adapter, and exposes
   * the ORM model as `global[globalId]`.
   */
  interface ModelFile {
    schema: Schema;
    /** The store of `config.stores` this model lives in (`default`). */
    store?: string;
    /** Collection or table name; defaults to the file name, pluralized. */
    name?: string;
    options?: ModelOptions;
    graphql?: { types?: string; resolvers?: Record<string, unknown> };
    /** Called once every model exists, with the models by global id. */
    associate?(models: Record<string, unknown>): void;
  }

  /** What `Model.paginate({ page, perPage })` answers, on every adapter. */
  interface Page<T = any> {
    records: T[];
    page: number;
    perPage: number;
    /** Number of records matching the query. */
    total: number;
    /** Number of pages. */
    pages: number;
  }

  /**
   * The store adapters, as `henri.model.stores` holds them.
   *
   * The ORM models themselves are not typed here: their shape is the ORM's
   * (a Mongoose `Model`, a Sequelize `ModelStatic`, a Drizzle model class),
   * and henri only adds `paginate()` and, on Mongoose with
   * `options.paranoid`, the soft-delete statics. Type a model in your own
   * application if you want more than `any` from the globals.
   */
  interface StoreAdapter {
    /** The kind of adapter (`mysql`, `disk`, ...). */
    adapterName: string;
    /** The store name (`default`). */
    name: string;
    addModel(model: ModelFile, userModelName?: string): any;
    getModels(): Record<string, any>;
    start(): Promise<unknown>;
    stop(): Promise<unknown>;
    getSessionConnector(session: unknown): Promise<unknown>;
    findUserByEmail(email: string): Promise<any>;
    findUserById(id: string): Promise<any>;
    userId(user: unknown): string;
    toPlain(user: unknown): Record<string, unknown>;
    ping(): Promise<boolean>;
    transaction<T>(fn: (transaction: any) => Promise<T>): Promise<T>;
    /** SQL adapters only: a raw query with `?` or `:name` replacements. */
    query?(
      sql: string,
      params?: unknown[] | Record<string, unknown>,
      options?: Record<string, unknown>
    ): Promise<any>;
  }

  // ---------------------------------------------------------------------------
  // View engines
  // ---------------------------------------------------------------------------

  /** What a view engine implements; `new Engine(henri)`. */
  interface ViewEngine {
    /** Level 3: check the dependencies and the layout. */
    init(): Promise<unknown>;
    /** Level 5, before the server listens: build, or start the dev server. */
    prepare(): Promise<unknown>;
    /** The catch-all serving the pages no route claimed, and the assets. */
    fallback(router: ExpressRouter): void;
    render(
      req: Request,
      res: Response,
      route: string,
      opts?: ViewOptions
    ): Promise<unknown>;
    reload?(): Promise<unknown>;
    close?(): Promise<unknown>;
  }

  // ---------------------------------------------------------------------------
  // The modules of the henri instance
  // ---------------------------------------------------------------------------

  /**
   * `henri.config`. The type of a value is only known to the application:
   * pass it (`henri.config.get<string>('secret')`).
   */
  interface ConfigModule {
    name: 'config';
    /** The loaded (and frozen) configuration. */
    config: Configuration | null;
    /** Throws when the key is missing. Keys use dots: `stores.default.url`. */
    get<T = any>(key: string): T;
    /** With `safe`, answers `false` instead of throwing. */
    get<T = any>(key: string, safe: boolean): T | false;
    has(key: string): boolean;
  }

  /** `henri.pen`, the logger. Every line is prefixed with the module name. */
  interface Pen {
    error(name: string, ...args: unknown[]): void;
    warn(name: string, ...args: unknown[]): void;
    info(name: string, ...args: unknown[]): void;
    verbose(name: string, ...args: unknown[]): void;
    debug(name: string, ...args: unknown[]): void;
    silly(name: string, ...args: unknown[]): void;
    /**
     * Prints the error with its stack and returns an Error to throw:
     * `throw henri.pen.fatal('view', 'unknown renderer')`.
     */
    fatal(
      name?: string,
      summary?: string | Error,
      full?: string | null,
      obj?: object | null
    ): Error;
    /** Prints blank lines. */
    line(times?: number): void;
    /** A desktop notification, in development. */
    notify(title?: string | null, message?: string | null): void;
  }

  /** `henri.user`. */
  interface UserModule {
    name: 'user';
    /** The normalized `config.user`. */
    settings: UserSettings | null;
    /** The passport instance holding the `local` and `jwt` strategies. */
    passport: any;
    /** Hashes a password; rejects strings shorter than 6 characters. */
    encrypt(password: string, rounds?: number): Promise<string>;
    /** Resolves `true`; rejects with an error on a mismatch, never `false`. */
    compare(password: string, hash: string): Promise<true>;
    findByEmail(email: string): Promise<any>;
    findById(id: string): Promise<any>;
    /** `{ id, email, roles }` plus `config.user.public`. */
    publicUser(user: unknown): PublicUser | null;
  }

  /** `henri.router`. */
  interface RouterModule {
    name: 'router';
    /** The expanded table, keyed `<verb> <path>`. */
    routes: Record<string, Route>;
    /** The Express router the routes are mounted on. */
    handler: ExpressRouter;
    /** The path helpers this user may follow. */
    pathForRoles(user: unknown): Paths;
  }

  /** `henri.controllers`. */
  interface ControllersModule {
    name: 'controllers';
    /** One action, by `name#action`. */
    get(key: string): Action | undefined;
    /** The `before` hooks of an action, as middlewares. */
    hooks(key: string): Array<(...args: any[]) => unknown>;
    all(): Record<string, unknown>;
    size(): number;
  }

  /** `henri.server`. */
  interface ServerModule {
    name: 'server';
    /** The Express application. */
    app: Express | null;
    express: unknown;
    httpServer: HttpServer | null;
    /** Where the server answers (`http://127.0.0.1:3000`). */
    url: string;
    host: string | null;
    port: number;
  }

  /** `henri.model`. */
  interface ModelModule {
    name: 'model';
    /** The adapter instances, by store name. */
    stores: Record<string, StoreAdapter>;
    /** The names of the model globals. */
    ids: string[];
    getStore(name: string): StoreAdapter;
    /**
     * Normalizes what any adapter throws on an invalid write into
     * `{ field: message }`, and answers `null` when the error is not a
     * validation failure (rethrow it then).
     */
    errors(error: unknown): Record<string, string> | null;
  }

  /** `henri.view`. */
  interface ViewModule {
    name: 'view';
    engine: ViewEngine | null;
    renderer: string;
    /** The Handlebars engine, always available (`res.hbs()`). */
    hbs: any;
  }

  /** `henri.mail`. */
  interface MailModule {
    name: 'mail';
    /** Sends a message through the configured transport. */
    send(message: Record<string, unknown>): Promise<any>;
    /** The nodemailer transport. */
    transporter: any;
    /** The nodemailer module. */
    nodemailer: any;
  }

  /** `henri.graphql`. */
  interface GraphqlModule {
    name: 'graphql';
    /** Path of the endpoint (`/_henri/gql`). */
    endpoint: string;
    /** Whether a schema was found and the endpoint mounted. */
    active: boolean;
    /**
     * Runs a query against the merged schema. Answers the string
     * `'No graphql schema found.'` when there is no schema.
     */
    run(
      query?: string,
      variables?: Record<string, unknown>,
      contextValue?: Record<string, unknown>
    ): Promise<{ data: unknown; errors?: readonly unknown[] } | string>;
    GraphQLError: unknown;
    ApolloError: unknown;
    SyntaxError: unknown;
    ValidationError: unknown;
    AuthenticationError: unknown;
    ForbiddenError: unknown;
    UserInputError: unknown;
    toApolloError(error: Error, code?: string): Error;
  }

  /** `henri.workers`. */
  interface WorkersModule {
    name: 'workers';
    /** The loaded workers, by file. */
    workers: Record<string, unknown>;
    files: string[];
  }

  /** `henri.api`: the JSON API settings and the stores it uses. */
  interface ApiNamespace {
    settings: ApiSettings;
    /** Resource routes already reported for answering JSON without `_links`. */
    warned: Set<string>;
    idempotencyStore: unknown;
    rateLimitStore(name: string): unknown;
    limiters: unknown[];
    stop(): void;
  }

  /** `henri.utils`. */
  interface Utils {
    resolveFrom(name: string, dir?: string): string;
    resolvePackageJson(name: string, dir?: string): string;
    /** Throws with the install command when a package is missing. */
    checkPackages(names: string[]): boolean;
    detectPackageManager(dir?: string): string;
    installCommand(names: string[]): string;
    loadModules(dir: string): Promise<unknown[]>;
    syntax(file: string): unknown;
    isLoopback(address: string): boolean;
    [key: string]: unknown;
  }

  /**
   * The running application: `global.henri` in an app, and what
   * `require('@usehenri/core')()` resolves with.
   */
  interface Henri {
    config: ConfigModule;
    pen: Pen;
    mail: MailModule;
    graphql: GraphqlModule;
    controllers: ControllersModule;
    server: ServerModule;
    model: ModelModule;
    view: ViewModule;
    user: UserModule;
    router: RouterModule;
    workers: WorkersModule;
    api: ApiNamespace;
    /** The passport instance (also `henri.user.passport`). */
    passport: any;
    /** `.permit(...fields)` and `.all()`, the helper behind `req.permit()`. */
    params(req: Request | ExpressRequest): {
      all(): Record<string, unknown>;
      permit(...fields: Array<string | string[]>): Record<string, unknown>;
    };
    /** validator.js. Install `@types/validator` for its own declarations. */
    validator: any;
    utils: Utils;
    /** A tagged template returning the query string, so editors format it. */
    gql(ast: TemplateStringsArray | string): string;

    env: string | undefined;
    isProduction: boolean;
    isDev: boolean;
    isTest: boolean;
    isTesting: boolean;
    /** The core version. */
    release: string;
    runlevel: number;
    status: Map<string, unknown>;
    /** Use the configured mail transport under `NODE_ENV=test`. */
    forceMail?: boolean;

    cwd(): string;
    init(): Promise<boolean>;
    reload(): Promise<boolean>;
    /** Resolves with the errors of the modules that failed to stop. */
    stop(): Promise<Error[]>;
    /**
     * Registers a middleware run before the routes are mounted. Call it
     * before the router starts (a `db/seeds.js`-style boot file, or a module).
     */
    addMiddleware(name: string, fn: (router: ExpressRouter) => void): boolean;
    modules: { add(module: unknown): unknown; [key: string]: unknown };
  }
}

declare global {
  /**
   * The running application. henri sets it on boot (`@usehenri/testing` does
   * it under `NODE_ENV=test`), so every file of an application can use it
   * without requiring anything.
   */
  var henri: start.Henri;
}

export = start;
