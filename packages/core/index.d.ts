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
    /**
     * SQL: `false` stops the development boot from bringing the schema up.
     * On a Sequelize store `true` also lets a production boot create the
     * tables that are missing, which it otherwise refuses to do.
     */
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
    /**
     * Binds a hash to the `externalId` of the record it belongs to, so a hash
     * copied onto another row stops verifying. Where the pepper stops an
     * attacker with database write access *forging* a hash, this stops them
     * *moving* one. `true` by default, and a no-op on a user model that opted
     * out of `externalId`. `allowUnbound` (`true`) keeps the hashes written
     * before it working — they are written back bound as their owners sign in
     * — and should be turned off once none are left.
     */
    binding?:
      | boolean
      | {
          enabled?: boolean;
          allowUnbound?: boolean;
        };
  }

  /** The normalized `config.user.password`. */
  interface PasswordPolicy extends Required<
    Omit<PasswordConfig, 'pepper' | 'binding'>
  > {
    pepper: {
      current: Buffer | null;
      previous: Buffer[];
      allowUnpeppered: boolean;
    };
    binding: {
      enabled: boolean;
      allowUnbound: boolean;
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

  /**
   * What a signed account token is allowed to do. A fourth string is not an
   * extension point: it would be minted with the confirmation seed and only
   * a `consume()` carrying the identical typo could ever spend it, so it is
   * refused with `HENRI_ARGUMENT_INVALID`.
   */
  type AccountPurpose = AccountPurposes[keyof AccountPurposes];

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
     * the caller's own answer is written. It has nowhere to say "that is not
     * an address", so anything that is not a string is refused; the endpoint
     * in front of it answers 422 long before that.
     */
    requestPasswordReset(email: string): Promise<void>;
    /** Changes the password, retires the other sessions, spends the token. */
    resetPassword(token: unknown, password: unknown): Promise<AccountResult>;
    requestConfirmation(email: string): Promise<void>;
    /** Confirms an address, or applies an `email-change` token. */
    confirm(token: unknown): Promise<AccountResult>;
    /** Mails a link; the address changes only when it is followed. */
    requestEmailChange(
      user: object,
      email: unknown
    ): Promise<{ ok: boolean; errors: Record<string, string> }>;
    /** Mints a token for a user; mostly useful in tests. */
    tokenFor(
      user: object,
      purpose: AccountPurpose,
      options?: { data?: unknown; expiresIn?: number }
    ): Promise<string | null>;
    /** Verifies a token and loads the account it names. */
    consume(
      token: unknown,
      purpose: AccountPurpose
    ): Promise<{
      ok: boolean;
      payload: Record<string, unknown> | null;
      reason: string | null;
      user: any;
    }>;
    sendConfirmation(user: object): Promise<string | null>;
    sendReset(user: object): Promise<string | null>;
    /** May this account open a session? (`confirmation.required`) */
    allowed(user: object): boolean;
    /** The public identifier a token names the account by. */
    identify(user: object): string | null;
    /**
     * The absolute url of a path, for the links inside the mails. It is a
     * path: anything else is glued to the host and then mailed.
     */
    urlFor(path: `/${string}`): string;
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

  /**
   * `config.externalIds`: what henri does with the internal identifier of a
   * record. Every model carries an `externalId` (a uuid v7) unless it opts
   * out with `options: { externalId: false }`; the two keys here say
   * whether the primary key may still be looked up, and whether a declared
   * foreign key leaves as the public identifier of the row it names.
   */
  interface ExternalIdsConfig {
    /**
     * Which identifier `Model.findById()` resolves (`'external'`). The
     * default takes the `externalId` and nothing else, so a primary key in
     * a url answers the same `null` an unknown uuid answers; `'any'`
     * restores the primary key lookup. `findByKey()` always takes the
     * primary key, whatever this says.
     */
    lookup?: 'any' | 'external';
    /**
     * Replace a declared foreign key with the `externalId` of the row it
     * names, on the way out (`true`). `false` sends the number the database
     * holds, so a record carries another row's primary key.
     */
    references?: boolean;
  }

  /**
   * `config.policies`: what henri does with the answer of a policy in
   * `app/policies`. Writing the file is what turns policies on; this key
   * only holds the two decisions an application may differ on.
   */
  interface PoliciesConfig {
    /**
     * What a refusal answers a signed-in user (`404`). `403` says the
     * record is there and off limits; `404` says nothing at all. An
     * anonymous visitor always gets a `401` and, in a browser, the login
     * page.
     */
    status?: 403 | 404;
    /**
     * Report a route that declared a policy henri could not answer without
     * the record, whose action then answered without ever asking (`true`).
     */
    verify?: boolean;
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
    /**
     * Module exporting an express-rate-limit store, or a factory. Without
     * one the limiter counts in `config.shared`, and without that in this
     * process only.
     */
    store?: string | null;
  }

  /**
   * `config.shared`: the backend the rate limit, the sign-in lockout and the
   * idempotency keys count in, so two processes share one set of counters.
   * Anything beyond these keys reaches the driver.
   */
  interface SharedConfig {
    /**
     * An adapter name (`"redis"` resolves `@usehenri/redis` from the
     * application), or the module id of a backend of your own.
     */
    adapter: string;
    /** `false` keeps the block and counts in this process again (`true`). */
    enabled?: boolean;
    /** Connection string (`redis://`, `rediss://`). */
    url?: string;
    /** Key prefix (`"henri:"`); one per application on a shared server. */
    prefix?: string;
    /**
     * What a request does when the backend does not answer: `"closed"`
     * (the default) refuses it with a 503 and a `Retry-After`, `"open"`
     * serves it uncounted. The idempotency keys are always closed.
     */
    onError?: 'closed' | 'open';
    [key: string]: unknown;
  }

  /**
   * `config.cache`: what `henri.cache` keeps, for how long, and how much of
   * it. `false` turns the cache off, and every `fetch` then runs its
   * function.
   */
  interface CacheConfig {
    /** `false` keeps the block and turns the cache off (`true`). */
    enabled?: boolean;
    /**
     * How long an entry lives when a call does not say (`"5m"`). Every
     * entry has one: there is no way to keep a value forever.
     */
    ttl?: number | string;
    /**
     * Entries the memory backend may hold (`1000`); the least recently used
     * goes first. Nothing to do with a shared backend, which has its own.
     */
    maxEntries?: number;
    /** Everything the memory backend may hold, encoded (`"32mb"`). */
    maxSize?: number | string;
    /**
     * What one value may weigh, encoded, on any backend (`"256kb"`). A
     * bigger one is not cached: `set` answers `false` and says so once.
     */
    maxEntrySize?: number | string;
    /**
     * Module exporting a `{ get, set, delete }` store, or a factory.
     * Without one the cache is the backend of `config.shared`, and without
     * that this process's memory.
     */
    store?: string | null;
  }

  /**
   * `config.csp`: the Content Security Policy settings henri owns. The
   * policy itself is helmet's (`config.helmet.contentSecurityPolicy`).
   */
  interface CspConfig {
    /**
     * `true` gives every response a fresh nonce (`res.locals.cspNonce`,
     * `req._henri.nonce`, the `nonce` view option), names it in
     * `script-src` and takes `'unsafe-inline'` out of that directive. The
     * renderer has to be able to carry it or the boot fails: `inertia`,
     * `react` and `template` can, `vue` cannot.
     */
    nonce?: boolean;
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

  /**
   * `config.jobs`: the background job queue. Validated here whether or not
   * the application has `@usehenri/jobs`, which is what reads it.
   */
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

  /**
   * `config.webhooks`: the outbound webhooks. Validated here whether or not
   * the application has `@usehenri/webhooks`, which is what reads it.
   */
  interface WebhooksConfig {
    /** Which store of `stores` holds the endpoints (`default`). */
    store?: string;
    /** Table (or collection) name (`henri_webhooks`); identifiers only. */
    table?: string;
    /** Create the table at boot (`true`). */
    install?: boolean;
    /** The queue the deliveries go to (`webhooks`). */
    queue?: string;
    /** Attempts before a delivery goes to the dead letter queue (`8`). */
    maxAttempts?: number;
    /** How long one delivery may take, answer included (`10s`). */
    timeout?: Duration;
    /** `base × factor^(attempt − 1)`, capped at `max`, spread by `jitter`. */
    backoff?: {
      base?: Duration;
      factor?: number;
      jitter?: number;
      max?: Duration;
    };
    /** How many deliveries one `emit()` may enqueue (`1000`). */
    maxFanout?: number;
    /** Let a delivery reach a private or loopback address; development only. */
    allowPrivate?: boolean;
    /** Let a delivery go to a plaintext http url; development only. */
    allowHttp?: boolean;
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
    /** Which identifier a lookup takes, and what a foreign key serializes as. */
    externalIds?: ExternalIdsConfig;
    /** What a refused policy answers, and whether an unasked one is reported. */
    policies?: PoliciesConfig;
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
    webhooks?: WebhooksConfig;
    rateLimit?: boolean | RateLimitConfig;
    shared?: SharedConfig;
    /** `henri.cache`: what it keeps and for how long; `false` turns it off. */
    cache?: false | CacheConfig;
    /** Options merged over henri's helmet defaults; `false` disables it. */
    helmet?: false | Record<string, unknown>;
    /** Content Security Policy settings henri owns, beside `helmet`. */
    csp?: CspConfig;
    /**
     * Parameter names masked in the logs (substrings, like Rails'
     * `filter_parameters`); `false` masks nothing. Setting this *replaces*
     * the defaults, so one name is masked whatever it says: anything
     * containing `encryption`, which is where the key that opens the
     * encrypted columns lives.
     */
    filterParameters?: string[] | false;
    /** What a log line looks like: `pretty`, `json`, or `auto`. */
    logs?: LogsConfig;
    /**
     * OpenTelemetry spans and metrics; `false` instruments nothing. henri
     * ships no SDK and no exporter: `@opentelemetry/api` is a peer
     * dependency the application installs, with the pipeline of its choice.
     */
    telemetry?: false | TelemetryConfig;
    encryption?: EncryptionConfig;
    privacy?: PrivacyConfig;
    /** How long the models keep their records, and what sweeps them. */
    retention?: RetentionConfig;
    /** The access trail; absent or `false` keeps none. */
    trail?: false | TrailConfig;
    /**
     * The call log: the calls the application answered and the calls it
     * made. Absent (or `false`) keeps none, and no table is created.
     */
    calls?: false | CallsConfig;
    /**
     * Where the history of the versioned models lives and how long it is
     * kept. It does not turn versioning on: a model does, with
     * `options: { versioned: true }`.
     */
    versions?: VersionsConfig;
    /** Maximum size of a JSON or form body (`"1mb"`). */
    bodyLimit?: string | number;
    /**
     * File uploads, read by `@usehenri/uploads`; `false` accepts no file.
     * Validated here whether or not the application has the package.
     */
    uploads?: false | UploadsConfig;
    /** Milliseconds before a running request is answered 503. */
    requestTimeout?: number | false;
    shutdown?: ShutdownConfig;
    errors?: ErrorsConfig;
    [key: string]: unknown;
  }

  /**
   * `config.encryption`: the keys that open the fields the models marked
   * `encrypted`. Which fields those are is said in the models themselves.
   *
   * The keys are secrets: they belong in `config/credentials/<env>.json.enc`
   * (`henri credentials:edit`) or in `HENRI_ENCRYPTION_KEYS`, never in a
   * `config/*.json`, which is committed. `henri audit` reports it when they
   * are.
   */
  interface EncryptionConfig {
    /**
     * The key, or the keys with the one that writes first, each 64
     * hexadecimal characters (`openssl rand -hex 32`). Every key decrypts;
     * only the first encrypts, which is what makes a rotation a deploy
     * rather than a migration.
     */
    keys?: string | string[];
    /**
     * Whether a column declared encrypted may answer with a value that is
     * not encrypted (`false`). `true` is what makes a backfill possible on
     * a table that is already full; take it out once
     * `henri encryption:status` reports no plaintext left.
     */
    readPlaintext?: boolean;
  }

  /**
   * `config.privacy`: what henri does with the fields the models marked
   * `personal`. Which fields those are is said in the models themselves.
   */
  interface PrivacyConfig {
    /**
     * Whether a personal field may leave the server in an answer henri
     * builds (`true`). `false` drops every one of them unless the field
     * says `personal: { expose: true }`.
     */
    expose?: boolean;
    /**
     * What happens to the records of an erased person, for the models that
     * do not say it themselves (`"anonymize"`).
     */
    onErase?: 'anonymize' | 'delete' | 'orphan' | 'retain';
    /**
     * Where `henri privacy:erase` writes its receipt (`"privacy"`);
     * `false` keeps none beyond what the command printed.
     */
    receipts?: string | false;
  }

  /**
   * `config.retention`: what runs the retention sweep, and what it is
   * allowed to do. How long a model keeps its records is said in the model
   * itself (`options: { retention }`).
   */
  interface RetentionConfig {
    /**
     * Whether a rule has to be approved before it writes anything
     * (`true`). A rule that is not in `approved` is planned, counted and
     * reported, and it writes nothing.
     */
    approve?: boolean;
    /**
     * The tokens of the approved rules (`"Proposal:drafts:9f3c1a2b4d5e"`).
     * `henri retention` prints them; a rule whose terms change gets a new
     * one and is pending again.
     */
    approved?: string[];
    /**
     * How many records one rule may take in one sweep (`1000`); `false`
     * lifts the bound. What is left over is reported and taken next run.
     */
    batch?: number | false;
    /**
     * Where a sweep writes the proof that it ran (`"privacy"`); `false`
     * keeps none beyond what the command printed.
     */
    receipts?: string | false;
    /**
     * A cron expression (`"0 3 * * *"`) or an interval (`"1d"`) the
     * `henri/retention` job runs on; needs `@usehenri/jobs`. `false` (the
     * default) means the sweep is run by `henri retention:sweep`.
     */
    schedule?: string | false;
  }

  /**
   * `config.trail`: the append-only record of who read or changed personal
   * data. Absent (or `false`) keeps none, and no table is created.
   */
  interface TrailConfig {
    /**
     * How long an entry is kept (`"1y"`); `false` keeps them forever. A
     * trail of who touched personal data is itself personal data.
     */
    keep?: string | number | false;
    /**
     * Which reads are recorded: `"personal"` for the answers carrying a
     * model with a personal field, `"all"` for every answer henri
     * serializes, `false` (the default) for none.
     */
    reads?: 'all' | 'personal' | false;
    /** Which of `config.stores` the table lives in (`"default"`). */
    store?: string;
    /** The table henri creates and appends to (`"henri_trail"`). */
    table?: string;
  }

  /**
   * `config.versions`: where the history of the models that say
   * `options: { versioned: true }` is kept.
   *
   * There is no switch here. A model asking is what creates the table; an
   * application with no versioned model pays nothing whatever this says.
   */
  interface VersionsConfig {
    /**
     * How long a version is kept; `false` (the default) keeps it for as
     * long as the application does. A version holds the old values of a
     * record, personal ones included, so the retention sweep prunes them.
     */
    keep?: string | number | false;
    /**
     * What `henri privacy:erase` does to the versions of the records it
     * touched. `"follow"` (the default) takes the versions of a deleted
     * record away and empties the erased values out of the versions of a
     * record that survives; `"delete"` takes them all; `"retain"` leaves
     * them and says so in the receipt.
     */
    onErase?: 'delete' | 'follow' | 'retain';
    /** Which of `config.stores` the table lives in (`"default"`). */
    store?: string;
    /** The table henri creates and writes to (`"henri_versions"`). */
    table?: string;
  }

  /**
   * `config.calls`: the calls an application answered and the calls it
   * made, joined by the request id. Absent (or `false`) keeps none: no
   * table is created and no middleware is mounted.
   *
   * It holds **values**, which the access trail deliberately does not. See
   * the guide before turning it on.
   */
  /**
   * What the call log records about the client's address, and when it
   * believes a forwarded one. `false` records none.
   */
  interface CallsAddressConfig {
    /**
     * `true` drops the last octet of an IPv4 and the last 80 bits of an
     * IPv6, keeping the prefix length in the value (`203.0.113.0/24`).
     * `false` by default: the column exists to answer "who did this".
     */
    anonymize?: boolean;
    /**
     * The proxies allowed to set `header`, as addresses or ranges. Naming
     * a header without this fails the boot
     * (`HENRI_CALLS_ADDRESS_UNVERIFIABLE`).
     */
    from?: string[];
    /**
     * A header express will not read on its own (`"cf-connecting-ip"`),
     * believed only when the peer is one of `from`. henri names none.
     */
    header?: string;
  }

  interface CallsConfig {
    /**
     * The client address: `{ anonymize, header, from }`, or `false` to
     * record none. `X-Forwarded-For` is `trustProxy`'s business, and a
     * blanket `trustProxy: true` records no client address at all.
     */
    address?: false | CallsAddressConfig;
    /**
     * The outcomes sampling never drops (`["error"]`). They are recorded
     * without their bodies: the decision not to capture one was made before
     * the status was known.
     */
    always?: Array<'aborted' | 'client-error' | 'error'>;
    /** How many buffered rows trigger a flush before the timer does (`500`). */
    batch?: number;
    /** `false` keeps the timings and the headers and captures no body. */
    bodies?: boolean;
    /**
     * How many rows may wait to be written (`1000`). Past it a row is
     * dropped and counted rather than queued forever.
     */
    buffer?: number;
    /** How often the buffer is written, in milliseconds (`1000`). */
    flush?: number;
    /**
     * Path prefixes that are never recorded. The health probes never are,
     * whatever this says.
     */
    ignore?: string[];
    /** `false` stops henri mounting the middleware at all. */
    inbound?: boolean;
    /**
     * How long a row is kept (`"30d"`); `false` keeps them forever. The
     * retention sweep is what prunes them.
     */
    keep?: string | number | false;
    /**
     * How much of a body is stored before it is cut and marked truncated
     * (`"8kb"`).
     */
    maxBody?: string | number | false;
    /**
     * The absolute per-process ceiling on rows a second (`100`), or `false`
     * for none. Sampling is proportional and a burst is not.
     */
    maxPerSecond?: number | false;
    /** `false` makes `track()` and `outbound()` no-ops. */
    outbound?: boolean;
    /**
     * Range partitions by `at`, on PostgreSQL and MySQL only: the sweep
     * then drops a partition instead of deleting rows. Anything else fails
     * the boot with `HENRI_CALLS_PARTITION_UNSUPPORTED`.
     */
    partition?: 'day' | 'month' | false;
    /** How many periods are kept ready in front of the clock (`7`). */
    partitionsAhead?: number;
    /**
     * The share of requests recorded (`1`), decided by a hash of the
     * request id seeded with `config.secret` so the inbound call and every
     * outbound call it caused agree.
     */
    sample?: number;
    /** Which of `config.stores` the table lives in (`"default"`). */
    store?: string;
    /** How many rows one pass of the delete path takes at a time (`5000`). */
    sweep?: number;
    /** The table henri creates and writes to (`"henri_calls"`). */
    table?: string;
  }

  /**
   * `config.uploads`: what `@usehenri/uploads` accepts. Every bound is
   * enforced by the parser as it reads, and `false` on one of them removes
   * it (which `henri audit` reports).
   */
  interface UploadsConfig {
    /**
     * Media types that may be kept (`"image/png"`, `"image/*"`), matched
     * against what the bytes say rather than what the client claimed.
     * Without it, every type is accepted.
     */
    allow?: string[];
    /** Longest field name, in bytes (`100`). */
    maxFieldNameSize?: number;
    /** Largest non-file part; defaults to `config.bodyLimit`. */
    maxFieldSize?: string | number | false;
    /** How many non-file fields one request may carry (`100`). */
    maxFields?: number | false;
    /** Largest single file (`"10mb"`). */
    maxFileSize?: string | number | false;
    /** How much of the original name is kept as metadata (`255`). */
    maxFilenameLength?: number;
    /** How many files one request may carry (`10`). */
    maxFiles?: number | false;
    /** Largest multipart body, all parts together (`"25mb"`). */
    maxTotalSize?: string | number | false;
    /** Path prefixes a multipart body is read under; all of them without it. */
    paths?: string[];
    /** Where the local storage keeps files (`"storage/uploads"`). */
    root?: string;
    /** Decide the type from the bytes (`true`). */
    sniff?: boolean;
    /**
     * The backend files are kept in: `"local"` for the disk, `"s3"` for an
     * object store (`@usehenri/s3`), the module id of a `HenriStorage`, or
     * an object naming one and carrying its settings.
     */
    storage?: string | UploadStorageConfig;
    /**
     * Signed urls: a time-limited link that hands a file to whoever holds
     * it, with no session and no policy. `false` (the default) hands out
     * none, and `henri.uploads.url()` refuses.
     */
    urls?: false | UploadUrlsConfig;
    /**
     * Derived images, by name: `henri.uploads.variant(record, "thumb")`.
     * Each one is produced once, on demand, and needs `sharp` in the
     * application -- henri ships no image library.
     */
    variants?: Record<string, UploadVariantConfig>;
  }

  /**
   * `config.uploads.urls`: what a signed url covers and how long it lasts.
   * On an object store it is the provider's own signature; on the local
   * disk it is henri's, verified by a route mounted at `path`.
   */
  interface UploadUrlsConfig {
    /**
     * A base url henri's own signed urls are built against. The host is
     * outside henri's signature, so a cache may sit in front of the route;
     * a storage that signs its own urls names its public host in its own
     * block instead, because a provider's signature covers the host.
     */
    cdn?: string;
    /** How long a url lasts, in seconds (`300`); a week at most. */
    expiresIn?: number;
    /**
     * Where the route that verifies henri's own signed urls is mounted
     * (`"/_uploads"`). Unused by a storage that signs its own.
     */
    path?: string;
  }

  /**
   * `config.uploads.storage` in its object form: `adapter` names the
   * backend and every other key is the backend's own -- a bucket, a region,
   * an endpoint -- which henri passes along without reading.
   */
  interface UploadStorageConfig {
    /** `"local"`, `"s3"`, or the module id of a `HenriStorage`. */
    adapter: string;
    [key: string]: unknown;
  }

  /**
   * One entry of `config.uploads.variants`: what a derived image looks
   * like. A width, a height, or both.
   */
  interface UploadVariantConfig {
    /** How the resize fills its box (`"cover"`). */
    fit?: 'contain' | 'cover' | 'fill' | 'inside' | 'outside';
    /** What it is written as (`"webp"`). */
    format?: 'avif' | 'jpeg' | 'png' | 'webp';
    /** Pixels, 1 to 8192. */
    height?: number;
    /** 1 to 100 (`80`). */
    quality?: number;
    /** Pixels, 1 to 8192. */
    width?: number;
  }

  /** What `variant()` resolves with: a derived file, with a key of its own. */
  interface VariantFile {
    key: string;
    /** The original name of the file it was derived from. */
    name: string | null;
    /** The key of the file it was derived from. */
    of: string;
    size: number;
    storage: string;
    type: string;
    uploadedAt: string;
  }

  /**
   * One file that arrived, as `req.files` holds it. It is temporary until
   * `store()` is called; everything else is removed when the response
   * closes. With `@usehenri/uploads`.
   */
  interface UploadedFile {
    /** The form field it arrived in. */
    field: string;
    /** The original name, cleaned; never used to build a path. */
    name: string;
    /** What the client said it was, kept for the record only. */
    declaredType: string | null;
    /** What the bytes say it is. */
    type: string;
    /** Whether henri recognized those bytes. */
    sniffed: boolean;
    /** Whether the declared type and the real one disagree. */
    readonly mistyped: boolean;
    size: number;
    /** sha256 of the content, hex. */
    checksum: string;
    /** Keeps the file and answers the record to write to a model. */
    store(options?: {
      prefix?: string;
      storage?: unknown;
    }): Promise<StoredFile>;
    /** Removes it now rather than at the end of the request. */
    discard(): Promise<boolean>;
    toJSON(): Record<string, unknown>;
  }

  /** What `store()` resolves with: the record a model holds. */
  interface StoredFile {
    key: string;
    name: string;
    type: string;
    size: number;
    checksum: string;
    storage: string;
    uploadedAt: string;
  }

  /** `config.logs`: what a line `henri.pen` writes looks like. */
  interface LogsConfig {
    /**
     * `"auto"` (the default) writes json in production and the pretty,
     * aligned, coloured lines everywhere else; `"json"` and `"pretty"` say
     * it outright. A json line carries the time, the level, the module, the
     * request id, the message, the object arguments (masked the way
     * `filterParameters` and the `personal` marks say) and the error.
     */
    format?: 'auto' | 'json' | 'pretty';
  }

  /** The boundaries henri knows how to put a span around. */
  type TelemetryBoundary =
    'boot' | 'http' | 'jobs' | 'mail' | 'stores' | 'views' | 'webhooks';

  /**
   * `config.telemetry`: what henri instruments, when `@opentelemetry/api`
   * is there. henri ships no SDK, no exporter and no sampler; those are the
   * application's own. See [Telemetry](https://usehenri.io/guides/telemetry/).
   */
  interface TelemetryConfig {
    /**
     * Leave it out and telemetry is on when `@opentelemetry/api` resolves
     * from the application and off when it does not, which is what makes
     * installing the package the whole opt-in. `true` says the application
     * requires it, and a boot without the package then fails with
     * `HENRI_TELEMETRY_UNAVAILABLE` instead of going quiet.
     */
    enabled?: boolean;
    /**
     * Register the instruments (`true`): the request duration, the queue
     * depth and the cache counters.
     */
    metrics?: boolean;
    /**
     * Write `traceparent` onto the requests henri makes for the application
     * -- a webhook delivery (`true`). An incoming one is always honoured.
     */
    propagate?: boolean;
    /**
     * Which boundaries get a span: `"all"` (the default), `false` for none,
     * or the list.
     */
    spans?: 'all' | false | TelemetryBoundary[];
  }

  /** What `henri.telemetry.span()` takes beside the function. */
  interface SpanOptions {
    /** Attributes, masked the way a log line's fields are. */
    attributes?: Record<string, unknown>;
    /**
     * Which of henri's own boundaries this span belongs to, so
     * `telemetry.spans` can turn it off. An application's span names none.
     */
    boundary?: TelemetryBoundary;
    /** The span kind (`internal`). */
    kind?: 'client' | 'consumer' | 'internal' | 'producer' | 'server';
  }

  /** What `henri.telemetry.histogram()` answers. */
  interface TelemetryHistogram {
    /** Record one measurement; does nothing when the metrics are off. */
    record(value: number, attributes?: Record<string, unknown>): void;
  }

  /** `config.errors`: what henri does with the code of a failure. */
  interface ErrorsConfig {
    /**
     * Where a code is explained, as a template holding `{code}`
     * (`"https://example.com/e/{code}"`). Unset by default: nothing prints a
     * link. See [Error codes](https://usehenri.io/reference/errors/).
     */
    url?: string;
  }

  /** `config.shutdown`: what a SIGTERM does before the modules stop. */
  interface ShutdownConfig {
    /**
     * Milliseconds between readiness turning 503 and the port closing (`0`).
     * A proxy that only polls `/readyz` wants a couple of its intervals.
     */
    delay?: number;
    /**
     * Milliseconds the requests in flight get once the port is closed
     * (`10000`); what is still open then has its socket destroyed.
     */
    drain?: number;
    /**
     * Install the `SIGINT` and `SIGTERM` handlers (`true`). `false` leaves
     * the signals to the application, which then calls
     * `henri.server.shutdown('SIGTERM')` itself.
     */
    signals?: boolean;
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
    /**
     * Guard the route with a policy from `app/policies`: `true` names it
     * after the controller (`proposals` -> `proposal`), a string names
     * another one. Composes with `roles` rather than replacing it.
     */
    policy?: boolean | string;
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
    /**
     * The Content Security Policy nonce of this response, the same value as
     * `res.locals.cspNonce`. Present only with `config.csp.nonce` on: a key
     * that is always there and usually null is what makes a page stamp a
     * nonce nothing enforces.
     */
    nonce?: string;
  }

  /** The second argument of `res.render()` and `res.hbs()`. */
  /**
   * Options of `res.render()`: `data` or `graphql`, never both -- the query
   * answers the page and the data would be thrown away, so the call is
   * refused (`HENRI_ARGUMENT_INVALID`).
   */
  type RenderOptions =
    | {
        /** What the page receives as `data`. */
        data?: Record<string, unknown>;
        graphql?: never;
        /**
         * The fields marked `personal: { expose: false }` this page may
         * carry. They are dropped from every answer henri builds; naming
         * one here is how the person's own page gets it back.
         */
        include?: string[];
      }
    | {
        data?: never;
        /** A GraphQL query run for the page; its result becomes `data`. */
        graphql: string | Record<string, string>;
        include?: string[];
      };

  /** Options of `res.resource()`. */
  interface ResourceOptions {
    /** Controller name; defaults to the one of the current route. */
    type?: string;
    /** Extra links, as `{ rel: href }` or as HAL links. */
    links?: Record<string, string | { href: string; method?: string }>;
    /** `201` also sets `Location`. */
    status?: number;
    /**
     * What the policies are asked about, when the answer is a presentation
     * of the record rather than the record: a presenter that drops the
     * owner column leaves the rules nothing to read.
     */
    subject?: unknown;
    /**
     * The fields marked `personal: { expose: false }` this answer may
     * carry. They are dropped from everything henri serializes; naming one
     * here is the only way back.
     */
    include?: string[];
  }

  /** Options of `res.collection()`. */
  interface CollectionOptions extends ResourceOptions {
    page?: number;
    perPage?: number;
    /** Total number of records; without it there is no `last` link. */
    total?: number;
    /**
     * The records the policies are asked about: an array parallel to the
     * one being sent, or `(item, index) => record`.
     */
    subject?: unknown[] | ((item: unknown, index: number) => unknown);
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
    /** 413 */
    payloadTooLarge(message?: string, data?: unknown): ExpressResponse;
    /** 415 */
    unsupportedMediaType(message?: string, data?: unknown): ExpressResponse;
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
     * (later sources win); missing fields are omitted. With no field at all:
     * everything the action declared it accepts (`params` in the controller),
     * already checked and coerced -- and `{}` when it declared nothing.
     */
    permit(...fields: Array<string | string[]>): Record<string, unknown>;
    /**
     * May the signed-in user take this action on this record? The policy
     * comes from the record, or from the route when the record cannot say.
     */
    can(
      action: string,
      record?: any,
      options?: string | { policy?: string; type?: string }
    ): Promise<boolean>;
    /**
     * The same, refusing when the answer is no: it rejects with an error
     * carrying `config.policies.status` (404 by default), which henri
     * answers as the negotiated page or the boom body. Resolves with the
     * record, so it reads as one line.
     */
    authorize<T>(
      action: string,
      record?: T,
      options?: string | { policy?: string; type?: string; status?: number }
    ): Promise<T>;
    /**
     * What a list of records should be filtered by, from the policy's
     * `scope`. The name defaults to what the route is about.
     */
    scope(name?: string, context?: object): Promise<any>;
    /**
     * The files of a multipart body, by field. Always present, empty when
     * nothing was uploaded. With `@usehenri/uploads`.
     */
    files?: Record<string, UploadedFile[]>;
    /** The first file of a field, or null. With `@usehenri/uploads`. */
    file?(field: string): UploadedFile | null;
    /**
     * `permit()` for files: only the listed fields come back, and the files
     * of every other one are removed from the disk on the spot. With
     * `@usehenri/uploads`.
     */
    permitFiles?(
      ...fields: Array<string | string[]>
    ): Record<string, UploadedFile[]>;
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
     *
     * One of the two is required: with neither, express answers `406` and
     * blames the client's `Accept` header for a mistake in the controller,
     * so henri refuses the call instead (`HENRI_ARGUMENT_INVALID`).
     */
    negotiate(
      handlers:
        | { html: () => unknown; json?: () => unknown }
        | { html?: () => unknown; json: () => unknown }
    ): ExpressResponse;
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

  /** The types a parameter rule may declare: the model types, plus lists. */
  type ParamType = FieldType | 'array';

  /**
   * One field an action accepts. A textual source (the query string, a path
   * parameter, a form body) is parsed into the type; a JSON body is checked
   * against it and never parsed.
   */
  interface ParamRule {
    type: ParamType;
    /** The field has to be there. */
    required?: boolean;
    /** What an absent field is worth; a function is called per request. */
    default?: unknown | (() => unknown);
    /** The values accepted, checked after the coercion. */
    enum?: unknown[];
    /** The bounds of a number. */
    min?: number;
    max?: number;
    /** The bounds of a length: characters of a string, items of a list. */
    minLength?: number;
    maxLength?: number;
    /** A regular expression a string has to match. */
    pattern?: RegExp;
    /** The rule every item of a list follows. A list declares it. */
    of?: ParamRule | ParamType;
  }

  /**
   * The `params` block: what each action accepts, keyed by action the way
   * `before` is (`all`, `'index,search'`), one rule per field. A rule may be
   * the type itself (`year: 'integer'`).
   */
  type ParamsBlock = Record<string, Record<string, ParamRule | ParamType>>;

  /**
   * A controller file. Every exported function is an action (`tasks#index`);
   * `before` and `params` are the reserved keys.
   *
   *     /** @type {import('@usehenri/core').Controller} *\/
   *     module.exports = {
   *       before: { 'show,edit': loadTask },
   *       params: { create: { title: { type: 'string', required: true } } },
   *       index: async (req, res) => ({ tasks: await Task.find() }),
   *     };
   */
  interface Controller {
    before?: BeforeBlock;
    params?: ParamsBlock;
    [action: string]: Action | BeforeBlock | ParamsBlock | undefined;
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
    /**
     * This field is about a person: masked in the logs, included in the
     * export, erased by an erasure. `{ expose: false }` also keeps it out
     * of every answer henri builds.
     */
    personal?: boolean | PersonalMark;
    /**
     * The column holds ciphertext and the model the string. `true` is the
     * randomised scheme (different bytes every time, and nothing may query
     * it); `{ deterministic: true }` keeps an equality and a `unique`, and
     * gives away which rows hold the same value.
     *
     * Only `string` and `text` may be encrypted, a randomised field may
     * not be `unique` or `index`, and the field may not carry a
     * `default` -- each of those is a boot failure rather than a warning.
     */
    encrypted?: boolean | EncryptedMark;
    [key: string]: unknown;
  }

  /** The object form of `encrypted`, when `true` is not enough. */
  interface EncryptedMark {
    /**
     * Derive the initialization vector from the plaintext, so the same
     * value is the same ciphertext in this field and an equality still
     * matches (`false`).
     */
    deterministic?: boolean;
  }

  /** The object form of `personal`, when `true` is not enough. */
  interface PersonalMark {
    /**
     * May it leave the server in an answer henri builds
     * (`config.privacy.expose`, itself `true`)?
     */
    expose?: boolean;
    /** Does it belong in the export of a person's data (`true`)? */
    export?: boolean;
    /**
     * What an erasure writes over it: `clear` where the column can hold
     * null, `anonymize` where it cannot.
     */
    erase?: 'anonymize' | 'clear' | 'retain';
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
    /** What this model is to a person, for the export and the erasure. */
    personal?: {
      /**
       * The field pointing at the person. henri infers it from
       * `references`, `ref` and the belongsTo associations; `false` says
       * these records are about nobody in particular.
       */
      subject?: string | false | { field: string; matches?: string };
      /** What happens to these records when that person is erased. */
      onErase?: 'anonymize' | 'delete' | 'orphan' | 'retain';
      /** Whether they belong in the export (`true`). */
      export?: boolean;
    };
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
    /**
     * GraphQL, when the application has `@usehenri/graphql`.
     *
     * `true` derives the type, the queries and the resolvers from the
     * schema above (`henri graphql` prints what that is); an object writes
     * them by hand, or asks for the derived definition with `generate` and
     * adds to it. Mutations are never derived unless `mutations` asks.
     */
    graphql?: true | GraphqlModelDefinition;
    /** Called once every model exists, with the models by global id. */
    associate?(models: Record<string, unknown>): void;
  }

  /** The `graphql` key of a model, in its object form. */
  interface GraphqlModelDefinition {
    /** Derive the type, the queries and the resolvers from the schema. */
    generate?: boolean;
    /** The GraphQL type name; defaults to the model's global id. */
    name?: string;
    /** `<model>(id:)` and `<models>(page, perPage, where)`; on by default. */
    queries?: boolean;
    /** The `where` argument of the list query; on by default. */
    filters?: boolean;
    /** Off by default: `true`, or any of `create`, `update`, `destroy`. */
    mutations?: boolean | Array<'create' | 'update' | 'destroy'>;
    /** Fields henri never generates, whatever the schema says. */
    except?: string | string[];
    /** SDL of the model's own, merged with anything derived. */
    types?: string;
    /** Resolvers of the model's own; they win over the derived ones. */
    resolvers?: Record<string, unknown>;
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
    /**
     * What the store can state about its foreign keys, and which models
     * carry a public identifier. Read once, when the stores have started,
     * by core's exit gate; nothing is guessed from a field name.
     */
    references?(): Record<
      string,
      {
        externalId: boolean;
        references: Record<string, { as: string | null; target: string }>;
      }
    >;
    /**
     * The `externalId` of the rows a set of primary keys names, keyed by
     * the key as a string. One statement for the whole set.
     */
    externalIdsOf?(
      modelName: string,
      keys: unknown[]
    ): Promise<Map<string, string>>;
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
     *
     * `code` is one of henri's error codes: it is printed before the summary
     * and stamped on the Error that comes back. See
     * [Error codes](https://usehenri.io/reference/errors/).
     */
    fatal(
      name?: string,
      summary?: string | Error,
      full?: string | null,
      obj?: object | null,
      code?: string | null
    ): Error;
    /** Prints blank lines. */
    line(times?: number): void;
    /** A desktop notification, in development. */
    notify(title?: string | null, message?: string | null): void;
  }

  /**
   * What `henri.reporter` hands the handler: the error itself, its stable
   * code, the request id and enough of the request to act on. Nothing that
   * came from the client and nothing about a person: no url, no query, no
   * body, no params, no headers and no user.
   */
  interface ErrorReport {
    /** When it was reported. */
    at: Date;
    /** The henri error code of the failure, `null` when it carries none. */
    code: string | null;
    /** The error itself, untouched: a reporter is there for the stack. */
    error: Error;
    /** What `report()` was called with, masked like a log line. */
    meta?: Record<string, unknown>;
    /**
     * The method, the route pattern (`/artworks/:id`) and the status henri
     * answered with. `null` outside a request, and every member is `null`
     * when henri does not know it.
     */
    request: {
      method: string | null;
      route: string | null;
      status: number | null;
    } | null;
    /** `X-Request-Id`, `null` outside a request. */
    requestId: string | null;
    /** Where henri caught it. */
    source: 'application' | 'boot' | 'rejection' | 'request';
  }

  /**
   * `henri.reporter`: the one place an application hears about every
   * failure henri catches -- the boot, a 5xx and an unhandled rejection.
   * A handler that throws or hangs never takes the request or the boot with
   * it, and no handler at all costs nothing.
   */
  interface Reporter {
    /** Is a handler registered? */
    readonly enabled: boolean;
    /**
     * Register the handler, replacing any previous one; `null` removes it.
     * Follows `henri.mailers.onDeliverLater()`.
     */
    onError(handler: ((report: ErrorReport) => unknown) | null): boolean;
    /**
     * Report a failure of the application's own. Never throws and never
     * rejects; resolves with whether a handler was given it.
     */
    report(
      error: unknown,
      options?: {
        meta?: Record<string, unknown>;
        req?: Request | ExpressRequest;
        source?: 'application' | 'boot' | 'rejection' | 'request';
        status?: number;
      }
    ): Promise<boolean>;
  }

  /**
   * `henri.telemetry`: the OpenTelemetry spans and metrics henri emits,
   * when the application has `@opentelemetry/api`. henri ships no SDK and
   * no exporter, and an application that has neither pays nothing: the
   * instrumentation is never installed rather than tested per call.
   *
   * A span carries the method, the route pattern, the status and the
   * request id, and nothing that came from the client -- no url, no query,
   * no body, no headers, no user. See
   * [Telemetry](https://usehenri.io/guides/telemetry/).
   */
  interface TelemetryModule {
    name: 'telemetry';
    /** Is a tracer or a meter there? */
    readonly enabled: boolean;
    /** The boundaries this application instruments. */
    readonly spans: TelemetryBoundary[];
    /** Is this boundary instrumented? */
    on(boundary: TelemetryBoundary | string): boolean;
    /**
     * Run something inside a span. Without a tracer it calls the function
     * and does nothing else. The span ends when the function returns or
     * when the promise it answered settles; a failure is recorded and
     * rethrown untouched.
     */
    span<T>(name: string, fn: () => T): T;
    span<T>(name: string, options: SpanOptions, fn: () => T): T;
    /**
     * Write the current trace context (`traceparent`, `tracestate`) into an
     * outgoing header bag. Writes nothing when telemetry is off, when
     * `telemetry.propagate` is false, or when no span is active.
     */
    inject<T extends Record<string, unknown>>(carrier: T): T;
    /**
     * A histogram. Always answers a recorder, so a call site never
     * branches: with the metrics off, `record()` does nothing.
     */
    histogram(
      name: string,
      options?: { description?: string; unit?: string }
    ): TelemetryHistogram;
    /**
     * Register a callback the metrics pipeline asks for a value. Nothing is
     * recorded while a request runs: the callback is only called when
     * something is collecting.
     */
    observe(
      name: string,
      options: {
        description?: string;
        kind?: 'counter' | 'gauge';
        unit?: string;
      },
      callback: (
        observe: (value: number, attributes?: Record<string, unknown>) => void
      ) => void
    ): boolean;
    /**
     * The boot as spans, out of what `henri.analyze()` already measured.
     * `henri.init()` is the one caller.
     */
    boot(analysis: unknown, error?: unknown): boolean;
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
     * the policy. `identity` is the record the hash belongs to (an
     * `externalId`, a row or an instance): with it, and
     * `config.user.password.binding.enabled`, the hash is bound to that
     * record and stops verifying anywhere else. A number is the deprecated
     * `rounds` argument: it overrides `config.user.password.bcryptRounds` and
     * is ignored under argon2id. A misspelled key is refused rather than
     * ignored, because ignoring it wrote an unbound hash and said nothing.
     */
    encrypt(
      password: string,
      options?: number | { identity?: string | object | null; rounds?: number }
    ): Promise<string>;
    /**
     * Resolves `true`; rejects with an error on a mismatch, never `false`.
     * Pass the user rather than its hash: a bound hash cannot be checked
     * without the record it belongs to and rejects with a distinct error.
     *
     * Three failures, told apart by their code and by nothing else — the
     * message a mismatch carries is the one word it always was.
     * `HENRI_USER_PASSWORD_MISMATCH` is a wrong password *and* no account at
     * all (`null`), which cost the same; `HENRI_USER_PASSWORD_UNVERIFIABLE`
     * is a record carrying no hash to check, which `findById()` and
     * `req.user` are; `HENRI_ARGUMENT_INVALID` is a second argument that is
     * not a user.
     */
    compare(password: unknown, user?: string | object | null): Promise<true>;
    /**
     * Writes a stored hash again with the current parameters, after its
     * owner proved the password. Applies no policy and never throws. This is
     * where an unbound hash becomes bound to its row.
     */
    rehash(user: unknown, password: string): Promise<boolean>;
    /**
     * The `externalId` a hash written for this record is bound to, or `null`
     * for a user model that opted out of the public identifier.
     */
    identityOf(user: unknown): string | null;
    /**
     * Will a hash written now be bound to its record? False when binding is
     * off or the user model carries no `externalId`.
     */
    bindsPasswords(): boolean;
    findByEmail(email: string): Promise<any>;
    findById(id: string): Promise<any>;
    /**
     * `{ id, email, roles }` plus `config.user.public`. Nobody answers
     * `null`; anything that is not a record is refused, because the object
     * it built goes to a view and to a JSON body.
     */
    publicUser(user?: object | null): PublicUser | null;
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
    /** What an action declared it accepts, compiled; null when nothing is. */
    accepts(key: string): Record<string, ParamRule> | null;
    /** The parameter check of an action, as middlewares (none, or one). */
    checks(key: string): Array<(...args: any[]) => unknown>;
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
    /** True from the first moment of a shutdown: `/readyz` answers 503. */
    draining: boolean;
    /**
     * Closes the listener and lets the requests in flight finish, within
     * `shutdown.drain`. Called by `shutdown()`, before the modules stop.
     */
    drain(): Promise<{ drained: boolean; forced: boolean; open: number }>;
    /**
     * Drains, stops henri and exits. The `SIGINT` and `SIGTERM` handler,
     * and what an application calls when it installs its own.
     */
    shutdown(signal: string): Promise<void>;
  }

  /**
   * The context a policy rule receives as its third argument: what is being
   * asked, of which policy, and the request when there is one.
   */
  interface PolicyContext {
    action: string;
    policy: string;
    user: any;
    req: Request | null;
    henri: Henri;
  }

  /**
   * One rule of a policy.
   *
   * Only the boolean `true` allows: anything else -- a truthy string, a
   * record, `undefined`, an exception -- is a no. A rule that declares the
   * record parameter is never asked without a record, which is what tells
   * `index`, `new` and `create` apart from `show`, `edit`, `update` and
   * `destroy`.
   */
  type PolicyRule<TUser = any, TRecord = any> = (
    user: TUser | null,
    record: TRecord | null,
    context: PolicyContext
  ) => boolean | Promise<boolean>;

  /**
   * A policy's `before`: a boolean is the answer of the whole policy,
   * anything else falls through to the rule of the action.
   */
  type PolicyBefore<TUser = any, TRecord = any> = (
    user: TUser | null,
    record: TRecord | null,
    context: PolicyContext
  ) => boolean | undefined | Promise<boolean | undefined>;

  /** A policy's `scope`: what a list of these records is filtered by. */
  type PolicyScope<TUser = any> = (
    user: TUser | null,
    context: PolicyContext
  ) => unknown;

  /**
   * `app/policies/<model>.js`: who may do what to one record.
   *
   * Every exported function is the rule of the action of the same name;
   * `before` runs first and short-circuits the policy when it answers a
   * boolean, and `scope` says what a list of these records should be
   * filtered by (henri hands the value back untouched).
   */
  interface Policy<TUser = any, TRecord = any> {
    /** The seven actions of a resource, and the shape of every other one. */
    index?: PolicyRule<TUser, TRecord>;
    new?: PolicyRule<TUser, TRecord>;
    create?: PolicyRule<TUser, TRecord>;
    show?: PolicyRule<TUser, TRecord>;
    edit?: PolicyRule<TUser, TRecord>;
    update?: PolicyRule<TUser, TRecord>;
    destroy?: PolicyRule<TUser, TRecord>;
    /**
     * Runs before every rule. A boolean is the answer and the rules are
     * never reached; anything else falls through to them.
     */
    before?: PolicyBefore<TUser, TRecord>;
    /**
     * What a list of these records should be filtered by. henri hands the
     * value back untouched: it is a `where` for the ORM the application
     * chose, never something henri builds a query from.
     */
    scope?: PolicyScope<TUser>;
    /** Any other action of the controller (`submit`, `archive`, ...). */
    [action: string]:
      | PolicyRule<TUser, TRecord>
      | PolicyBefore<TUser, TRecord>
      | PolicyScope<TUser>
      | undefined;
  }

  /**
   * `henri.policies`: the loaded `app/policies`, and the one question
   * behind `henri.can()`, `req.can()` and `req.authorize()`.
   */
  interface PoliciesModule {
    name: 'policies';
    /** `config.policies`, normalized. */
    settings: { status: 403 | 404; verify: boolean };
    /** The names of the loaded policies. */
    names(): string[];
    size(): number;
    /** The policy a model, controller or policy name means, or `null`. */
    resolve(word: string): string | null;
    get(name: string): Policy | null;
    has(name: string): boolean;
    /** The rule a policy has for an action, or `null`. */
    rule(name: string, action: string): PolicyRule | null;
    can(
      user: any,
      action: string,
      record?: any,
      options?: string | { policy?: string; type?: string; req?: Request }
    ): Promise<boolean>;
    /** Resolves with the record, or rejects with a `POLICY_DENIED` error. */
    authorize<T>(
      user: any,
      action: string,
      record?: T,
      options?:
        | string
        | {
            policy?: string;
            type?: string;
            req?: Request;
            status?: number;
          }
    ): Promise<T>;
    /**
     * What a list of these records should be filtered by. Rejects when
     * there is no policy, or when it declares no `scope`: "everything they
     * may see" has no safe default.
     */
    scope(user: any, name: string, context?: object): Promise<any>;
    /** The links of `_links` the user may follow. */
    links(
      user: any,
      links: object,
      record: any,
      options?: { type?: string; req?: Request; cache?: Map<string, boolean> }
    ): Promise<object>;
    /** The path helpers a rule that needs no record leaves. */
    paths(user: any, paths: Paths, options?: { req?: Request }): Promise<Paths>;
  }

  /** The mark of one personal field, as henri read it back. */
  interface PersonalField {
    name: string;
    /** What an erasure writes over the value. */
    erase: 'anonymize' | 'clear' | 'retain';
    /** Whether it may leave the server in an answer henri builds. */
    expose: boolean;
    /** Whether it belongs in the export of a person's data. */
    export: boolean;
    required: boolean;
    unique: boolean;
    type: string;
  }

  /** How one model relates to the person, in the map. */
  interface PersonalModel {
    model: string;
    /** True for the model that is a person (the user model). */
    subject: boolean;
    fields: PersonalField[];
    /** The field pointing at the person, when henri can see one. */
    link: {
      field: string;
      matches: string;
      declared: boolean;
      required: boolean;
    } | null;
    onErase: 'anonymize' | 'delete' | 'orphan' | 'retain';
    exported: boolean;
    paranoid: boolean;
  }

  /** What `henri privacy:erase` leaves behind as proof that it ran. */
  interface ErasureReceipt {
    version: number;
    id: string;
    at: string;
    application: string | null;
    /** The algorithm of `subject.digest`. */
    digest: string;
    dryRun: boolean;
    subject: {
      model: string | null;
      externalId: string | null;
      /** HMAC of the identity that was erased, keyed with `config.secret`. */
      digest: string;
    };
    records: Array<{
      model: string;
      action: 'anonymize' | 'delete' | 'orphan' | 'retain';
      count: number;
      written: number;
      fields: string[];
      ids: Array<string | null>;
    }>;
    /** Models holding personal data that no link ties to the person. */
    unlinked: Array<{ model: string; fields: string[]; reason: string }>;
    /**
     * Encrypted fields the walk could not read before it wrote over them:
     * a key that is gone, or bytes that were changed. The erasure happened
     * either way, and this is what says so.
     */
    unreadable: UnreadableValue[];
    /** Where the receipt was written, relative to the application. */
    file?: string | null;
  }

  /** Everything the application holds about one person. */
  interface PersonalExport {
    version: number;
    generatedAt: string;
    application: string | null;
    subject: {
      model: string | null;
      externalId: string | null;
      email: string | null;
    };
    records: Record<string, Array<Record<string, unknown>>>;
    counts: Record<string, number>;
    unlinked: string[];
    /**
     * Encrypted fields that could not be read, and why. The export runs
     * inside `henri.encryption.tolerate()`, so a missing key costs a
     * `null` and a line here rather than the whole document.
     */
    unreadable: UnreadableValue[];
  }

  /** One encrypted value that would not open, and why. */
  interface UnreadableValue {
    /** `<Model>.<field>`. */
    context: string;
    /** The henri error code of the failure. */
    code: string | null;
    /** The key the envelope names, when it is one. */
    keyId: string | null;
  }

  /** What one encrypted column holds, counted without opening a value. */
  interface EncryptionFieldStatus {
    model: string;
    field: string;
    deterministic: boolean;
    /** Rows walked, soft-deleted ones included. */
    rows: number;
    /** How many are under the key that writes today. */
    current: number;
    /** How many are under another key, and must be rotated. */
    stale: number;
    /** How many are not encrypted at all. */
    plaintext: number;
    /** The count by key id, plus `plaintext`, `null` and `malformed`. */
    counts: Record<string, number>;
  }

  /**
   * `henri.encryption`: the keys that open the fields the models marked
   * `encrypted`, and the rotation that moves them.
   *
   * No member of this interface ever answers key material: a key is named
   * by its id, eight hexadecimal characters of a digest.
   */
  interface EncryptionModule {
    name: 'encryption';
    /** Is at least one key configured? */
    readonly enabled: boolean;
    /** The key ids, the one that writes first. */
    readonly keys: string[];
    /** The id of the key new values are written under. */
    readonly primary: string | null;
    /** May a column declared encrypted answer with what it holds? */
    readonly readPlaintext: boolean;
    /** The mark a model declared for a field, or `null`. */
    markOf(
      model: string,
      field: string
    ): { model: string; field: string; deterministic: boolean } | null;
    /** The map, as data: what `henri encryption` prints. */
    describe(): {
      enabled: boolean;
      readPlaintext: boolean;
      fields: Array<{ model: string; field: string; deterministic: boolean }>;
      keys: Array<{ id: string; primary: boolean; source: string }>;
    };
    /** Encrypts one value under the key that writes. */
    encrypt(
      value: string | null | undefined,
      options: { context: string; deterministic?: boolean }
    ): string | null | undefined;
    /** Decrypts one value, throwing when it will not open. */
    decrypt(
      value: string | null | undefined,
      options: { context: string; deterministic?: boolean }
    ): string | null | undefined;
    /**
     * Every envelope a deterministic value could be stored as, one per
     * configured key: what keeps a lookup working during a rotation.
     */
    candidates(value: string, options: { context: string }): string[];
    /** Does this value carry the envelope prefix? */
    isEnvelope(value: unknown): boolean;
    /** The key id a stored value names, or `null`. */
    keyIdIn(value: unknown): string | null;
    /**
     * Runs `work` with every unreadable value reading as `null`, and
     * answers what could not be read beside the result. The only way past
     * a decryption failure, and it is a call rather than a setting.
     */
    tolerate<T>(
      work: () => T | Promise<T>
    ): Promise<{ value: T; failures: UnreadableValue[] }>;
    /** What the encrypted columns hold, counted by key id. */
    status(): Promise<{
      ok: boolean;
      primary: string | null;
      keys: string[];
      total: number;
      stale: number;
      plaintext: number;
      fields: EncryptionFieldStatus[];
    }>;
    /**
     * Rewrites every value that is not under the key that writes, and
     * every value that is still in the clear. Never overwrites one it
     * could not read first.
     */
    rotate(options?: {
      dryRun?: boolean;
      model?: string;
      field?: string;
    }): Promise<{
      dryRun: boolean;
      scanned: number;
      rotated: number;
      fields: Array<{
        model: string;
        field: string;
        scanned: number;
        rotated: number;
        skipped: number;
      }>;
      failures: Array<
        UnreadableValue & { model: string; field: string; record: string }
      >;
    }>;
  }

  /** What an erasure does with the records that reference the person. */
  type ErasureStrategy = 'anonymize' | 'delete' | 'orphan' | 'retain';

  /**
   * `henri.privacy`: which fields of which models are about a person, and
   * the two operations that follow from the mark.
   */
  interface PrivacyModule {
    name: 'privacy';
    /** `config.privacy`, normalized. */
    settings: { expose: boolean; onErase: string; receipts: string | false };
    /** The global id of the model that is a person, or `null`. */
    subjectModel: string | null;
    /** Every personal field name, masked exactly in the logs. */
    keys: Set<string>;
    /** The names marked `expose: false`, dropped from every answer. */
    private: Set<string>;
    /** The personal fields of a model, by name. */
    fields(model: string): Record<string, Omit<PersonalField, 'name'>>;
    /** A copy of a payload without the fields marked `expose: false`. */
    strip<T>(value: T, include?: string[]): T;
    /** The map, as data: what `henri privacy` prints. */
    describe(): {
      subject: string | null;
      models: PersonalModel[];
      private: string[];
      settings: { expose: boolean; onErase: string; receipts: string | false };
    };
    /** The person, by email address, external id or primary key. */
    subject(who: string | object): Promise<Record<string, unknown>>;
    export(
      who: string | object,
      options?: { source?: 'app' | 'cli' | 'http' | 'job' }
    ): Promise<PersonalExport>;
    /** What an erasure would do, and what stands in its way. */
    plan(
      who: string | object,
      options?: { strategy?: ErasureStrategy }
    ): Promise<{
      steps: Array<Record<string, unknown>>;
      problems: Array<{ model: string; problem: string; message: string }>;
      unlinked: Array<{ model: string; fields: string[]; reason: string }>;
      /** Encrypted fields the walk could not read while planning. */
      unreadable: UnreadableValue[];
    }>;
    erase(
      who: string | object,
      options?: {
        strategy?: ErasureStrategy;
        dryRun?: boolean;
        source?: 'app' | 'cli' | 'http' | 'job';
      }
    ): Promise<ErasureReceipt>;
  }

  /** One retention rule of one model, as `henri retention` prints it. */
  interface RetentionRule {
    model: string;
    /** The name of the rule (`"default"` for a model's only one). */
    rule: string;
    action: 'anonymize' | 'delete' | 'soft-delete';
    /** How long the records are kept, in milliseconds. */
    after: number;
    /** The date column the clock starts on. */
    from: string;
    /** The condition picking the class of records this rule is about. */
    where: Record<string, unknown>;
    /** `Model:rule:<digest>`, what `config.retention.approved` holds. */
    token: string;
    approved: boolean;
  }

  /** What one rule did, or would do, in a sweep. */
  interface RetentionStep {
    model: string;
    rule: string;
    action: 'anonymize' | 'delete' | 'soft-delete';
    /** The moment a record has to be older than. */
    cutoff: string;
    /** How many records are past it. */
    matched: number;
    /** How many the batch allows this run. */
    would: number;
    /** How many were actually written. */
    written: number;
    /** What the next run will find. */
    remaining: number;
    /** Records whose `from` column is null: their clock never started. */
    waiting: number;
    /** The fields an `anonymize` writes over. */
    fields: string[];
    /** Up to twenty public identifiers, as a sample and never an index. */
    sample: string[];
    token: string;
    /** Why nothing was written: `"not approved"`, `"dry run"`, a problem. */
    skipped?: string | null;
    /** The message of the failure, when the rule threw. */
    failed?: string;
  }

  /** What a retention sweep leaves behind as proof that it ran. */
  interface RetentionReceipt {
    version: number;
    id: string;
    at: string;
    application: string | null;
    dryRun: boolean;
    /** True when a rule threw: the others still ran. */
    interrupted: boolean;
    /** How many rules wrote nothing because nobody approved them. */
    pending: number;
    rules: RetentionStep[];
    /** Where the receipt was written, relative to the application. */
    file?: string | null;
  }

  /**
   * `henri.retention`: how long each model keeps its records, and the sweep
   * that enforces it.
   */
  interface RetentionModule {
    name: 'retention';
    /** `config.retention`, normalized. */
    settings: {
      approve: boolean;
      approved: string[];
      batch: number | false;
      receipts: string | false;
      schedule: string | false;
    };
    /** Every rule of every model, each with its token. */
    rules: Array<Omit<RetentionRule, 'approved'>>;
    /** The rules and the settings, as data: what `henri retention` prints. */
    describe(): {
      rules: RetentionRule[];
      settings: RetentionModule['settings'];
    };
    /** What a sweep would do, without doing it. */
    plan(options?: { only?: string; now?: Date | string | number }): Promise<{
      at: string;
      pending: number;
      steps: Array<Record<string, unknown>>;
      problems: Array<{ model: string; problem: string; message: string }>;
    }>;
    /** Sweeps every rule, writes the receipt and records what happened. */
    sweep(options?: {
      only?: string;
      now?: Date | string | number;
      dryRun?: boolean;
      source?: 'app' | 'cli' | 'http' | 'job';
    }): Promise<RetentionReceipt>;
  }

  /** One entry of the access trail. */
  interface TrailEntry {
    id: string;
    /** One more than the entry before it, under a unique index. */
    seq: number;
    at: string;
    /** `privacy.export`, `retention.sweep`, `record.read`, `app.<yours>`. */
    action: string;
    outcome: 'ok' | 'refused' | 'failed';
    source: 'app' | 'cli' | 'http' | 'job';
    model: string | null;
    records: number;
    /** Field *names*, never values. */
    fields: string[];
    /** Public identifiers of the records the entry is about. */
    ids: string[];
    /** The `externalId` of whoever did it. */
    actor: string | null;
    actorDigest: string | null;
    /** The `externalId` of the person the data is about. */
    subject: string | null;
    /** HMAC of that person's address, keyed with `config.secret`. */
    subjectDigest: string | null;
    requestId: string | null;
    route: string | null;
    /** Names and counts that passed the guard; never a value. */
    meta: Record<string, string | number | boolean | null> | null;
    /** The hash of the entry before it. */
    prev: string | null;
    hash: string;
  }

  /**
   * `henri.trail`: the append-only record of who read or changed personal
   * data. Off unless `config.trail` says otherwise.
   */
  interface TrailModule {
    name: 'trail';
    /** `config.trail`, normalized. */
    settings: {
      enabled: boolean;
      keep: number | null;
      reads: 'all' | 'personal' | false;
      store: string;
      table: string;
    };
    /** Whether anything is being recorded. */
    enabled: boolean;
    /**
     * Appends one entry. A disabled trail answers `null` and does nothing;
     * a `meta` holding something personal is refused.
     */
    record(event: {
      action: string;
      model?: string;
      records?: number;
      fields?: string[];
      ids?: Array<string | null>;
      actor?: string | null;
      subject?: string | null;
      outcome?: 'ok' | 'refused' | 'failed';
      source?: 'app' | 'cli' | 'http' | 'job';
      route?: string | null;
      requestId?: string | null;
      meta?: Record<string, string | number | boolean | null>;
    }): Promise<TrailEntry | null>;
    /** The entries matching a filter, newest first. */
    list(filter?: {
      action?: string;
      model?: string;
      actor?: string;
      subject?: string;
      digest?: string;
      outcome?: string;
      since?: Date | string | number;
      until?: Date | string | number;
      limit?: number;
      offset?: number;
    }): Promise<TrailEntry[]>;
    count(filter?: Record<string, unknown>): Promise<number>;
    /** Everything recorded about one person. */
    about(
      who: string | object,
      filter?: Record<string, unknown>
    ): Promise<TrailEntry[]>;
    /** Walks the chain and says where, if anywhere, it parts company. */
    verify(): Promise<{
      ok: boolean;
      entries: number;
      from: number | null;
      to: number | null;
      broken: { seq: number; reason: string; after: number | null } | null;
    }>;
    /** Takes the entries past `config.trail.keep` away, and checkpoints. */
    prune(options?: { now?: number }): Promise<{
      removed: number;
      before: number | null;
      checkpoint: TrailEntry | null;
    }>;
  }

  /** One version: what one change made to one record. */
  interface Version {
    /** A uuid v7, so the id is also the order the versions were written. */
    id: string;
    /** When the change was made. */
    at: Date;
    /** The model the record belongs to. */
    model: string;
    /** The record's `externalId`, never its primary key. */
    record: string;
    event: 'create' | 'destroy' | 'update';
    /**
     * `{ field: [old, new] }`. A field whose value is `null` rather than a
     * pair changed and its values are not kept: `password`, or a name
     * `config.filterParameters` matches.
     */
    changes: Record<string, [unknown, unknown] | null>;
    /**
     * Every stored field of the record as the delete found it. Only a
     * `destroy` carries one: a diff cannot bring a row back.
     */
    snapshot: Record<string, unknown> | null;
    /** The `externalId` of whoever made the change, when it is known. */
    actor: string | null;
    source: 'console' | 'http' | 'job' | 'seed' | 'system' | 'task';
    /** The join with the call log and the logs. */
    requestId: string | null;
    meta: Record<string, unknown> | null;
    /** When an erasure emptied the values of this row. */
    erasedAt: Date | null;
  }

  /** What a version filter accepts. */
  interface VersionFilter {
    model?: string;
    record?: string;
    actor?: string;
    event?: 'create' | 'destroy' | 'update';
    requestId?: string;
    source?: string;
    since?: Date | string | number;
    until?: Date | string | number;
    limit?: number;
    offset?: number;
  }

  /** What `reify()` could reconstruct, and whether it is exact. */
  interface Reification {
    /** The record as it was, as plain attributes. */
    attributes: Record<string, unknown>;
    /** False when a field's values were not kept, or nothing to fold from. */
    complete: boolean;
    /** The fields whose values are missing from the reconstruction. */
    missing: string[];
    /** Whether the record still exists. */
    existed: boolean;
    version: Version;
  }

  /**
   * `henri.versions`: the history of the models that say
   * `options: { versioned: true }`.
   *
   * Not the access trail. The trail records field *names* and refuses a
   * value; this exists to hold the values, which is what makes `reify()`
   * possible and what makes `henri privacy:erase` reach in here.
   */
  interface VersionsModule {
    /** Whether any model of this application keeps versions. */
    enabled: boolean;
    /** `config.versions`, normalized. */
    settings: {
      keep: number | null;
      onErase: 'delete' | 'follow' | 'retain';
      store: string;
      table: string;
    };
    /** Does this model keep versions? */
    watches(model: string): boolean;
    /**
     * Writes one version. The adapters call it from the model hooks; an
     * application rarely does.
     */
    record(event: {
      model: string;
      record: string;
      event: 'create' | 'destroy' | 'update';
      before?: Record<string, unknown> | null;
      after?: Record<string, unknown> | null;
      meta?: Record<string, unknown> | null;
    }): Promise<Version | null>;
    /** The versions of one record, newest first. */
    of(
      record: object | { model: string; record: string },
      filter?: VersionFilter
    ): Promise<Version[]>;
    /** The versions matching a filter, newest first. */
    list(filter?: VersionFilter): Promise<Version[]>;
    count(filter?: VersionFilter): Promise<number>;
    get(id: string): Promise<Version | null>;
    /**
     * The record as it was immediately after that version, without
     * touching it. A read: it may be partial, and says so.
     */
    reify(version: string | Version): Promise<Reification>;
    /**
     * Writes a reified record back: an update on one that still exists, an
     * insert under the same `externalId` on one that was destroyed. A
     * write: it refuses an inexact reconstruction unless `force`.
     */
    restore(
      version: string | Version,
      options?: { force?: boolean }
    ): Promise<{
      record: unknown;
      created: boolean;
      missing: string[];
      version: Version;
    }>;
    /**
     * Runs something with the actor and the source it names, for a job, a
     * console session or a seed. An async context, not a setting.
     */
    acting<T>(
      who: {
        actor?: string | object | null;
        source?: 'console' | 'http' | 'job' | 'seed' | 'system' | 'task';
      },
      work: () => T
    ): T;
    /** Takes the versions past `config.versions.keep` away. */
    prune(options?: { now?: number; batch?: number }): Promise<{
      removed: number;
      before: number | null;
    }>;
  }

  /** One call of the call log, inbound or outbound. */
  interface CallRecord {
    id: string;
    /** When the call started, as an ISO-8601 string. */
    at: string;
    /** `"in"` for a call answered, `"out"` for a call made. */
    direction: 'in' | 'out';
    /** The join: the inbound call and its outbound calls share it. */
    requestId: string | null;
    /** Which service an outbound call went to; `null` inbound. */
    service: string | null;
    method: string;
    /** The url, without its userinfo and with the filtered query masked. */
    url: string | null;
    /** The route pattern of an inbound call. */
    route: string | null;
    status: number | null;
    /** How long it took, in milliseconds. */
    duration: number | null;
    /** The `externalId` of the person, never an address. */
    actor: string | null;
    /**
     * Who made the call, for an inbound one. `client` is `null` when the
     * configuration could not support an answer and `source` says so.
     */
    address: {
      client: string | null;
      peer: string | null;
      source: 'header' | 'proxy' | 'socket' | 'unverified' | null;
    };
    outcome: 'aborted' | 'failed' | 'ok';
    error: string | null;
    request: { headers: Record<string, string> | null; body: unknown };
    response: { headers: Record<string, string> | null; body: unknown };
    /** Which bodies were cut: `["request"]`, `["response"]`, both, none. */
    truncated: string[];
    meta: Record<string, unknown> | string | null;
  }

  /**
   * `henri.calls`: the calls the application answered and the calls it
   * made, joined by the request id. Off unless `config.calls` says
   * otherwise.
   *
   * It holds values, so everything it stores goes through the redactor,
   * and the credentials of an exchange are masked whatever
   * `filterParameters` says. It is not the access trail and does not
   * replace it.
   */
  interface CallsModule {
    name: 'calls';
    /** `config.calls`, normalized. */
    settings: {
      enabled: boolean;
      keep: number | null;
      inbound: boolean;
      outbound: boolean;
      sample: number;
      maxPerSecond: number;
      maxBody: number;
      partition: 'day' | 'month' | false;
      store: string;
      table: string;
    };
    /** Whether anything is being recorded. */
    enabled: boolean;
    /**
     * The id of the request being handled, or `null` outside one. The seam
     * a package outside core reaches for when it has to carry the id into
     * a job.
     */
    requestId(): string | null;
    /**
     * Records one finished outbound call. Answers `false` on a disabled
     * log, on a request the sampling dropped, and when a bound refused it.
     */
    outbound(call: {
      service?: string;
      method?: string;
      url?: string;
      status?: number | null;
      duration?: number;
      at?: number;
      requestId?: string | null;
      route?: string | null;
      actor?: string | null;
      outcome?: 'aborted' | 'failed' | 'ok';
      error?: string | null;
      request?: { headers?: object | null; body?: unknown } | null;
      response?: { headers?: object | null; body?: unknown } | null;
      meta?: Record<string, unknown>;
    }): boolean;
    /**
     * Times one outbound call. The seam an application's own HTTP client
     * goes through: henri wraps nobody's client.
     */
    track(details: {
      service?: string;
      method?: string;
      url?: string;
      requestId?: string | null;
      request?: { headers?: object | null; body?: unknown } | null;
      meta?: Record<string, unknown>;
    }): (answer?: {
      status?: number | null;
      headers?: object | null;
      body?: unknown;
      error?: string | null;
      url?: string;
      meta?: Record<string, unknown>;
    }) => boolean | null;
    /** The calls matching a filter. */
    list(filter?: {
      requestId?: string;
      direction?: 'in' | 'out';
      service?: string;
      actor?: string;
      outcome?: 'aborted' | 'failed' | 'ok';
      status?: number;
      since?: Date | string | number;
      until?: Date | string | number;
      limit?: number;
      offset?: number;
    }): Promise<CallRecord[]>;
    count(filter?: Record<string, unknown>): Promise<number>;
    /**
     * Everything that happened during one request: the call that came in
     * and every call that went out because of it, oldest first.
     */
    about(
      requestId: string,
      filter?: Record<string, unknown>
    ): Promise<CallRecord[]>;
    /**
     * Everything the log holds about one person, by their `externalId`.
     * What `henri privacy:export` reads.
     */
    forPerson(
      actor: string,
      filter?: Record<string, unknown>
    ): Promise<CallRecord[]>;
    /**
     * Takes one person out of the rows that named them: the `actor`, the
     * addresses and the payloads are written over and the row survives.
     * What `henri privacy:erase` runs.
     */
    forget(actor: string): Promise<number>;
    /**
     * Takes the calls past `config.calls.keep` away. Drops whole partitions
     * where the dialect has them, and deletes rows in bounded batches for
     * whatever is left.
     */
    prune(options?: { now?: number }): Promise<{
      removed: number;
      partitions: string[];
      before: number | null;
    }>;
    /** What was written, and what was dropped rather than written. */
    stats(): Promise<{
      enabled: boolean;
      buffered: number;
      written: number;
      total: number;
      dropped: { buffer: number; failed: number; rate: number };
      partitions: Array<{ name: string; from: number; to: number }>;
    }>;
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
     * The public form of a record, a list of records, or anything holding
     * some: no internal id anywhere, and every declared foreign key
     * replaced by the `externalId` of the row it names.
     *
     * `res.render()`, `res.resource()` and `res.collection()` do this on
     * their way out. Call it yourself when a controller presents its
     * records: a plain object carries no model, so publish first and
     * present second.
     */
    publish<T = unknown>(value: T): Promise<T>;
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
   * `henri.jobs`: the module `@usehenri/jobs` ships. It is there when the
   * application depends on the package, and `undefined` when it does not.
   * Installing the package is not the same as using it: an application with
   * neither `app/jobs` nor a `jobs` block keeps the module inert
   * (`henri.jobs.enabled` is false) and every method throws.
   */
  interface JobsModule {
    name: 'jobs';
    /** Whether the application has a queue. */
    enabled: boolean;
    /**
     * Adds a job the application did not write: how a package ships work of
     * its own (`@usehenri/webhooks` registers its delivery job this way).
     * A file of `app/jobs` with the same name wins, and this answers false.
     */
    define(name: string, definition: JobDefinition): boolean;
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

  /** One webhook endpoint, as `henri.webhooks` hands it out. */
  interface WebhookEndpoint {
    id: string;
    /** Where the deliveries go. */
    url: string;
    /** What it subscribes to: event names, `prefix.*`, or `*`. */
    events: string[];
    /** The tenant it belongs to, `null` for an application-wide endpoint. */
    owner: string | null;
    description: string | null;
    /** Headers of its own, on top of the ones henri signs with. */
    headers: Record<string, string>;
    /** The signing secrets, without their keys. */
    secrets: Array<{
      id: string;
      scheme: string;
      createdAt: string;
      expiresAt: string | null;
    }>;
    disabled: boolean;
    disabledAt: string | null;
    disabledReason: string | null;
    createdAt: string;
    updatedAt: string;
    /** The signing secret, on `register()` and `rotate()` only. */
    secret?: string;
  }

  /** One delivery `henri.webhooks.emit()` enqueued. */
  interface WebhookDelivery {
    /** The delivery id, which the `webhook-id` header carries. */
    id: string;
    endpoint: string;
    event: string;
    /** The id of the queue job that performs it. */
    job: string;
  }

  /**
   * `henri.webhooks`: the module `@usehenri/webhooks` ships. It is there
   * when the application depends on the package, and `undefined` when it
   * does not. Delivering needs a running queue (`@usehenri/jobs`).
   */
  interface WebhooksModule {
    name: 'webhooks';
    enabled: boolean;
    /** Registers an endpoint; the answer carries its secret, once. */
    register(options: {
      url: string;
      events: string | string[];
      owner?: string;
      description?: string;
      headers?: Record<string, string>;
      secret?: string;
    }): Promise<WebhookEndpoint>;
    /**
     * Enqueues one delivery per subscribed endpoint. Without an `owner` it
     * reaches the endpoints that have none, never another tenant's.
     */
    emit(
      event: string,
      data?: unknown,
      options?: {
        owner?: string | null;
        wait?: number | string;
        at?: Date | string | number;
      }
    ): Promise<WebhookDelivery[]>;
    /** Enqueues one delivery to one endpoint, subscription or not. */
    deliverTo(
      id: string,
      event: string,
      data?: unknown,
      options?: { wait?: number | string; at?: Date | string | number }
    ): Promise<WebhookDelivery>;
    endpoint(id: string): Promise<WebhookEndpoint | null>;
    endpoints(filter?: {
      owner?: string | null;
      disabled?: boolean;
      limit?: number;
      offset?: number;
    }): Promise<WebhookEndpoint[]>;
    /** The secrets that still sign, in the clear. */
    secrets(id: string): Promise<string[]>;
    update(
      id: string,
      changes?: {
        url?: string;
        events?: string | string[];
        description?: string | null;
        headers?: Record<string, string>;
        owner?: string | null;
      }
    ): Promise<WebhookEndpoint>;
    /** A new secret; the old ones keep signing for `grace` milliseconds. */
    rotate(
      id: string,
      options?: { grace?: number; secret?: string }
    ): Promise<WebhookEndpoint>;
    disable(
      id: string,
      options?: { reason?: string }
    ): Promise<WebhookEndpoint>;
    enable(id: string): Promise<WebhookEndpoint>;
    remove(id: string): Promise<boolean>;
    /** The endpoints, and what the queue holds for them. */
    stats(): Promise<{
      endpoints: { total: number; enabled: number; disabled: number };
      queue: string;
      deliveries: Record<string, unknown> | null;
    }>;
  }

  /** `henri.uploads`, with `@usehenri/uploads`. */
  interface UploadsModule {
    name: 'uploads';
    /** Whether this application accepts files. */
    enabled: boolean;
    /** `config.uploads`, normalized: every limit in bytes or `false`. */
    settings: Record<string, unknown>;
    /** The storage in use (`HenriStorage`). */
    storage: unknown;
    /**
     * Streams a stored file back, as a download: `Content-Disposition:
     * attachment` and `X-Content-Type-Options: nosniff`, so nothing that was
     * uploaded is ever rendered on this application's origin.
     */
    send(
      res: Response | ExpressResponse,
      record: StoredFile | string,
      options?: { disposition?: 'attachment' | 'inline'; maxAge?: number }
    ): Promise<unknown>;
    /**
     * A time-limited url that hands a stored file to a client without this
     * process reading it: the provider's own signature on an object store,
     * henri's own on the local disk. It is a bearer capability -- whoever
     * holds the link holds the file until it expires -- so it needs
     * `config.uploads.urls`, and refuses with `HENRI_UPLOAD_URLS_DISABLED`
     * without it.
     */
    url(
      record: StoredFile | string,
      options?: {
        expiresIn?: number;
        disposition?: 'attachment' | 'inline';
        filename?: string;
        type?: string;
      }
    ): Promise<string>;
    /**
     * One declared variant of a stored image, derived once and then read
     * back. Needs `sharp` in the application; without it this refuses with
     * `HENRI_UPLOAD_NO_IMAGE_LIBRARY`.
     */
    variant(record: StoredFile | string, name: string): Promise<VariantFile>;
    /** A readable stream of a stored file. */
    get(record: StoredFile | string): Promise<NodeJS.ReadableStream>;
    /** Removes a stored file. */
    delete(record: StoredFile | string): Promise<boolean>;
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
    /** The same object as `henri.shared`, `null` without `config.shared`. */
    shared: SharedStore | null;
    stop(): Promise<void>;
  }

  /**
   * `henri.shared`: the backend `config.shared` names, and the one place the
   * failure policy of the three counters lives. `null` when the application
   * names none, which means every counter is kept in this process.
   */
  interface SharedStore {
    /** The adapter name (`"redis"`). */
    name: string;
    /** `"closed"` or `"open"`, from `config.shared.onError`. */
    onError: 'closed' | 'open';
    /** Whether the last call reached the backend. */
    healthy: boolean;
    /** What it is talking to, with the password taken out. */
    describe(): string;
    /** Opens the connection; `false` when the backend did not answer. */
    start(): Promise<boolean>;
    /** Closes it, and every store handed out. */
    stop(): Promise<boolean>;
    /** Whether the backend answers (`GET /readyz`, `henri doctor`). */
    ping(): Promise<boolean>;
    /** An express-rate-limit store, with the failure policy applied. */
    rateLimitStore(feature: string): unknown;
    /**
     * The backend's own store, without the failure policy: what the cache
     * takes, since a cache that cannot answer is a miss and never a 503.
     */
    unguarded(feature: string, options?: { raw?: boolean }): unknown;
    /** A `{ get, set, add, delete }` store, always fail-closed. */
    keyValueStore(feature: string): {
      get(key: string): Promise<unknown>;
      set(key: string, value: unknown, ttl: number): Promise<void>;
      add(key: string, value: unknown, ttl: number): Promise<boolean>;
      delete(key: string): Promise<void>;
    };
  }

  /**
   * What a cache key may be built from. An array is its parts joined with
   * `/`; a plain object is its keys sorted, so two callers writing them in
   * a different order still meet; anything with a `cacheKey()` answers for
   * itself. A key longer than 250 characters keeps its front and ends with
   * a digest of the whole.
   */
  type CacheKey =
    | string
    | number
    | boolean
    | Date
    | readonly CacheKey[]
    | { cacheKey(): CacheKey }
    | Record<string, unknown>;

  /** What a `set` or a `fetch` may say about one entry. */
  interface CacheOptions {
    /** How long it lives: milliseconds, or `"30s"`, `"5m"`, `"2h"`, `"1d"`. */
    ttl?: number | string;
    /** `fetch` only: run the function and write, without reading first. */
    force?: boolean;
  }

  /** What `henri.cache.stats()` answers. */
  interface CacheStats {
    /** The backend (`"memory"`, `"redis"`, whatever a store calls itself). */
    backend: string;
    hits: number;
    misses: number;
    writes: number;
    /** Backend calls that failed, every one of them treated as a miss. */
    errors: number;
    /** Entries the memory backend dropped to stay in bounds. */
    evictions: number;
    /** Functions `fetch` is running right now, one per key at most. */
    inflight: number;
    /** The memory backend only; `null` on any other. */
    entries: number | null;
    /** The memory backend only; `null` on any other. */
    bytes: number | null;
  }

  /**
   * A cache: `henri.cache`, and every `scope()` of it.
   *
   * A value is JSON plus `Date`; a model instance, `undefined`, `NaN`, a
   * `Map`, a `Buffer` or anything circular is refused rather than stored to
   * come back wrong. A backend that does not answer is a miss, never a
   * failed request. Nothing invalidates anything on its own.
   */
  interface Cache {
    /**
     * The cached value, or the one the function answers -- kept for next
     * time, and computed once however many callers missed it at once.
     */
    fetch<T>(key: CacheKey, fn: () => T | Promise<T>): Promise<T>;
    fetch<T>(
      key: CacheKey,
      options: CacheOptions,
      fn: () => T | Promise<T>
    ): Promise<T>;
    /** The value, or `undefined` when there is none. */
    get<T = unknown>(key: CacheKey): Promise<T | undefined>;
    /** Whether it was written (`false` when it was too big, or refused). */
    set(
      key: CacheKey,
      value: unknown,
      options?: CacheOptions
    ): Promise<boolean>;
    /** Forgets a key. The only invalidation henri has. */
    delete(key: CacheKey): Promise<boolean>;
    /** Forgets everything of this cache, or of this scope. Not for a request. */
    clear(): Promise<number>;
    /** A cache whose keys all start with a name of their own. */
    scope(name: string): Cache;
    /** Hits, misses, writes, errors, and what the memory backend holds. */
    stats(): CacheStats;
  }

  /** `henri.cache`: the module around the cache. */
  interface CacheModule extends Cache {
    /** The normalized `config.cache`. */
    settings: {
      enabled: boolean;
      maxEntries: number;
      maxEntrySize: number;
      maxSize: number;
      store: string | null;
      ttl: number;
    };
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
    /**
     * Where an application hears about the failures henri catches: the boot,
     * a 5xx and an unhandled rejection. `onError(fn)` registers the one
     * handler, `report(error, options)` adds the application's own.
     */
    reporter: Reporter;
    /**
     * OpenTelemetry, when the application has `@opentelemetry/api`. Always
     * there and always safe to call: with no api, `span()` runs the
     * function and `histogram()` answers a recorder that does nothing.
     */
    telemetry: TelemetryModule;
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
    /** `app/policies`, and the record-level authorization built on them. */
    policies: PoliciesModule;
    /** The fields the models marked `personal`, and what follows from it. */
    encryption: EncryptionModule;
    privacy: PrivacyModule;
    /** How long the models keep their records, and the sweep that runs. */
    retention: RetentionModule;
    /** The append-only record of who read or changed personal data. */
    trail: TrailModule;
    /**
     * The calls the application answered and the calls it made, joined by
     * the request id. Off unless `config.calls` says otherwise.
     */
    calls: CallsModule;
    /**
     * The history of the models that asked for one. `enabled` is false
     * until a model says `options: { versioned: true }`, and nothing is
     * created, mounted or written before one does.
     */
    versions: VersionsModule;
    /**
     * The queue, when the application depends on `@usehenri/jobs`. It is
     * `undefined` when it does not -- core carries no queue of its own --
     * and a `deliverLater()` that asked for a delay says what to install.
     */
    jobs?: JobsModule;
    /**
     * Uploads, when the application depends on `@usehenri/uploads`. It is
     * `undefined` when it does not -- core parses no multipart body of its
     * own, and `req.files` is then absent as well.
     */
    uploads?: UploadsModule;
    /**
     * Outbound webhooks, when the application depends on
     * `@usehenri/webhooks`. It is `undefined` when it does not, and
     * delivering needs a running queue as well.
     */
    webhooks?: WebhooksModule;
    workers: WorkersModule;
    api: ApiNamespace;
    /**
     * The backend `config.shared` names, which the rate limit, the sign-in
     * lockout and the idempotency keys count in. `null` without one: every
     * counter is then kept in this process.
     */
    shared: SharedStore | null;
    /**
     * The cache: `get`, `set`, `delete`, `clear`, `scope` and `fetch`. It is
     * this process's memory, bounded, unless `config.shared` names a
     * backend -- and then it is that one, with nothing else to configure.
     */
    cache: CacheModule;
    /** Registration, the password reset and the address confirmation. */
    accounts: AccountsService;
    /** The passport instance (also `henri.user.passport`). */
    passport: any;
    /**
     * May this user take this action on this record? The one way to ask,
     * wherever the answer is needed; `req.can()` is the same question with
     * the user of the request filled in. It answers `false` for everything
     * it cannot answer `true` for.
     */
    can(
      user: any,
      action: string,
      record?: any,
      options?: string | { policy?: string; type?: string }
    ): Promise<boolean>;
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
