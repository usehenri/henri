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
    /** drizzle: create the session table even without a user model. */
    sessions?: boolean;
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

  /** `config.user.password`: how passwords are checked and hashed. */
  interface PasswordConfig {
    /**
     * `auto` (argon2id when `@node-rs/argon2` resolves, bcrypt otherwise),
     * `argon2id` (fails at boot when it does not) or `bcrypt`.
     */
    algorithm?: 'auto' | 'argon2id' | 'bcrypt';
    /** Shortest password accepted (`12`); never below `8`. */
    minLength?: number;
    /** Longest password accepted, in bytes (`72`, bcrypt's ceiling). */
    maxBytes?: number;
    /** bcrypt work factor (`12`); never below `10`. */
    bcryptRounds?: number;
    /** argon2id memory, in kibibytes (`19456`). */
    memoryCost?: number;
    /** argon2id iterations (`2`). */
    timeCost?: number;
    /** argon2id lanes (`1`). */
    parallelism?: number;
    /**
     * A server-side key mixed into every hash, so a stolen table cannot be
     * cracked offline. Its own key, never `config.secret`; it also reads
     * `HENRI_PASSWORD_PEPPER`. Losing it makes every peppered password
     * unverifiable. `previous` keeps a rotation working while rehash-on-login
     * migrates; `allowUnpeppered` (`true`) keeps hashes written before the
     * pepper working, and should be turned off once none are left.
     */
    pepper?:
      | string
      | {
          current: string;
          previous?: string[];
          allowUnpeppered?: boolean;
        };
  }

  /** The normalized `config.user.password`. */
  interface PasswordPolicy extends Required<Omit<PasswordConfig, 'pepper'>> {
    pepper: {
      current: Buffer | null;
      previous: Buffer[];
      allowUnpeppered: boolean;
    };
  }

  /** `config.user.lockout`: the per-account sign-in lockout. */
  interface LockoutConfig {
    /** Failed attempts allowed per account per window (`10`). */
    max?: number;
    /** The window, in milliseconds (15 minutes). */
    windowMs?: number;
    /** An express-rate-limit store; in memory, per process, by default. */
    store?: object | null;
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
    /** Password policy and hashing parameters. */
    password?: PasswordConfig;
    /** Per-account sign-in lockout; `false` turns it off. */
    lockout?: false | LockoutConfig;
    /** Registration: `POST /signup`. Off unless the application asks. */
    signup?: boolean | SignupConfig;
    /**
     * The password reset: `POST /password/forgot`,
     * `GET /password/reset/:token` and `POST /password/reset`.
     */
    passwordReset?: boolean | PasswordResetConfig;
    /**
     * The address confirmation: `GET /confirm/:token`, `POST /confirm` and
     * `POST /account/email`.
     */
    confirmation?: boolean | ConfirmationConfig;
  }

  /** `config.user.signup`. */
  interface SignupConfig {
    /** `false` leaves the endpoint unmounted. */
    enabled?: boolean;
    /** Where the endpoint is mounted (`/signup`). */
    path?: string;
    /**
     * Attributes a signup form may set, besides `email` and `password`.
     * `roles`, `confirmedAt` and `passwordChangedAt` are never assignable.
     */
    fields?: string[];
    /** Where a browser lands after a successful signup (`/`). */
    after?: string;
    /** Open a session for the new account (`true`). */
    login?: boolean;
  }

  /** `config.user.passwordReset`. */
  interface PasswordResetConfig {
    /** `false` leaves the endpoints unmounted. */
    enabled?: boolean;
    /** Prefix of the three endpoints (`/password`). */
    path?: string;
    /** How long a link stays valid (`'1h'`). */
    expiresIn?: Duration;
    /** Where a browser lands after a successful reset (`/`). */
    after?: string;
    /** Sign the account in once the password changed (`true`). */
    login?: boolean;
  }

  /** `config.user.confirmation`. */
  interface ConfirmationConfig {
    /** `false` leaves the endpoints unmounted. */
    enabled?: boolean;
    /** Prefix of the confirmation endpoints (`/confirm`). */
    path?: string;
    /** Where an address change is asked for (`/account/email`). */
    emailPath?: string;
    /** How long a link stays valid (`'3d'`). */
    expiresIn?: Duration;
    /** Where a browser lands after a confirmation (`/`). */
    after?: string;
    /** Keep unconfirmed accounts from opening a session (`false`). */
    required?: boolean;
    /** Ask for the current password before changing an address (`true`). */
    requirePassword?: boolean;
  }

  /** The normalized `config.user`, as `henri.user.settings`. */
  interface UserSettings extends Required<
    Omit<
      UserConfig,
      'password' | 'lockout' | 'signup' | 'passwordReset' | 'confirmation'
    >
  > {
    password: PasswordPolicy;
    lockout: Required<LockoutConfig> | null;
  }

  /** `config.csrf` when it is an object rather than a boolean. */
  interface CsrfConfig {
    /** `false` keeps the token check without the origin check. */
    origin?: boolean;
    /**
     * Other origins allowed to send an unsafe request with a session cookie;
     * whatever `config.cors` allows is trusted already.
     */
    trustedOrigins?: string[];
  }

  /** `config.graphql` when it is an object rather than the endpoint. */
  interface GraphqlConfig {
    /** Path of the endpoint (`/_henri/gql`). */
    endpoint?: string;
    /** Require a signed-in user. */
    authenticated?: boolean;
    /** Require these roles (implies `authenticated`). */
    roles?: string | string[];
    /** Answer 404 to anything but the loopback interface. */
    loopbackOnly?: boolean;
    /** Introspection; on outside production by default. */
    introspection?: boolean;
    /** Deepest query accepted (`10`); `false` lifts the limit. */
    maxDepth?: number | false;
    /** Most aliases one query may use (`15`); `false` lifts the limit. */
    maxAliases?: number | false;
    /** Most fields one query may select (`1000`); `false` lifts the limit. */
    maxComplexity?: number | false;
    /** Most tokens one document may hold (`5000`); `false` lifts the limit. */
    maxTokens?: number | false;
  }

  /** The normalized `config.graphql`, as `henri.graphql.settings`. */
  interface GraphqlSettings {
    endpoint: string;
    authenticated: boolean;
    roles: string[];
    loopbackOnly: boolean;
    introspection: boolean | null;
    maxDepth: number;
    maxAliases: number;
    maxComplexity: number;
    maxTokens: number;
  }

  /** `henri.accounts.settings`: the three blocks of `config.user`, normalized. */
  interface AccountSettings {
    signup: Required<SignupConfig>;
    passwordReset: Required<Omit<PasswordResetConfig, 'expiresIn'>> & {
      expiresIn: number;
    };
    confirmation: Required<Omit<ConfirmationConfig, 'expiresIn'>> & {
      expiresIn: number;
    };
  }

  /** What a token is allowed to do; it is part of what the token signs. */
  interface AccountPurposes {
    confirmation: 'confirmation';
    emailChange: 'email-change';
    reset: 'password-reset';
  }

  /** What a flow answers: the record, and a message per field when it refused. */
  interface AccountResult {
    ok: boolean;
    /** `{ email: 'is already registered' }`; empty when it went through. */
    errors: Record<string, string>;
    /** `malformed`, `purpose`, `signature`, `expired`, `unknown`, `taken`. */
    reason?: string | null;
    user: any;
  }

  /**
   * `henri.accounts`: registration, the password reset and the address
   * confirmation. The endpoints of `config.user` call this, and so can a
   * controller that would rather answer them itself.
   */
  interface AccountsService {
    PURPOSE: AccountPurposes;
    /** The normalized `config.user.signup`, `passwordReset`, `confirmation`. */
    readonly settings: AccountSettings;
    /** `henri.user.passwordPolicy`: read `minLength` rather than hard-coding it. */
    policy(): PasswordPolicy;
    /** `henri.user.validatePassword()`, so one rule governs both flows. */
    checkPassword(
      password: unknown
    ): ReturnType<UserModule['validatePassword']>;
    /** Creates an account; `roles` is never assignable here. */
    register(attributes: Record<string, unknown>): Promise<AccountResult>;
    /**
     * Answers nothing about the address: the lookup and the mail run after
     * the caller's own answer is written.
     */
    requestPasswordReset(email: string): Promise<void>;
    /** Changes the password, retires the other sessions, spends the token. */
    resetPassword(token: string, password: unknown): Promise<AccountResult>;
    requestConfirmation(email: string): Promise<void>;
    /** Confirms an address, or applies an `email-change` token. */
    confirm(token: string): Promise<AccountResult>;
    /** Mails a link; the address changes only when it is followed. */
    requestEmailChange(
      user: unknown,
      email: string
    ): Promise<{ ok: boolean; errors: Record<string, string> }>;
    /** Mints a token for a user; mostly useful in tests. */
    tokenFor(
      user: unknown,
      purpose: string,
      options?: { data?: unknown; expiresIn?: number }
    ): Promise<string | null>;
    /** Verifies a token and loads the account it names. */
    consume(
      token: string,
      purpose: string
    ): Promise<{
      ok: boolean;
      payload: Record<string, unknown> | null;
      reason: string | null;
      user: any;
    }>;
    sendConfirmation(user: unknown): Promise<string | null>;
    sendReset(user: unknown): Promise<string | null>;
    /** May this account open a session? (`confirmation.required`) */
    allowed(user: unknown): boolean;
    /** The public identifier a token names the account by. */
    identify(user: unknown): string | null;
    /** The absolute url of a path, for the links inside the mails. */
    urlFor(path: string): string;
    /** Waits for the work the flows started after their answers. */
    drain(): Promise<boolean>;
  }

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
          /** Alias of `max`, the name express-rate-limit 8 uses. */
          limit?: number;
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

  /** A duration: milliseconds, or `'250ms'`, `'30s'`, `'5m'`, `'2h'`, `'1d'`. */
  type Duration = number | string;

  /** One entry of `config.jobs.recurring`, keyed by schedule name. */
  interface RecurringConfig {
    /** The job to enqueue (the schedule name by default). */
    job?: string;
    /** An alias of `job`. */
    name?: string;
    /** A cron expression, read in UTC; `cron` or `every`, never both. */
    cron?: string;
    /** How often to run it; `cron` or `every`, never both. */
    every?: Duration;
    /** The arguments handed to the job. */
    args?: unknown;
    /** The queue it goes to. */
    queue?: string;
    /** The higher, the sooner. */
    priority?: number;
  }

  /** `config.jobs`: the background job queue of `@usehenri/jobs`. */
  interface JobsConfig {
    /** Which store of `stores` holds the queue (`default`). */
    store?: string;
    /** Table (or collection) name (`henri_jobs`); identifiers only. */
    table?: string;
    /** Queue of a job that names none (`default`). */
    queue?: string;
    /** Queues a runner takes from when given no `--queue`. */
    queues?: string | string[];
    /** How many jobs one runner performs at once (`5`). */
    concurrency?: number;
    /** Attempts before a job goes to the dead letter queue (`5`). */
    maxAttempts?: number;
    /** How long one attempt may take; `null` for no limit. */
    timeout?: Duration | null;
    /** Priority of a job that names none (`0`). */
    priority?: number;
    /** `base × factor^(attempt − 1)`, capped at `max`, spread by `jitter`. */
    backoff?: {
      base?: Duration;
      factor?: number;
      jitter?: number;
      max?: Duration;
    };
    /** How often a runner looks for work (`1s`, never under 50ms). */
    pollInterval?: Duration;
    /** Without a heartbeat for that long, a running job is put back (`5m`). */
    stuckAfter?: Duration;
    /** How long finished jobs are kept (`1d`); `0` keeps them forever. */
    keepCompleted?: Duration;
    /** Size limit of the serialized arguments of one job (`524288`). */
    maxArgsBytes?: number;
    /** Queue of the messages `deliverLater()` hands over (`mailers`). */
    mailQueue?: string;
    /** Create the tables at boot (`true`). */
    install?: boolean;
    /** Schedules, by name. */
    recurring?: Record<string, RecurringConfig>;
  }

  /** `config.mailers`: the defaults of the mailers in `app/mailers`. */
  interface MailersConfig {
    /** Sender of every message that does not set one. */
    from?: string;
    /** Layout in `app/views/mailers/layouts` (`mailer`); `false` for none. */
    layout?: string | false;
    /** `false` turns the development preview routes off. */
    previews?: boolean;
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
    /**
     * The canonical address of the application (`https://example.com`), used
     * for the links inside the mails henri sends. Without one the running
     * server's own url is used, which is right in development and wrong
     * behind a proxy.
     */
    url?: string;
    /** Name of the user model, or its settings. */
    user?: string | UserConfig;
    /** Role, or roles, given to every new user. */
    baseRole?: string | string[];
    /** Express `trust proxy` (`true`). */
    trustProxy?: boolean | number | string;
    /** `false` disables the CSRF protection. */
    csrf?: boolean | CsrfConfig;
    /**
     * Path of the GraphQL endpoint, or its settings. Validated here whether
     * or not the application has `@usehenri/graphql`, which is what reads it.
     */
    graphql?: string | GraphqlConfig;
    /** Nodemailer transport options, or `"test"` for an Ethereal account. */
    mail?: 'test' | Record<string, unknown>;
    mailers?: MailersConfig;
    api?: ApiConfig;
    jobs?: JobsConfig;
    rateLimit?: boolean | RateLimitConfig;
    /** Options merged over henri's helmet defaults; `false` disables it. */
    helmet?: false | Record<string, unknown>;
    /** Parameter names masked in the logs; `false` masks nothing. */
    filterParameters?: string[] | false;
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
    /** The public uuid. Absent only when the user model opted out. */
    externalId?: string;
    /** The primary key, and only when the user model opted out. */
    id?: string;
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
    /**
     * The GraphQL errors when the page was rendered from a query, or the
     * messages a redirecting handler left in the flash (`req.flash('errors',
     * { email: 'is required' })`), keyed by field.
     */
    errors?: readonly unknown[] | Record<string, unknown> | null;
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
    /** The password policy in force (`config.user.password`, normalized). */
    readonly passwordPolicy: PasswordPolicy;
    /** The per-account lockout, `null` when `config.user.lockout` is false. */
    lockout: object | null;
    /**
     * Checks a password against the policy without hashing it. Never throws:
     * every entry of `errors` carries a stable `code` (`missing`,
     * `too_short`, `too_long`) and a message a form can show.
     */
    validatePassword(password: unknown): {
      valid: boolean;
      errors: Array<{ code: string; message: string; [key: string]: unknown }>;
      policy: { minLength: number; maxBytes: number };
    };
    /**
     * Hashes a password with argon2id (or bcrypt), after checking it against
     * the policy. `rounds` is deprecated: it overrides
     * `config.user.password.bcryptRounds` and is ignored under argon2id.
     */
    encrypt(password: string, rounds?: number): Promise<string>;
    /** Resolves `true`; rejects with an error on a mismatch, never `false`. */
    compare(password: string, hash: string): Promise<true>;
    /**
     * Writes a stored hash again with the current parameters, after its
     * owner proved the password. Applies no policy and never throws.
     */
    rehash(user: unknown, password: string): Promise<boolean>;
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

  /**
   * `henri.graphql`: the module `@usehenri/graphql` ships. It is there when
   * the application depends on the package, and `undefined` when it does
   * not -- core carries no GraphQL of its own.
   */
  interface GraphqlModule {
    name: 'graphql';
    /** Path of the endpoint (`/_henri/gql`). */
    endpoint: string;
    /** The normalized `config.graphql`: the limits and the access rules. */
    settings: GraphqlSettings;
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

  /** One job of the queue, as `henri.jobs` hands it out. */
  interface Job {
    id: string;
    name: string;
    queue: string;
    state: 'pending' | 'running' | 'done' | 'dead';
    args: unknown;
    priority: number;
    attempts: number;
    maxAttempts: number;
    /** The timeout of one attempt, in milliseconds. */
    timeout: number | null;
    /** How long the last attempt took, in milliseconds. */
    duration: number | null;
    /** Moments are ISO strings. */
    runAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    claimedAt: string | null;
    claimedBy: string | null;
    error: { message: string; stack: string | null } | null;
    history: Array<{
      attempt: number;
      at: string;
      duration: number;
      message: string;
      runner: string | null;
    }>;
    uniqueKey: string | null;
  }

  /** The options of an enqueue. */
  interface JobOptions {
    /** Run it that much later: milliseconds, or `'5m'`. */
    wait?: number | string;
    /** Run it at that moment. */
    at?: Date | string | number;
    queue?: string;
    /** Lower goes first. */
    priority?: number;
    maxAttempts?: number;
    timeout?: number | string;
    /** A key no other job of the queue may hold. */
    unique?: string;
  }

  /** What a job's `perform(args, context)` receives as its context. */
  interface JobContext {
    henri: Henri;
    job: {
      id: string;
      name: string;
      queue: string;
      args: unknown;
      attempt: number;
      maxAttempts: number;
      enqueuedAt: string | null;
      runner: string | null;
      inline?: boolean;
    };
    /** Aborted when the attempt runs past its timeout. */
    signal: AbortSignal;
  }

  /** A file of `app/jobs`. */
  interface JobDefinition {
    perform(args: any, context: JobContext): unknown | Promise<unknown>;
    queue?: string;
    priority?: number;
    maxAttempts?: number;
    timeout?: number | string;
    backoff?: {
      base?: number | string;
      factor?: number;
      max?: number | string;
      jitter?: number;
    };
  }

  /** What the queue holds, by queue and state. */
  interface JobStats {
    totals: { pending: number; running: number; done: number; dead: number };
    queues: Array<{
      queue: string;
      pending: number;
      running: number;
      done: number;
      dead: number;
      /** How long the oldest job that is due has waited, in milliseconds. */
      waiting: number;
    }>;
    timings: Array<{
      queue: string;
      runs: number;
      shortest: number;
      longest: number;
      average: number;
    }>;
    /** The job names of the application. */
    jobs: string[];
  }

  /** A filter of `henri.jobs.list()`. */
  interface JobFilter {
    state?: 'pending' | 'running' | 'done' | 'dead';
    queue?: string;
    name?: string;
    limit?: number;
    offset?: number;
  }

  /**
   * `henri.jobs`: the background job queue of `@usehenri/jobs`. Every method
   * throws when the application has none (`henri.jobs.enabled` is false).
   */
  interface JobsModule {
    name: 'jobs';
    /** Whether the application has a queue. */
    enabled: boolean;
    /** Enqueues a job; nothing runs in this process. */
    perform(name: string, args?: unknown, options?: JobOptions): Promise<Job>;
    /** The name `henri.mailers.onDeliverLater()` expects. */
    enqueue(name: string, args?: unknown, options?: JobOptions): Promise<Job>;
    /** Enqueues a job to run later (`'5m'`, or milliseconds). */
    performIn(
      wait: number | string,
      name: string,
      args?: unknown,
      options?: JobOptions
    ): Promise<Job>;
    /** Enqueues a job to run at a given moment. */
    performAt(
      when: Date | string | number,
      name: string,
      args?: unknown,
      options?: JobOptions
    ): Promise<Job>;
    /** Performs a job here and now, without the queue (tests, console). */
    performNow(name: string, args?: unknown): Promise<unknown>;
    get(id: string): Promise<Job | null>;
    list(filter?: JobFilter): Promise<Job[]>;
    stats(): Promise<JobStats>;
    /** The job names of the application. */
    names(): string[];
    /** The dead letter queue. */
    dead: {
      count(): Promise<number>;
      list(filter?: JobFilter): Promise<Job[]>;
      get(id: string): Promise<Job | null>;
      /** Puts a job back in its queue; its attempts start over. */
      retry(id: string, options?: JobOptions): Promise<Job | null>;
      retryAll(filter?: JobFilter, options?: JobOptions): Promise<number>;
      discard(id: string): Promise<boolean>;
      discardAll(filter?: JobFilter): Promise<number>;
    };
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
    /**
     * The GraphQL module, when the application depends on
     * `@usehenri/graphql`. Rendering with `{ graphql }` or declaring types
     * on a model without it fails and says what to install.
     */
    graphql?: GraphqlModule;
    controllers: ControllersModule;
    server: ServerModule;
    model: ModelModule;
    view: ViewModule;
    user: UserModule;
    router: RouterModule;
    jobs: JobsModule;
    workers: WorkersModule;
    api: ApiNamespace;
    /** Registration, the password reset and the address confirmation. */
    accounts: AccountsService;
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
     * What the boot did: the order, the timings, what every module waited on
     * and the chain that decided the total. `null` before `init()`. Same as
     * `henri.modules.analyze()`, and what `henri analyze --json` prints.
     */
    analyze(name?: string): BootAnalysis | null;
    /**
     * Registers a middleware run before the routes are mounted. Call it
     * before the router starts (a `db/seeds.js`-style boot file, or a module).
     */
    addMiddleware(name: string, fn: (router: ExpressRouter) => void): boolean;
    modules: ModulesRegistry;
  }

  // ---------------------------------------------------------------------------
  // The module system
  // ---------------------------------------------------------------------------

  /**
   * What a module declares. Extend `@usehenri/core/module` and set
   * `name`, then say where you go: `needs` (the modules you cannot work
   * without), `after` and `before` (ordering only, ignored when the module is
   * not registered), or `runlevel` alone (the slot: after every lower level,
   * before every higher one). Naming replaces the number.
   */
  interface HenriModule {
    /** Unique: the module is exposed as `henri.<name>`. */
    name: string;
    /** Set by henri when the module is registered. */
    henri?: Henri;
    /** Registered and finished before this one starts. */
    needs?: string | string[];
    /** Ordering only: they go first when they are registered. */
    after?: string | string[];
    /** Ordering only: they wait for this one when they are registered. */
    before?: string | string[];
    /** The slot (0 to 6). The boot ceiling and numeric pins use it. */
    runlevel?: number;
    /** Implements `reload()`, called on every reload. */
    reloadable?: boolean;
    /** Skipped under `henri console`. */
    consoleOnly?: boolean;
    init(): unknown | Promise<unknown>;
    /** Called in graph order on a reload, when `reloadable`. */
    reload?(): unknown | Promise<unknown>;
    /** Called backwards before anything reloads, to let go of what it holds. */
    release?(): unknown | Promise<unknown>;
    /** Called backwards on shutdown. */
    stop?(): unknown | Promise<unknown>;
  }

  /** `henri.modules`: the registry and the boot graph. */
  interface ModulesRegistry {
    /** Registers a module. Throws when the name is taken or the module is invalid. */
    add(module: HenriModule): boolean;
    /**
     * Registers the modules of the application, which `init()` does before
     * the boot: the packages it depends on that declare
     * `"henri": { "module": "./module.js" }` in their package.json, its own
     * `app/modules/*.js`, and whatever `config/modules.js` adds.
     */
    discover(): Promise<string[]>;
    /** The modules of the packages the application depends on. */
    fromPackages(cwd?: string): string[];
    /** The modules of `app/modules`. */
    fromDirectory(dir?: string): string[];
    /** The modules `config/modules.js` adds. */
    fromFile(file?: string): Promise<string[]>;
    /** Same as `henri.analyze()`. */
    analyze(name?: string): BootAnalysis | null;
    /** The modules, last started first: the order `stop()` goes in. */
    readonly stopOrder: HenriModule[];
    initialized: boolean;
    [key: string]: unknown;
  }

  /** One module in the boot chart. */
  interface BootModule {
    name: string;
    runlevel: number;
    /** `name` when the module declared its neighbours, `runlevel` otherwise. */
    pin: 'name' | 'runlevel';
    state: 'waiting' | 'running' | 'done' | 'failed';
    /** Milliseconds since the start of the boot, `null` when it never ran. */
    startedAt: number | null;
    duration: number | null;
    /** How long its `release()` took on the last reload. */
    releaseDuration: number | null;
    error: string | null;
    /** What it waited on, and what put the edge there. */
    waitsOn: Array<{ name: string; why: string }>;
    /** What waits on it. */
    blocks: string[];
    /** The dependency that finished last: the one that held it up. */
    blockedBy: string | null;
  }

  /** What `henri.analyze()` answers. */
  interface BootAnalysis {
    ok: boolean;
    /** The level the boot stopped at. */
    ceiling: number;
    startedAt: string;
    duration: number | null;
    modules: BootModule[];
    /** The chain that decided how long the boot took, first started first. */
    criticalPath: Array<{
      name: string;
      startedAt: number | null;
      duration: number | null;
    }>;
    /** What each level is for, and the modules that sit in it. */
    chart: Array<{ level: number; purpose: string; modules: string[] }>;
    /** The modules the boot ceiling left out. */
    skipped: Array<{ name: string; runlevel: number }>;
    /** The module whose `init()` threw, when the boot failed. */
    failed: string | null;
    /** The last reload, `null` until one happens. */
    reload: {
      startedAt: string;
      duration: number | null;
      released: string[];
      modules: BootModule[];
      criticalPath: Array<{
        name: string;
        startedAt: number | null;
        duration: number | null;
      }>;
    } | null;
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
