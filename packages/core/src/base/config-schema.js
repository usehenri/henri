/**
 * The schema of the configuration henri owns.
 *
 * This is data, not code: every key of `config/<NODE_ENV>.json` that the
 * framework reads is declared here with the type it accepts, what to say
 * when something else arrives, and what to do about it. `config-validate.js`
 * walks it, `0.config.js` runs it on every boot (over the file, the
 * credentials and the environment alike) and `henri doctor` runs it without
 * booting.
 *
 * The keys an application invents are none of henri's business: they are
 * warned about, never refused, because `henri.config.get()` is how an
 * application reads its own configuration.
 *
 * A node is a plain object:
 *
 * - `type`: `string`, `number`, `boolean`, `array`, `object`, `record`, `any`
 * - `const`: the one value accepted (`false`, `'test'`)
 * - `oneOf`: a list of nodes, any of which is accepted
 * - `enum`, `insensitive`, `pattern`: constraints of a string
 * - `integer`, `above`, `min`, `max`: constraints of a number
 * - `of`: the node every item of an array must match
 * - `keys`, `required`, `unknown`: the shape of an object
 * - `values`: the node every value of a record must match
 * - `describe`: what was expected, in words ("a whole number, at least 1")
 * - `hint`: what to do about it
 * - `default`: what henri uses when the key is absent (documentation only)
 *
 * `unknown` says what an object does with a key it does not declare:
 * `warn` (the default) reports it, `near` reports it only when it looks
 * like a misspelling of a declared one -- which is what a store does, since
 * every key it does not know is forwarded to the driver -- and `allow`
 * says nothing, for the option bags of other libraries (helmet, cors,
 * nodemailer).
 *
 * Keeping this in step with `packages/core/index.d.ts` and with
 * `website/src/content/docs/configuration.md` is not left to goodwill:
 * `src/__tests__/config-schema.spec.js` compares the three and fails on the
 * first key that is in one and not the others.
 */

/** The adapters `stores.<name>.adapter` accepts (`3.model.js` loads them) */
const ADAPTERS = [
  'disk',
  'drizzle',
  'mariadb',
  'mongoose',
  'mssql',
  'mysql',
  'postgresql',
];

/** The renderers `renderer` accepts (`3.view.js` loads them) */
const RENDERERS = ['inertia', 'react', 'template', 'vue'];

/** The dialects `stores.<name>.dialect` accepts on the drizzle adapter */
const DIALECTS = ['mysql', 'postgres', 'sqlite'];

/** What `privacy.onErase` accepts (the strategies of `base/erasure.js`) */
const ON_ERASE = ['anonymize', 'delete', 'orphan', 'retain'];

/** What `trail.reads` accepts (`base/trail.js`) */
const READS = ['all', 'personal'];

/** What `calls.always` accepts (`base/calls.js`) */
const ALWAYS = ['aborted', 'client-error', 'error'];

/** What `calls.partition` accepts (`base/call-store.js`) */
const PARTITIONS = ['day', 'month'];

/** What `versions.onErase` accepts (`4.versions.js`) */
const ON_VERSION_ERASE = ['delete', 'follow', 'retain'];
/**
 * One `encryption.keys` entry: 32 bytes as 64 hexadecimal characters.
 *
 * It carries its own `describe` because the value never reaches the
 * message (`0.config.js` masks this path whatever `filterParameters`
 * says), so "must be a string, but it is a string" is all a validation
 * failure would otherwise say about a key with a newline in it.
 */
const ENCRYPTION_KEY = {
  describe: 'a key of 64 hexadecimal characters (openssl rand -hex 32)',
  pattern: /^[0-9a-f]{64}$/iu,
  type: 'string',
};

/** What `i18n.missing` accepts (`base/i18n.js`, which owns the meaning) */
const MISSING = ['auto', 'key', 'throw', 'warn'];

/** What `i18n.client` accepts, plus `false` (`base/i18n.js`) */
const CLIENTS = ['always', 'auto'];

/** What `logs.format` accepts (`base/logs.js`, which owns the meaning) */
const LOG_FORMATS = ['auto', 'json', 'pretty'];

/**
 * What the three enumerated keys of `maintenance` accept.
 *
 * Mirrored from `base/maintenance.js`, which owns the meaning, the way
 * `LOG_FORMATS` mirrors `base/logs.js` -- requiring it here would close a
 * cycle through `config-validate.js`, and `__tests__/maintenance.spec.js`
 * compares the lists.
 */
const MAINTENANCE_BYPASSES = ['token', 'loopback'];
const MAINTENANCE_READYZ = ['ready', 'unavailable'];
const MAINTENANCE_SWITCHES = ['auto', 'file', 'shared'];

/**
 * What `telemetry.spans` accepts: the boundaries henri knows.
 *
 * Mirrored from `base/telemetry.js`, which owns the meaning, the way
 * `LOG_FORMATS` mirrors `base/logs.js` -- requiring it here would close a
 * cycle through `config-validate.js`, and `__tests__/telemetry.spec.js`
 * compares the two lists.
 */
const BOUNDARIES = [
  'boot',
  'http',
  'jobs',
  'mail',
  'stores',
  'views',
  'webhooks',
];

/** A string that is not empty */
const text = (extra = {}) => ({ pattern: /\S/u, type: 'string', ...extra });

/** A counted bound: a whole number, or false to lift it */
const limit = (value, extra = {}) => ({
  default: value,
  describe: 'a whole number above zero, or false',
  oneOf: [{ const: false }, { above: 0, integer: true, type: 'number' }],
  ...extra,
});

/** A number strictly above zero */
const positive = (extra = {}) => ({
  above: 0,
  describe: 'a number of milliseconds above zero',
  type: 'number',
  ...extra,
});

/** A duration: milliseconds, or `'250ms'`, `'30s'`, `'5m'`, `'2h'`, `'1d'` */
const duration = (extra = {}) => ({
  describe: "a duration: milliseconds, or '30s', '5m', '2h', '1d'",
  oneOf: [
    { min: 0, type: 'number' },
    { pattern: /^\s*\d+(?:\.\d+)?\s*(?:ms|[smhdw])?\s*$/iu, type: 'string' },
  ],
  ...extra,
});

/**
 * A retention period: the durations of `base/retention.js`, which are the
 * ones everywhere else in henri plus the two only this measures things in
 */
const keeps = (extra = {}) => ({
  describe:
    "a retention period: '90d', '18mo', '2y', or a number of milliseconds",
  oneOf: [
    { min: 0, type: 'number' },
    {
      pattern: /^\s*\d+(?:\.\d+)?\s*(?:ms|mo|[smhdwy])?\s*$/iu,
      type: 'string',
    },
  ],
  ...extra,
});

/** A size: a number of bytes, or `'10mb'` (what `bodyLimit` accepts) */
const size = (extra = {}) => ({
  describe: "a size: a number of bytes, or a string ('10mb')",
  oneOf: [
    { above: 0, type: 'number' },
    { pattern: /^\s*\d+(?:\.\d+)?\s*(?:b|kb|mb|gb)?\s*$/iu, type: 'string' },
  ],
  ...extra,
});

/** The same, with `false` for "no limit" */
const sizeLimit = (extra = {}) => ({
  describe: "a size ('10mb', or a number of bytes), or false for no limit",
  oneOf: [{ const: false }, ...size().oneOf],
  ...extra,
});

/** One entry of `stores`: an adapter and how to reach its database */
/**
 * One `user.identities.providers.<name>` entry.
 *
 * henri ships no provider list, so this is the shape and not the contents:
 * an application names its providers and points them at their own three
 * endpoints. `clientSecret` is a secret like any other -- the encrypted
 * credentials or the environment, never a `config/*.json`, which is what
 * `henri audit` reports.
 */
const IDENTITY_PROVIDER = {
  hint: 'A provider needs authorizationUrl, tokenUrl, userinfoUrl, clientId and clientSecret; everything else has a default',
  keys: {
    allows: text({
      default: 'signin',
      describe: 'one of signin, verify',
      enum: ['signin', 'verify'],
      hint: 'verify identifies the person and never opens a session on its own; it can only be linked from a session',
    }),
    auth: text({
      default: 'basic',
      describe: 'one of basic, post',
      enum: ['basic', 'post'],
      hint: 'how the client secret reaches the token endpoint (client_secret_basic or client_secret_post)',
    }),
    authorizationUrl: text({
      describe: 'the url a browser is sent to',
      hint: 'https, unless user.identities.allowHttp says otherwise',
    }),
    claims: {
      describe: 'which fields of the userinfo answer henri reads',
      hint: 'Only for a provider that does not use the OpenID Connect names: henri reads sub, email and email_verified without this',
      keys: {
        email: text({
          default: 'email',
          describe: 'the address claim',
          hint: 'A field of what userinfoUrl answers; henri never reads an address out of an id_token',
        }),
        subject: text({
          default: 'sub',
          describe: "the claim holding the provider's identifier for a person",
          hint: 'It has to be stable and never reused: the row it keys is a credential, and a provider that hands the same one to a second person hands over the account',
        }),
        verified: {
          default: 'email_verified',
          describe: 'a claim name, or false',
          hint: 'false says this provider never verifies an address, so it can be linked and never signed up with',
          oneOf: [{ const: false }, text()],
        },
      },
      type: 'object',
    },
    clientId: text({
      describe: 'the client identifier the provider issued',
      hint: 'It reaches a browser in the authorization url, so it is not a secret; clientSecret is',
    }),
    clientSecret: text({
      describe: 'the client secret the provider issued',
      hint: 'Put it in the encrypted credentials (henri credentials:edit) or in the environment; henri audit reports one written here',
    }),
    label: text({
      describe: 'what a button calls this provider',
      hint: 'What the button says ("Sign in with Acme"); the name under providers is what the url carries',
    }),
    params: {
      describe: 'extra authorization parameters, by name',
      hint: 'What a provider asks for beyond the standard ones',
      type: 'record',
      values: text({
        hint: 'A value is a string, appended to the authorization url as it is; henri sends the standard parameters itself',
      }),
    },
    pkce: {
      default: true,
      describe: 'true or false',
      hint: 'false stops sending a code challenge, for a provider that refuses parameters it does not know',
      type: 'boolean',
    },
    scope: {
      describe: "a list of scopes, or one string ('openid email')",
      hint: 'What the provider is asked for; the list and the space-separated string are the same thing',
      oneOf: [text(), { of: text(), type: 'array' }],
    },
    tokenUrl: text({
      describe: 'where an authorization code is redeemed',
      hint: 'Called by henri from the server with the code and the client secret, so it never reaches a browser',
    }),
    trusted: {
      default: false,
      describe: 'true or false',
      hint: 'Only a provider that is an authority on who owns an address here; it is what user.identities.merge "verified" needs, and henri audit reports the pair',
      type: 'boolean',
    },
    userinfoUrl: text({
      describe: "where the person's claims are read with the access token",
      hint: 'What it answers is the profile henri reads: no id_token is ever parsed, so a provider that only signs its claims into one cannot be used',
    }),
  },
  required: [
    'authorizationUrl',
    'clientId',
    'clientSecret',
    'tokenUrl',
    'userinfoUrl',
  ],
  type: 'object',
};

const STORE = {
  hint: 'A store is { "adapter": "disk" } and the keys that adapter needs',
  keys: {
    adapter: {
      describe: `one of ${ADAPTERS.join(', ')}`,
      enum: ADAPTERS,
      hint: 'Pick one and add its package to the application: @usehenri/<adapter>',
      required: true,
      type: 'string',
    },
    database: text({
      describe: 'a database name',
      hint: 'One of `host`, `port`, `database`, `username` and `password`, the long form of a connection; a `url` replaces all five',
    }),
    dbName: text({
      default: 'henri',
      describe: 'a database name (disk)',
      hint: 'The disk adapter is the one that calls it that; every other adapter names it `database`',
    }),
    dialect: {
      describe: `one of ${DIALECTS.join(', ')} (drizzle)`,
      enum: DIALECTS,
      hint: 'The application installs the driver: better-sqlite3, pg or mysql2',
      type: 'string',
    },
    host: text({
      describe: 'a host name (or a url, on mongoose)',
      hint: 'With `port`, `database`, `username` and `password` it is the whole connection; a `url` replaces all five',
    }),
    migrate: {
      describe: 'true or false',
      hint: 'drizzle: true applies db/migrations on a production boot',
      type: 'boolean',
    },
    opts: {
      describe: 'an object of mongoose.connect() options',
      hint: 'Handed to mongoose.connect() untouched; henri only sets connectTimeoutMS and serverSelectionTimeoutMS itself',
      type: 'object',
      unknown: 'allow',
    },
    password: {
      hint: 'Never in a config/*.json, which is committed: put the connection in DATABASE_URL, in the credentials (`henri credentials:edit`) or in the environment',
      type: 'string',
    },
    path: text({
      default: '.henri/data',
      describe: 'a data directory, relative to the application (disk)',
      hint: 'Where the local mongod keeps its files. The default is under .henri, which the scaffold already keeps out of git',
    }),
    port: {
      describe: 'a port number between 1 and 65535',
      hint: "The database server's port; the one the application listens on is config.port",
      integer: true,
      max: 65535,
      min: 1,
      type: 'number',
    },
    session: {
      describe: 'an object of session store options',
      hint: 'Handed to the session store the adapter builds: connect-mongo on mongoose, the henri_sessions table on drizzle, connect-session-sequelize on mssql',
      type: 'object',
      unknown: 'allow',
    },
    sessions: {
      describe: 'true or false',
      hint: 'drizzle: true creates the session table without a user model',
      type: 'boolean',
    },
    sync: {
      describe: 'true or false',
      hint: 'SQL: false stops a development boot from bringing the schema up; on a Sequelize store true also lets a production boot create the tables that are missing, which it otherwise refuses to do',
      type: 'boolean',
    },
    url: text({
      describe: 'a connection string',
      hint: 'It replaces `host`, `port`, `database`, `username` and `password`; DATABASE_URL sets it for the default store',
    }),
    username: {
      hint: 'With `password`, the long form of a connection; a `url` carries both',
      type: 'string',
    },
  },
  // Everything else reaches the driver (Sequelize takes `logging`, `pool`,
  // `dialectOptions`, ...), so only a misspelling is worth a word
  type: 'object',
  unknown: 'near',
};

/**
 * The configuration henri owns, key by key. The order is the order of the
 * documentation page.
 */
const SCHEMA = {
  port: {
    default: 3000,
    describe: 'a port number between 1 and 65535',
    hint: 'A port is a whole number: { "port": 3000 }. In development a busy one is replaced by the next free port',
    integer: true,
    max: 65535,
    min: 1,
    type: 'number',
  },

  host: text({
    describe: 'an address to bind, as a string',
    hint: 'An interface to bind: "127.0.0.1", "0.0.0.0". HENRI_HOST (what henri server --host sets) wins over the file',
  }),

  cors: {
    describe: 'true for the cors defaults, or an object of cors options',
    hint: 'Absent means no cross-origin header at all, which is what a same-origin application wants; an object reaches the cors package unread, and whatever its origin allows csrf.trustedOrigins trusts',
    oneOf: [{ type: 'boolean' }, { type: 'object', unknown: 'allow' }],
  },

  renderer: {
    default: 'template',
    describe: `one of ${RENDERERS.join(', ')}`,
    enum: RENDERERS,
    hint: 'henri new writes "react"; "vue" also needs { "experimental": { "vue": true } }',
    insensitive: true,
    type: 'string',
  },

  inertia: {
    describe: 'an object of Inertia renderer options',
    hint: 'Read by the inertia renderer alone: the keys rename the files it boots from, which henri new wrote into app/views, and turn server-side rendering off',
    keys: {
      entry: text({
        default: 'main.jsx',
        describe: 'a client entry, relative to app/views',
        hint: 'The file Vite bundles for the browser, the one that calls createInertiaApp',
      }),
      id: text({
        default: 'app',
        describe: 'the id of the root element',
        hint: 'It has to be the id of an element of inertia.template, which is what a page mounts into',
      }),
      ssr: {
        default: true,
        describe: 'true or false',
        hint: 'false renders every page in the browser, so the first answer is an empty shell carrying the page object',
        type: 'boolean',
      },
      ssrEntry: text({
        default: 'ssr.jsx',
        describe: 'a server entry, relative to app/views',
        hint: 'Built only while inertia.ssr is on: it renders the same pages without a browser and answers { head, body }',
      }),
      template: text({
        default: 'index.html',
        describe: 'an html shell, relative to app/views',
        hint: 'The document henri fills: <!--head--> and <!--body--> receive the rendered page',
      }),
    },
    type: 'object',
  },

  assets: {
    describe: 'an object naming where the compiled assets are served from',
    hint: "Read by the view engines and by the Content Security Policy; uploads.urls.cdn is the other one and it is a different thing (a cache in front of henri's own route)",
    keys: {
      prefix: text({
        describe:
          "an absolute http(s) url ('https://cdn.example.com') or a path ('/assets')",
        hint: 'The url of every file the production build wrote; henri names its origin in the policy itself, so config.helmet needs nothing. No credentials, no query and no fragment: it is a prefix, not a link',
        // A path, or an http(s) url with no credentials (`@`), no query and
        // no fragment. A trailing slash is allowed and taken off when it is
        // used (`base/assets.js`)
        pattern: /^(?:\/(?!\/)[^\s?#]*|https?:\/\/[^\s/?#@]+(?:\/[^\s?#]*)?)$/u,
      }),
    },
    type: 'object',
  },

  experimental: {
    describe: 'an object of renderer opt-ins',
    hint: 'The only opt-in henri has is { "vue": true }; a supported renderer needs nothing here',
    keys: {
      vue: {
        describe: 'true or false',
        hint: 'true loads the Vue/Nuxt renderer, which has not been exercised since 2020 and is not supported',
        type: 'boolean',
      },
    },
    type: 'object',
  },

  stores: {
    describe: 'an object of named stores',
    hint: 'A model picks one with its `store` key, or uses `default`',
    type: 'record',
    values: STORE,
  },

  migrations: {
    describe: 'an object of migration settings',
    hint: 'What a migration is allowed to do to a database that has rows in it. `henri db:generate` warns whatever this says; a production `henri db:migrate` is what reads it',
    keys: {
      approve: {
        default: true,
        describe: 'true or false',
        hint: 'true means a migration henri found something in does not run in production until its token is listed; false is the deployment being the review, and `henri audit` reports it',
        type: 'boolean',
      },
      approved: {
        default: [],
        describe: 'a list of migration tokens (tag:digest)',
        hint: '`henri db:status` prints the token of every pending migration it has something to say about; the digest covers what was found, so reformatting the file keeps it and another drop edited in replaces it',
        of: text(),
        type: 'array',
      },
    },
    type: 'object',
  },

  secret: text({
    describe: 'a string',
    hint: 'Set it with HENRI_SECRET or the credentials, never in config/',
  }),

  url: text({
    default: 'the url of the running server',
    describe: 'the canonical address of the application',
    hint: 'https://example.com, used for the links inside the mails henri sends',
  }),

  user: {
    describe:
      'the name of the user model, or an object ({ model, public, loginPath, afterLogin, sessionMaxAge, password, lockout, signup, passwordReset, confirmation })',
    hint: '"user" is the short form of { "model": "user" }; the object is where the sign-in paths, the password policy and the account flows go',
    oneOf: [
      text(),
      {
        keys: {
          afterLogin: text({
            default: '/',
            describe: 'a path to land on after a form login',
            hint: 'Where a browser is redirected; a client asking for JSON is answered the user and never redirected',
          }),
          confirmation: {
            default: false,
            describe:
              'true, false, or an object ({ path, emailPath, expiresIn, after, required, requirePassword })',
            hint: 'mounts GET /confirm/:token, POST /confirm and POST /account/email',
            oneOf: [
              { type: 'boolean' },
              {
                keys: {
                  after: text({
                    default: '/',
                    describe: 'a path to land on once the address is confirmed',
                  }),
                  emailPath: text({
                    default: '/account/email',
                    describe: 'where an account asks to change its address',
                    hint: 'A POST from a signed-in account; the link goes to the new address and nothing changes until it is followed',
                  }),
                  enabled: {
                    default: true,
                    describe: 'true or false',
                    hint: 'false leaves the endpoints unmounted',
                    type: 'boolean',
                  },
                  expiresIn: duration({
                    default: '3d',
                    describe: 'how long a confirmation link stays valid',
                    hint: 'The token is signed rather than stored, so rotating config.secret invalidates every link already sent, whatever this says',
                  }),
                  path: text({
                    default: '/confirm',
                    describe: 'the prefix of the confirmation endpoints',
                    hint: 'GET <path>/:token confirms an address, POST <path> mails the link again',
                  }),
                  required: {
                    default: false,
                    describe: 'true or false',
                    hint: 'true keeps unconfirmed accounts from signing in; backfill confirmedAt first',
                    type: 'boolean',
                  },
                  requirePassword: {
                    default: true,
                    describe: 'true or false',
                    hint: 'false lets a signed-in account change its address without its password',
                    type: 'boolean',
                  },
                },
                type: 'object',
              },
            ],
          },
          identities: {
            default: false,
            describe:
              'false, or an object ({ providers, merge, path, after, signup, allowHttp, stateExpiresIn, timeout, table })',
            hint: 'mounts POST <path>/:provider, GET <path>/:provider/callback and POST <path>/:provider/unlink',
            oneOf: [
              { const: false },
              {
                keys: {
                  after: text({
                    default: '/',
                    describe: 'a path to land on once a provider was linked',
                  }),
                  allowHttp: {
                    default: false,
                    describe: 'true or false',
                    hint: 'true lets a provider be reached over http, which is for development and nothing else',
                    type: 'boolean',
                  },
                  enabled: {
                    default: true,
                    describe: 'true or false',
                    hint: 'false leaves the endpoints unmounted without removing the providers',
                    type: 'boolean',
                  },
                  merge: text({
                    default: 'refuse',
                    describe: 'one of refuse, verified',
                    enum: ['refuse', 'verified'],
                    hint: 'verified links a callback to the account that already holds that address, so whoever can make a trusted provider assert it takes that account; the provider must also be trusted: true, and henri audit reports the pair',
                  }),
                  path: text({
                    default: '/auth',
                    describe: 'the prefix of the identity endpoints',
                    hint: 'POST <path>/:provider, GET <path>/:provider/callback and POST <path>/:provider/unlink; the callback url registered with each provider has to match',
                  }),
                  providers: {
                    describe:
                      'the identity providers, by the name a url calls them',
                    hint: 'henri ships none: an application names its own and points them at their endpoints',
                    type: 'record',
                    values: IDENTITY_PROVIDER,
                  },
                  signup: {
                    default: true,
                    describe: 'true or false',
                    hint: 'false refuses a callback whose verified address belongs to nobody, instead of opening an account for it',
                    type: 'boolean',
                  },
                  stateExpiresIn: duration({
                    default: '10m',
                    describe: 'how long one sign-in attempt stays valid',
                    hint: 'How long a person has between the button and the callback; the state is minted per attempt, kept in the session and single use',
                  }),
                  table: text({
                    default: 'henri_identities',
                    describe: 'the table the identities live in',
                    hint: 'henri creates it and owns it: a row is a credential, never a model',
                  }),
                  timeout: duration({
                    default: '10s',
                    describe: 'how long a provider has to answer',
                    hint: 'One bound for the token request and for the userinfo request; a provider slower than this fails the sign-in',
                  }),
                },
                type: 'object',
              },
            ],
          },
          lockout: {
            default: '{ max: 10, windowMs: 900000 }',
            describe: 'false, or an object ({ max, windowMs, store })',
            hint: 'false lets one account receive unlimited sign-in attempts',
            oneOf: [
              { const: false },
              {
                keys: {
                  max: {
                    default: 10,
                    describe: 'a number of failed attempts, above zero',
                    hint: 'Failed attempts one account may receive per window, whoever sends them; rateLimit.auth is what bounds one client',
                    integer: true,
                    min: 1,
                    type: 'number',
                  },
                  store: {
                    describe:
                      'the module id of an express-rate-limit store, or of a (henri, { name }) => store factory',
                    hint: 'defaults to rateLimit.store, then to config.shared; without any the count is per process',
                    oneOf: [{ const: null }, text()],
                  },
                  windowMs: positive({
                    default: 900000,
                    describe: 'a window in milliseconds',
                    hint: 'The window user.lockout.max is counted in; nothing else unlocks an account',
                  }),
                },
                type: 'object',
              },
            ],
          },
          loginPath: text({
            default: '/login',
            describe: 'a path to send denied browsers to',
            hint: 'Where a browser goes when a route or a policy denies an anonymous visitor; a JSON client gets a 401 instead',
          }),
          model: text({
            default: 'user',
            describe: 'the user model name',
            hint: 'A model of app/models; henri adds email, password and roles to whichever one it names',
          }),
          password: {
            describe: 'the password policy and the hashing parameters',
            hint: 'The defaults are the safe ones (argon2id where @node-rs/argon2 resolves, bcrypt otherwise); lower nothing here without a reason',
            keys: {
              algorithm: text({
                default: 'auto',
                describe: 'one of auto, argon2id, bcrypt',
                enum: ['auto', 'argon2id', 'bcrypt'],
                hint: 'auto uses argon2id when @node-rs/argon2 is installed',
              }),
              bcryptRounds: {
                default: 12,
                describe: 'a bcrypt work factor, at least 10',
                hint: 'Only read when bcrypt is what hashes; every step up doubles the work of a sign-in as well as an attacker',
                integer: true,
                min: 10,
                type: 'number',
              },
              binding: {
                describe:
                  'true, false, or an object ({ enabled, allowUnbound })',
                hint: 'Binds a hash to the externalId of its row, so one copied onto another row stops verifying; allowUnbound keeps accepting the hashes written before it',
                oneOf: [
                  { type: 'boolean' },
                  {
                    keys: {
                      allowUnbound: {
                        default: true,
                        describe: 'true or false',
                        hint: 'false refuses every hash that is not yet bound, which locks out whoever has not signed in since',
                        type: 'boolean',
                      },
                      enabled: {
                        default: true,
                        describe: 'true or false',
                        hint: 'false writes new hashes unbound; the bound ones keep verifying, because the marker in the column is what decides',
                        type: 'boolean',
                      },
                    },
                    type: 'object',
                  },
                ],
              },
              maxBytes: {
                default: 72,
                describe: 'a length in bytes, at least 8',
                hint: 'bcrypt ignores everything past 72 bytes',
                integer: true,
                min: 8,
                type: 'number',
              },
              memoryCost: {
                default: 19456,
                describe: 'argon2id memory in kibibytes, at least 8',
                hint: 'argon2id only, and the parameter that costs an attacker most; 19456 next to timeCost 2 and parallelism 1 is what OWASP recommends',
                integer: true,
                min: 8,
                type: 'number',
              },
              minLength: {
                default: 12,
                describe: 'a password length, at least 8',
                hint: 'Checked when a password is set and never when one is verified, so raising it locks nobody out',
                integer: true,
                min: 8,
                type: 'number',
              },
              parallelism: {
                default: 1,
                describe: 'a number of argon2id lanes, at least 1',
                hint: 'argon2id only; one lane is what OWASP recommends next to the default memoryCost',
                integer: true,
                min: 1,
                type: 'number',
              },
              pepper: {
                describe:
                  'a key, or an object ({ current, previous, allowUnpeppered })',
                hint: 'Set it with HENRI_PASSWORD_PEPPER, never in config/; losing it makes every peppered password unverifiable',
                oneOf: [
                  text(),
                  {
                    keys: {
                      allowUnpeppered: {
                        default: true,
                        describe: 'true or false',
                        hint: 'false refuses hashes written before the pepper',
                        type: 'boolean',
                      },
                      current: text({
                        describe: 'the key in force',
                        hint: 'What every new hash is written under; a rotation moves the old key into `previous` rather than dropping it',
                      }),
                      previous: {
                        describe: 'a list of keys it replaced',
                        hint: 'Still accepted on the way in: a password that verified under one is written again under `current` at that sign-in, so a rotation ends when nothing verifies under them any more',
                        of: text(),
                        type: 'array',
                      },
                    },
                    required: ['current'],
                    type: 'object',
                  },
                ],
              },
              timeCost: {
                default: 2,
                describe: 'a number of argon2id iterations, at least 1',
                hint: 'argon2id only; two iterations is what OWASP recommends next to the default memoryCost, and memory is the parameter to raise first',
                integer: true,
                min: 1,
                type: 'number',
              },
            },
            type: 'object',
          },
          passwordReset: {
            default: false,
            describe:
              'true, false, or an object ({ path, expiresIn, after, login })',
            hint: 'mounts POST <path>/forgot, GET <path>/reset/:token and POST <path>/reset',
            oneOf: [
              { type: 'boolean' },
              {
                keys: {
                  after: text({
                    default: '/',
                    describe: 'a path to land on once the password changed',
                    hint: 'user.passwordReset.login is what decides whether the browser arrives there signed in',
                  }),
                  enabled: {
                    default: true,
                    describe: 'true or false',
                    hint: 'false leaves the endpoints unmounted',
                    type: 'boolean',
                  },
                  expiresIn: duration({
                    default: '1h',
                    describe: 'how long a reset link stays valid',
                    hint: 'A reset also stamps passwordChangedAt, which closes every session opened before it',
                  }),
                  login: {
                    default: true,
                    describe: 'true or false',
                    hint: 'false sends the browser to the login page instead',
                    type: 'boolean',
                  },
                  path: text({
                    default: '/password',
                    describe: 'the prefix of the reset endpoints',
                    hint: 'POST <path>/forgot asks for the mail, GET <path>/reset/:token opens the form and POST <path>/reset writes the password',
                  }),
                },
                type: 'object',
              },
            ],
          },
          public: {
            describe: 'a list of field names',
            hint: 'externalId, email and roles are always public',
            of: text(),
            type: 'array',
          },
          sessionMaxAge: positive({
            default: 2592000000,
            describe: 'a session lifetime in milliseconds',
            hint: 'The lifetime of the session cookie, thirty days by default; rotating config.secret ends every session at once whatever this says',
          }),
          signup: {
            default: false,
            describe:
              'true, false, or an object ({ path, fields, after, login })',
            hint: 'mounts POST /signup',
            oneOf: [
              { type: 'boolean' },
              {
                keys: {
                  after: text({
                    default: '/',
                    describe: 'a path to land on after a signup',
                    hint: 'user.signup.login is what decides whether the browser arrives there signed in',
                  }),
                  enabled: {
                    default: true,
                    describe: 'true or false',
                    hint: 'false leaves the endpoint unmounted',
                    type: 'boolean',
                  },
                  fields: {
                    describe: 'a list of field names a signup form may set',
                    hint: 'email and password are always permitted; roles never is',
                    of: text(),
                    type: 'array',
                  },
                  login: {
                    default: true,
                    describe: 'true or false',
                    hint: 'false creates the account without opening a session',
                    type: 'boolean',
                  },
                  path: text({
                    default: '/signup',
                    describe: 'where the endpoint is mounted',
                    hint: 'A POST here opens an account with email, password and the fields of user.signup.fields, and nothing else',
                  }),
                },
                type: 'object',
              },
            ],
          },
        },
        type: 'object',
      },
    ],
  },

  baseRole: {
    describe: 'a role name, or a list of them',
    hint: 'What the roles column of a new account is set to; without this key an account starts with none, and setRoles() is what changes them afterwards',
    oneOf: [text(), { of: text(), type: 'array' }],
  },

  externalIds: {
    describe:
      'an object of public identifier settings ({ lookup, references })',
    hint: 'Every model carries an externalId unless it opts out; this says what henri does with the internal one (see base/references.js)',
    keys: {
      lookup: {
        default: 'external',
        describe: "'external' or 'any'",
        enum: ['any', 'external'],
        hint: "'any' lets Model.findById() resolve a primary key again, so /tasks/4812 answers next to the uuid and guessing a number works",
        type: 'string',
      },
      references: {
        default: true,
        describe: 'true or false',
        hint: 'false sends a declared foreign key as the database holds it, so a record carries another row primary key',
        type: 'boolean',
      },
    },
    type: 'object',
  },

  policies: {
    describe: 'an object of policy settings ({ status, verify })',
    hint: 'Policies live in app/policies; the key only says what a refusal answers',
    keys: {
      status: {
        default: 404,
        describe: '403 or 404',
        hint: '404 hides that the record exists; 403 says it is there and off limits',
        oneOf: [{ const: 403 }, { const: 404 }],
      },
      verify: {
        default: true,
        describe: 'true or false',
        hint: 'false stops reporting a route that declared a policy its action never asked',
        type: 'boolean',
      },
    },
    type: 'object',
  },

  tenancy: {
    describe:
      'an object of multi-tenancy settings ({ column, from, require, status }), or false',
    hint: "This does not make a model a tenant's: a model does, with options: { tenant: true }. It says where the tenant of a request comes from and what a query without one costs",
    oneOf: [
      { const: false },
      {
        keys: {
          column: text({
            default: 'tenantId',
            describe: 'a column name',
            hint: 'The column henri adds to every model that says options: { tenant: true }; a model naming its own column overrides it',
          }),
          from: {
            describe:
              'an object saying where the tenant of a request comes from',
            hint: "The order is fixed: what somebody said explicitly, then the signed-in user, then the subdomain, then the header. A client-named tenant is only ever allowed to agree with the user's own",
            keys: {
              header: {
                describe:
                  'a header name, or an object ({ name, from }) naming the proxies allowed to set it',
                hint: 'Any client can send a header, so a name without `from` fails the boot: list the addresses or ranges of the proxies in front of henri',
                oneOf: [
                  { const: false },
                  text(),
                  {
                    keys: {
                      from: {
                        describe: 'a list of addresses or CIDR ranges',
                        hint: 'The proxies henri believes this header from, the way trustProxy names the ones it believes X-Forwarded-For from: a header nobody vouches for is a tenant the client picked',
                        of: text(),
                        type: 'array',
                      },
                      name: text({
                        describe: 'a header name',
                        hint: 'What the proxy in front of henri writes the tenant into (X-Tenant, X-Account); the request has to carry this exact name',
                      }),
                    },
                    required: ['from', 'name'],
                    type: 'object',
                  },
                ],
              },
              subdomain: {
                describe: 'the domain the tenant is a label of, or false',
                hint: "'example.com' makes acme.example.com the tenant acme; the bare domain and a deeper name are no tenant at all",
                oneOf: [{ const: false }, text()],
              },
              user: {
                default: 'tenantId',
                describe:
                  'the column of the user model that says which tenant they belong to, or false',
                hint: 'This is the one source a client cannot write, which is why everything below it is only ever allowed to agree with it',
                oneOf: [{ const: false }, text()],
              },
            },
            type: 'object',
          },
          require: {
            default: false,
            describe: 'true or false',
            hint: 'true refuses a request whose tenant no source could decide. Off, the refusal happens at the first model call that needed one, which names the model',
            type: 'boolean',
          },
          status: {
            default: 404,
            describe: '403 or 404',
            hint: "What a request naming somebody else's tenant answers; 404 hides that the tenant exists",
            oneOf: [{ const: 403 }, { const: 404 }],
          },
        },
        type: 'object',
      },
    ],
  },

  trustProxy: {
    default: true,
    describe:
      "express' trust proxy setting: a boolean, a hop count or a list of addresses",
    hint: 'What express believes of X-Forwarded-For, which is what the rate limit counts by. Set false with no proxy in front; a blanket true behind one is also what makes the call log record no client address at all',
    oneOf: [
      { type: 'boolean' },
      { integer: true, min: 0, type: 'number' },
      text(),
    ],
  },

  csrf: {
    default: true,
    describe: 'true, false, or an object ({ origin, trustedOrigins })',
    hint: 'false disables the double-submit CSRF protection entirely',
    oneOf: [
      { type: 'boolean' },
      {
        keys: {
          origin: {
            default: true,
            describe: 'true or false',
            hint: 'false keeps the token check without the Sec-Fetch-Site and Origin check',
            type: 'boolean',
          },
          trustedOrigins: {
            describe: 'a list of origins (https://admin.example.com)',
            hint: 'whatever cors.origin allows is trusted already',
            of: text(),
            type: 'array',
          },
        },
        type: 'object',
      },
    ],
  },

  // Every key below is validated here without core reading any of it: the
  // engine is a module @usehenri/graphql ships (see base/graphql.js).
  // config/<env>.json is core's file, so an application that sets `graphql`
  // must be told the shape is wrong rather than have the key pass unread.
  // This node stays where it is -- it is not a stale reference to code that
  // left.
  graphql: {
    default: '/_henri/gql',
    describe: 'a path starting with /, or an object ({ endpoint, ... })',
    hint: 'The path is the short form of { "endpoint": ... }; the object is where the guards and the query limits go. Serving any of it needs @usehenri/graphql in the application',
    oneOf: [
      text({ pattern: /^\//u }),
      {
        keys: {
          authenticated: {
            default: false,
            describe: 'true or false',
            hint: 'true answers 401 to anonymous requests',
            type: 'boolean',
          },
          endpoint: text({
            default: '/_henri/gql',
            describe: 'a path starting with /',
            hint: 'One path is the whole surface: graphql.authenticated, graphql.roles and graphql.loopbackOnly are what guard it, and moving it guards nothing',
            pattern: /^\//u,
          }),
          introspection: {
            describe: 'true or false',
            hint: 'on outside production by default',
            type: 'boolean',
          },
          loopbackOnly: {
            default: false,
            describe: 'true or false',
            hint: 'true answers 404 to anything but the loopback interface',
            type: 'boolean',
          },
          maxAliases: limit(15, {
            hint: 'The most aliases one query may use. It needs no cycle and no deep schema to be worth refusing, which is why it is the strict one; false lifts it',
          }),
          maxComplexity: limit(1000, {
            hint: 'The most fields one query may select, fragments expanded, which is what a fragment bomb inflates; false lifts it',
          }),
          maxDepth: limit(10, {
            hint: 'The deepest query accepted. It only bites on a schema with somewhere deep to go, so it is the loosest of the three; false lifts it',
          }),
          maxTokens: limit(5000, {
            hint: "The most tokens one document may hold. It is graphql's own parser bound, so it refuses a document before parsing it; false lifts it",
          }),
          roles: {
            describe: 'a role name, or a list of them',
            hint: 'asking for a role implies authenticated',
            oneOf: [text(), { of: text(), type: 'array' }],
          },
        },
        type: 'object',
      },
    ],
  },

  mail: {
    describe: 'a nodemailer transport object, or "test"',
    hint: 'Absent, henri warns at boot and sends nothing; "test" opens an Ethereal account, and anything else reaches nodemailer.createTransport() and is verified before the boot finishes',
    oneOf: [{ const: 'test' }, { type: 'object', unknown: 'allow' }],
  },

  mailers: {
    describe: 'an object of mailer defaults',
    hint: "Defaults for every mailer of app/mailers; a mailer's own `defaults` wins over them, and config.mail is the transport that sends them",
    keys: {
      from: text({
        describe: 'a sender address',
        hint: 'Used by every message that sets none of its own',
      }),
      layout: {
        default: 'mailer',
        describe:
          'the name of a layout in app/views/mailers/layouts, or false for none',
        hint: 'The file is app/views/mailers/layouts/<name>.hbs and it wraps every view around {{{body}}}',
        oneOf: [{ const: false }, text()],
      },
      previews: {
        default: true,
        describe: 'true or false',
        hint: 'false turns the development preview routes off',
        type: 'boolean',
      },
    },
    type: 'object',
  },

  i18n: {
    describe: 'an object of i18n settings, or false to translate nothing',
    hint: 'Absent means on when config/locales holds a catalogue and off when it does not; an application with one language pays nothing for this',
    oneOf: [
      { const: false },
      {
        keys: {
          client: {
            default: 'auto',
            describe: `one of ${CLIENTS.join(', ')}, or false`,
            hint: 'auto embeds the catalogue in a document and leaves it out of an xhr answer, which the client already has; always puts it in every answer; false keeps the strings on the server',
            oneOf: [{ const: false }, { enum: CLIENTS, type: 'string' }],
          },
          default: text({
            default: 'en',
            describe: 'the locale everything falls back to',
            hint: 'It has to be one of the catalogues in config/locales',
          }),
          fallback: {
            default: true,
            describe: 'true, false, a locale, or a list of locales',
            hint: 'true falls back to i18n.default; false makes a key missing in one locale missing, whatever the others hold',
            oneOf: [{ type: 'boolean' }, text(), { of: text(), type: 'array' }],
          },
          from: {
            describe:
              'an object saying where the locale of a request comes from',
            hint: 'The order is fixed: an explicit call, the user, the query, the cookie, Accept-Language, the default. Each key turns one step off (false) or renames what it reads',
            keys: {
              cookie: {
                default: 'henri.locale',
                describe: 'a cookie name, or false',
                hint: 'henri reads it and never writes it: a language switcher is an action of the application',
                oneOf: [{ const: false }, text()],
              },
              header: {
                default: true,
                describe: 'true or false',
                hint: 'Accept-Language, negotiated by q value',
                type: 'boolean',
              },
              query: {
                default: 'locale',
                describe: 'a query parameter name, or false',
                hint: 'The parameter of ?locale=fr; false takes that one step out of the order and turns nothing else off',
                oneOf: [{ const: false }, text()],
              },
              user: {
                default: null,
                describe: 'the column of the user model holding their locale',
                hint: 'This is also what a mail asks when it has the recipient and no request (see guides/i18n)',
                oneOf: [{ const: null }, text()],
              },
            },
            type: 'object',
          },
          locales: {
            describe: 'the locales this application has',
            hint: 'Defaults to the catalogues in config/locales; naming them here is how an unfinished one is kept out of production',
            of: text(),
            type: 'array',
          },
          missing: {
            default: 'auto',
            describe: `one of ${MISSING.join(', ')}`,
            hint: 'auto is warn outside production and key in it; throw is what a test suite sets, and the only setting that makes a missing key fail a build. No mode ever guesses a sentence from the key',
            enum: MISSING,
            type: 'string',
          },
          path: text({
            default: 'config/locales',
            describe: 'the directory the catalogues live in',
            hint: 'A catalogue is <locale>.json, or <locale>/<namespace>.json for one file per area; a directory that is not there means no catalogue is read at all',
          }),
          serverOnly: {
            default: ['mailers'],
            describe: 'the key prefixes that never reach a browser',
            hint: 'The strings of a mail are written for a recipient, not a reader',
            of: text(),
            type: 'array',
          },
        },
        type: 'object',
      },
    ],
  },

  api: {
    describe: 'an object of JSON API settings',
    hint: 'A block of settings and not a switch: the JSON layer is always on, and these only change the paging, the Idempotency-Key window and how strict an answer has to be',
    keys: {
      idempotency: {
        describe:
          'false, or an object ({ ttl, store }) of Idempotency-Key settings',
        hint: 'false stops honouring Idempotency-Key on every mutating route; one route opts out on its own with `idempotent: false`',
        oneOf: [
          { const: false },
          {
            keys: {
              store: {
                describe:
                  'the module id of a shared { get, set, delete } store',
                hint: 'defaults to config.shared; without one the keys are per process',
                oneOf: [{ const: null }, text()],
              },
              ttl: positive({
                default: 86400000,
                describe: 'a number of milliseconds above zero',
                hint: 'How long an Idempotency-Key answer is kept',
              }),
            },
            type: 'object',
          },
        ],
      },
      csv: {
        describe: 'an object of export settings ({ batch, formulas, maxRows })',
        hint: 'What `res.csv()` may read at once and how it escapes a cell (base/csv.js)',
        keys: {
          batch: {
            default: 500,
            describe: 'a whole number of records, above zero',
            hint: 'How many rows one page of an export reads; the cursor walks the whole table a page at a time',
            integer: true,
            min: 1,
            type: 'number',
          },
          formulas: {
            default: true,
            describe: 'true or false',
            hint: 'true writes a cell starting with =, +, - or @ as text, so a spreadsheet does not run it; false writes the value as it is stored',
            type: 'boolean',
          },
          maxRows: {
            default: 100000,
            describe: 'a whole number of records, above zero',
            hint: 'The most rows one export may carry; a bigger one is refused before a byte is written',
            integer: true,
            min: 1,
            type: 'number',
          },
        },
        type: 'object',
      },
      maxEmbedded: {
        default: 25,
        describe: 'a whole number of records, above zero',
        hint: 'The most records one `_embedded` relation carries per record, when the controller declares no limit of its own (base/embeds.js)',
        integer: true,
        min: 1,
        type: 'number',
      },
      maxEmbeds: {
        default: 3,
        describe: 'a whole number of relations, above zero',
        hint: 'The most relations one request may ask to embed (`?embed=lines,customer`)',
        integer: true,
        min: 1,
        type: 'number',
      },
      maxFilters: {
        default: 8,
        describe: 'a whole number of filter terms, above zero',
        hint: 'The most `filter[...]` terms one request may carry (base/filters.js)',
        integer: true,
        min: 1,
        type: 'number',
      },
      maxPerPage: {
        default: 100,
        describe: 'a whole number of records, above zero',
        hint: 'The ceiling on ?perPage=, which is what stops a client asking for the whole table in one answer',
        integer: true,
        min: 1,
        type: 'number',
      },
      maxSort: {
        default: 3,
        describe: 'a whole number of sort terms, above zero',
        hint: 'The most columns one request may order by (`?sort=a,-b`)',
        integer: true,
        min: 1,
        type: 'number',
      },
      perPage: {
        default: 25,
        describe: 'a whole number of records, above zero',
        hint: 'The page size req.pagination() takes when a request names none; api.maxPerPage is the ceiling on the one it does',
        integer: true,
        min: 1,
        type: 'number',
      },
      strict: {
        default: false,
        describe: 'true or false',
        hint: 'true refuses (500) a JSON answer without _links, and one that does not match what the action declared it answers',
        type: 'boolean',
      },
    },
    type: 'object',
  },

  jobs: {
    describe: 'an object of job queue settings',
    hint: 'The queue loads when this key is there or app/jobs holds a file',
    keys: {
      backoff: {
        describe: 'an object ({ base, factor, jitter, max })',
        hint: 'The wait before the next attempt is base x factor^(attempt - 1), capped at max and spread by jitter',
        keys: {
          base: duration({
            default: '5s',
            hint: 'The wait before the second attempt; every one after it is multiplied by jobs.backoff.factor',
          }),
          factor: positive({
            default: 4,
            describe: 'a number above zero',
            hint: 'What each attempt multiplies the wait by, until jobs.backoff.max caps it',
          }),
          jitter: {
            default: 0.15,
            describe: 'a number between 0 and 1',
            hint: 'The share of the wait that is randomised, so a hundred jobs that failed together do not retry together',
            max: 1,
            min: 0,
            type: 'number',
          },
          max: duration({
            default: '1h',
            hint: 'The cap on the wait, however many attempts a job has had',
          }),
        },
        type: 'object',
      },
      concurrency: {
        default: 5,
        describe: 'a whole number of jobs, above zero',
        hint: 'How many jobs one runner performs at once; `henri jobs --concurrency` says it for one runner',
        integer: true,
        min: 1,
        type: 'number',
      },
      install: {
        default: true,
        describe: 'true or false',
        hint: 'false stops the boot from creating the tables (henri jobs:install does)',
        type: 'boolean',
      },
      keepCompleted: duration({
        default: '1d',
        hint: 'How long a finished job stays in the table before a runner prunes it; 0 keeps them forever',
      }),
      mailQueue: text({
        default: 'mailers',
        describe: 'a queue name',
        hint: 'Where deliverLater() puts a rendered message; a runner has to be taking from it or nothing is sent',
      }),
      maxArgsBytes: {
        default: 524288,
        describe: 'a whole number of bytes, above zero',
        hint: 'The serialized arguments of one job; past it the enqueue fails rather than storing a truncated payload',
        integer: true,
        min: 1,
        type: 'number',
      },
      maxAttempts: {
        default: 5,
        describe: 'a whole number of attempts, above zero',
        hint: 'Attempts before a job goes to the dead letter queue, where `henri jobs:dead` finds it',
        integer: true,
        min: 1,
        type: 'number',
      },
      pollInterval: duration({
        default: '1s',
        hint: 'How often a runner looks for work while the queue is empty; never under 50ms',
      }),
      priority: {
        default: 0,
        describe: 'a number (the higher, the sooner)',
        hint: 'What a job file declaring no `priority` of its own gets',
        type: 'number',
      },
      queue: text({
        default: 'default',
        describe: 'a queue name',
        hint: 'What a job file declaring no `queue` of its own gets; jobs.queues is what a runner takes from',
      }),
      queues: {
        describe: "a list of queue names, or one string ('a,b')",
        hint: 'What a runner takes from when `henri jobs` is given no --queue; the string form is comma separated',
        oneOf: [text(), { of: text(), type: 'array' }],
      },
      recurring: {
        describe: 'an object of schedules, by name',
        hint: 'A runner is what puts them on the queue, so nothing recurs unless `henri jobs` is running somewhere',
        type: 'record',
        values: {
          hint: 'A schedule needs a "cron" or an "every", never both',
          keys: {
            args: {
              describe: 'the arguments of the job',
              hint: 'What perform(args) receives, the same value a henri.jobs.perform() call would pass',
              type: 'any',
            },
            cron: text({
              describe: 'a cron expression, read in UTC',
              hint: "UTC whatever the server's zone is, and it has a minute of resolution; `every` is the other way to say when",
            }),
            every: duration({
              hint: 'An interval counted from the last run; `cron` is the other way to say when, and a schedule takes one of the two',
            }),
            job: text({
              describe: 'the job name (the schedule name by default)',
              hint: 'The file of app/jobs to perform, so a schedule may be named for what it is for rather than for the job it runs',
            }),
            name: text({
              describe: 'an alias of `job`',
              hint: 'Write one or the other; `job` is the spelling the guide uses',
            }),
            priority: {
              describe: 'a number',
              hint: 'The priority of what this schedule enqueues; jobs.priority is what it falls back to',
              type: 'number',
            },
            queue: text({
              describe: 'a queue name',
              hint: 'The queue this schedule enqueues into; jobs.queue is what it falls back to',
            }),
          },
          type: 'object',
        },
      },
      store: text({
        default: 'default',
        describe: 'the name of a store of `stores`',
        hint: 'Which of config.stores holds the queue; it is reached with raw SQL and never through a model',
      }),
      stuckAfter: duration({
        default: '5m',
        hint: 'Without a heartbeat for that long a running job is taken to belong to a dead runner and put back, so keep it above the longest jobs.timeout',
      }),
      table: text({
        default: 'henri_jobs',
        describe: 'a table name: letters, digits and underscores only',
        hint: 'henri creates it, and the schedules live next to it in <table>_schedules',
        pattern: /^[A-Za-z_][A-Za-z0-9_]*$/u,
      }),
      timeout: {
        describe: "a duration, or null for 'no limit'",
        hint: 'How long one attempt may take, for the jobs that set none of their own; with no limit jobs.stuckAfter is what recovers a runner that died mid-job',
        oneOf: [{ const: null }, duration()],
      },
    },
    type: 'object',
  },

  webhooks: {
    describe: 'an object of outbound webhook settings',
    hint: 'Deliveries are sent by @usehenri/webhooks, which the application installs; every key is optional',
    keys: {
      allowHttp: {
        default: false,
        describe: 'true or false',
        hint: 'true lets a delivery go to a plaintext http url, payload and signature in the clear: development only',
        type: 'boolean',
      },
      allowPrivate: {
        default: false,
        describe: 'true or false',
        hint: 'true lets a delivery reach a loopback, private or link-local address, which is what a webhook url is normally refused for: development only',
        type: 'boolean',
      },
      backoff: {
        describe: 'an object ({ base, factor, jitter, max })',
        hint: 'The wait before the next attempt is base x factor^(attempt - 1), capped at max and spread by jitter',
        keys: {
          base: duration({
            default: '10s',
            hint: 'The wait before the second attempt; every one after it is multiplied by webhooks.backoff.factor',
          }),
          factor: positive({
            default: 3,
            describe: 'a number above zero',
            hint: 'What each attempt multiplies the wait by, until webhooks.backoff.max caps it',
          }),
          jitter: {
            default: 0.2,
            describe: 'a number between 0 and 1',
            hint: 'The share of the wait that is randomised, so a receiver that refused a hundred deliveries is not retried by all of them at once',
            max: 1,
            min: 0,
            type: 'number',
          },
          max: duration({
            default: '6h',
            hint: 'The cap on the wait, however many attempts a delivery has had',
          }),
        },
        type: 'object',
      },
      install: {
        default: true,
        describe: 'true or false',
        hint: 'false stops the boot from creating the table (henri webhooks:install does)',
        type: 'boolean',
      },
      maxAttempts: {
        default: 8,
        describe: 'a whole number of attempts, above zero',
        hint: 'Eight attempts of the default backoff is about three days of trying',
        integer: true,
        min: 1,
        type: 'number',
      },
      maxFanout: {
        default: 1000,
        describe: 'a whole number of endpoints, above zero',
        hint: 'How many deliveries one emit() may enqueue before it refuses',
        integer: true,
        min: 1,
        type: 'number',
      },
      queue: text({
        default: 'webhooks',
        describe: 'a queue name',
        hint: 'A queue of its own, so a slow receiver never delays the rest of the work; `henri jobs:list --queue webhooks` is what shows the deliveries',
      }),
      store: text({
        default: 'default',
        describe: 'the name of a store of `stores`',
        hint: 'Which of config.stores holds the endpoints; there is no deliveries table, because a delivery is a job',
      }),
      table: text({
        default: 'henri_webhooks',
        describe: 'a table name: letters, digits and underscores only',
        hint: 'henri creates it and owns it: an endpoint is a row, never a model',
        pattern: /^[A-Za-z_][A-Za-z0-9_]*$/u,
      }),
      timeout: duration({
        default: '10s',
        hint: 'How long one delivery may take, resolution and answer included',
      }),
    },
    type: 'object',
  },

  rateLimit: {
    describe: 'an object of limits, true for the defaults, or false for none',
    hint: 'Nothing is counted in development whatever this says; true is the defaults and false lifts every limit',
    oneOf: [
      { type: 'boolean' },
      {
        keys: {
          auth: {
            describe:
              'false, or an object ({ windowMs, max, paths }) for the login paths',
            hint: 'A second, tighter limit on the sign-in and account paths; false leaves them to the global one',
            oneOf: [
              { const: false },
              {
                keys: {
                  limit: positive({
                    describe: 'an alias of max',
                    hint: 'The name express-rate-limit 8 uses; write this one or `max`, never both',
                  }),
                  max: positive({
                    default: 10,
                    describe: 'a number of requests per window, above zero',
                    hint: 'Per window and per client, on the auth paths alone; user.lockout is the count kept per account',
                  }),
                  paths: {
                    describe: 'a list of paths to guard',
                    hint: 'It replaces the list henri guards rather than adding to it',
                    of: text(),
                    type: 'array',
                  },
                  windowMs: positive({
                    default: 60000,
                    hint: 'The window rateLimit.auth.max is counted in',
                  }),
                },
                type: 'object',
              },
            ],
          },
          limit: positive({
            describe: 'an alias of max',
            hint: 'The name express-rate-limit 8 uses; write this one or `max`, never both',
          }),
          max: positive({
            default: 600,
            describe: 'a number of requests per window, above zero',
            hint: 'Per window and per client over everything outside development; config.trustProxy is what decides which client that is',
          }),
          store: {
            describe:
              'the module id of an express-rate-limit store, or of a (henri, { name }) => store factory',
            hint: 'defaults to config.shared; without one the count is per process',
            oneOf: [{ const: null }, text()],
          },
          windowMs: positive({
            default: 60000,
            hint: 'The window rateLimit.max is counted in',
          }),
        },
        type: 'object',
      },
    ],
  },

  shared: {
    describe:
      'an object naming the backend the counters share ({ adapter, url, prefix, onError })',
    hint: 'The rate limit, the lockout and the idempotency keys count there instead of in this process',
    keys: {
      adapter: {
        describe: "an adapter name ('redis'), or the module id of a backend",
        hint: 'A name resolves @usehenri/<name> from the application: pnpm add @usehenri/redis',
        required: true,
        type: 'string',
      },
      enabled: {
        default: true,
        describe: 'true or false',
        hint: 'false keeps the block and counts in this process again',
        type: 'boolean',
      },
      onError: {
        default: 'closed',
        describe: 'one of closed, open',
        enum: ['closed', 'open'],
        hint: 'closed refuses a guarded request the backend cannot count (503); open serves it uncounted. The idempotency keys are always closed',
        type: 'string',
      },
      prefix: text({
        default: 'henri:',
        describe: 'a key prefix',
        hint: 'Two applications sharing one server need one prefix each',
      }),
      url: text({
        describe: 'a connection string (redis://, rediss://)',
        hint: 'Where the backend listens; every other key of this block reaches the driver, so ioredis takes tls, db, password and sentinels next to it',
      }),
    },
    // Everything else reaches the driver (ioredis takes `tls`, `db`,
    // `password`, `sentinels`, ...), so only a misspelling is worth a word
    type: 'object',
    unknown: 'near',
  },

  cache: {
    describe: 'an object of cache settings, or false to turn the cache off',
    hint: "henri.cache is this process's memory unless config.shared names a backend, and then it is that one",
    oneOf: [
      { const: false },
      {
        keys: {
          enabled: {
            default: true,
            describe: 'true or false',
            hint: 'false keeps the block; every fetch then runs its function',
            type: 'boolean',
          },
          maxEntries: {
            default: 1000,
            describe: 'a whole number of entries, above zero',
            hint: 'The memory backend only: the least recently used goes first',
            integer: true,
            min: 1,
            type: 'number',
          },
          maxEntrySize: size({
            default: '256kb',
            hint: 'What one value may weigh, encoded, on any backend: a bigger one is not cached',
          }),
          maxSize: size({
            default: '32mb',
            hint: 'Everything the memory backend holds',
          }),
          store: {
            describe: 'the module id of a { get, set, delete } store',
            hint: 'defaults to config.shared; without one the cache is this process',
            oneOf: [{ const: null }, text()],
          },
          ttl: duration({
            default: '5m',
            hint: 'How long an entry lives when a call does not say',
          }),
        },
        type: 'object',
      },
    ],
  },

  flags: {
    describe: 'an object of feature flag settings',
    hint: 'The flags are declared in config/flags.js; this is only where their state is kept and how often a process re-reads it',
    keys: {
      enabled: {
        default: true,
        describe: 'true or false',
        hint: 'false keeps the block; every flag then answers its declared default and nothing can be flipped',
        type: 'boolean',
      },
      refresh: duration({
        default: '10s',
        hint: 'How long a flip takes to reach the other processes, and the floor is one second',
      }),
      store: {
        describe: "'shared', 'memory', or the path of a file",
        hint: 'Unset means shared when config.shared names a backend, .henri/flags.json otherwise, and memory under NODE_ENV=test',
        oneOf: [{ const: null }, text()],
      },
    },
    type: 'object',
  },

  helmet: {
    describe: 'an object of helmet options, or false to disable helmet',
    hint: "What is written here is merged over henri's defaults rather than replacing them; false takes every security header off at once",
    oneOf: [{ const: false }, { type: 'object', unknown: 'allow' }],
  },

  csp: {
    describe: 'an object of Content Security Policy settings',
    hint: "The policy itself is helmet's: config.helmet.contentSecurityPolicy",
    keys: {
      nonce: {
        default: false,
        describe: 'true to give every response a nonce',
        hint: "script-src names it and loses 'unsafe-inline'; the renderer has to carry it (inertia, react and template do)",
        type: 'boolean',
      },
    },
    type: 'object',
  },

  filterParameters: {
    default: ['password', 'token', 'secret', 'authorization'],
    describe: 'a list of parameter names to mask, or false',
    hint: 'The list replaces the defaults rather than adding to them, so name password, token, secret and authorization again next to your own; they are matched as substrings, and "encryption" is masked whatever this says',
    oneOf: [{ const: false }, { of: text(), type: 'array' }],
  },

  logs: {
    describe: 'an object of log settings',
    hint: 'A block, not a level: `format` is the only key, and nothing here turns a log line off',
    keys: {
      format: {
        default: 'auto',
        describe: 'one of auto, json, pretty',
        enum: LOG_FORMATS,
        hint: 'auto is json in production and the pretty lines everywhere else; json writes one object per line, with the module, the level and the request id as fields',
        type: 'string',
      },
    },
    type: 'object',
  },

  telemetry: {
    describe: 'an object of telemetry settings, or false to instrument nothing',
    hint: 'henri ships no SDK and no exporter: install @opentelemetry/api and an SDK of your choosing, and henri traces the boundaries it knows',
    oneOf: [
      { const: false },
      {
        keys: {
          enabled: {
            describe: 'true or false',
            hint: 'Absent means on when @opentelemetry/api resolves from the application and off when it does not; true fails the boot when it does not, which is what a deployment that requires tracing wants',
            type: 'boolean',
          },
          metrics: {
            default: true,
            describe: 'true or false',
            hint: 'The request duration, the queue depth and the cache counters; false leaves the spans',
            type: 'boolean',
          },
          propagate: {
            default: true,
            describe: 'true or false',
            hint: 'traceparent on the requests henri makes for the application (a webhook delivery); an incoming one is always honoured',
            type: 'boolean',
          },
          spans: {
            default: 'all',
            describe: `"all", false, or a list of ${BOUNDARIES.join(', ')}`,
            hint: 'Which boundaries get a span; false keeps the metrics and emits none',
            oneOf: [
              { const: 'all' },
              { const: false },
              { of: { enum: BOUNDARIES, type: 'string' }, type: 'array' },
            ],
          },
        },
        type: 'object',
      },
    ],
  },

  encryption: {
    describe: 'an object of encrypted attribute settings',
    hint: 'Which fields are encrypted is said in the models ({ encrypted: true }); this is the key that opens them',
    keys: {
      keys: {
        describe:
          'a key, or a list of keys with the one that writes first, each 64 hexadecimal characters',
        hint: 'Never in config/*.json, which is committed: put them in the credentials (`henri credentials:edit`) or in HENRI_ENCRYPTION_KEYS. A rotation adds the new key in front and keeps the old one until `henri encryption:status` reports nothing left under it',
        oneOf: [ENCRYPTION_KEY, { of: ENCRYPTION_KEY, type: 'array' }],
      },
      readPlaintext: {
        default: false,
        describe: 'true or false',
        hint: 'true lets a column declared encrypted answer with whatever it holds, which is what makes a backfill possible; take it out once `henri encryption:status` reports no plaintext left',
        type: 'boolean',
      },
    },
    type: 'object',
  },

  privacy: {
    describe: 'an object of personal data settings',
    hint: 'Which fields are personal is said in the models ({ personal: true }); this is what henri does with the mark',
    keys: {
      expose: {
        default: true,
        describe: 'true or false',
        hint: 'false keeps every personal field out of the answers henri builds, unless the field says { personal: { expose: true } }',
        type: 'boolean',
      },
      onErase: {
        default: 'anonymize',
        describe: `one of ${ON_ERASE.join(', ')}`,
        enum: ON_ERASE,
        hint: 'What happens to the records of an erased person, for the models that do not say it themselves',
        type: 'string',
      },
      receipts: {
        default: 'privacy',
        describe: 'a directory, or false to keep no receipt',
        hint: 'Where henri privacy:erase writes the proof that it ran; false leaves only what the command printed',
        oneOf: [{ const: false }, text()],
      },
    },
    type: 'object',
  },

  retention: {
    describe: 'an object of retention settings',
    hint: 'How long a model keeps its records is said in the model (options: { retention }); this is what runs the sweep and what it is allowed to do',
    keys: {
      approve: {
        default: true,
        describe: 'true or false',
        hint: 'true means a rule writes nothing until its token is in retention.approved; false is the deployment being the review',
        type: 'boolean',
      },
      approved: {
        default: [],
        describe: 'a list of rule tokens (Model:rule:digest)',
        hint: '`henri retention` prints the token of every rule; a rule whose terms change gets a new one and has to be approved again',
        of: text(),
        type: 'array',
      },
      batch: {
        default: 1000,
        describe: 'a whole number above zero, or false for no bound',
        hint: 'How many records one rule may take in one sweep; the rest is reported and taken by the next run',
        oneOf: [{ const: false }, { above: 0, integer: true, type: 'number' }],
      },
      receipts: {
        default: 'privacy',
        describe: 'a directory, or false to keep no receipt',
        hint: 'Where a sweep writes the proof that it ran; false leaves only what the command printed',
        oneOf: [{ const: false }, text()],
      },
      schedule: {
        default: false,
        describe:
          "a cron expression ('0 3 * * *') or an interval ('1d'), or false",
        hint: 'Needs @usehenri/jobs: henri registers the recurring henri/retention job. Without it, run henri retention:sweep --yes from cron',
        oneOf: [{ const: false }, text()],
      },
    },
    type: 'object',
  },

  timeZone: {
    default: 'UTC',
    describe: 'a IANA time zone name, or an object of time zone settings',
    hint: "The zone a server renders a moment in, never what it stores: storage is UTC on every adapter. Absent is UTC rather than the machine's zone, so what a person sees does not move when the application is deployed somewhere else",
    oneOf: [
      text(),
      {
        keys: {
          default: text({
            default: 'UTC',
            describe: 'the zone every answer is written in',
            hint: 'A name Intl knows: America/New_York, Europe/Paris, UTC. A zone this runtime has no rules for fails the boot rather than quietly answering in another one',
          }),
          from: {
            describe: 'an object saying where the zone of a request comes from',
            hint: 'The order is fixed: an explicit call, the user, the query, the cookie, the header, the default. Every step is off until it is named here, because there is no header a browser sends on its own',
            keys: {
              cookie: {
                default: false,
                describe: 'a cookie name, or false',
                hint: "henri reads it and never writes it: the script that asks the browser for Intl.DateTimeFormat().resolvedOptions().timeZone is the application's",
                oneOf: [{ const: false }, text()],
              },
              header: {
                default: false,
                describe: 'a request header name, or false',
                hint: 'There is no standard header for a zone, so henri invents none and reads whichever one the application decided to send. A zone off the wire may decide how a moment is printed and never what a person may see',
                oneOf: [{ const: false }, text()],
              },
              query: {
                default: false,
                describe: 'a query parameter name, or false',
                hint: 'The parameter of ?tz=Europe/Paris; useful for looking at a page the way somebody else sees it, and it makes the answer vary',
                oneOf: [{ const: false }, text()],
              },
              user: {
                default: null,
                describe: 'the column of the user model holding their zone',
                hint: 'This is also what a mail asks when it has the recipient and no request, which is the only thing a job can ask (see guides/time)',
                oneOf: [{ const: null }, text()],
              },
            },
            type: 'object',
          },
        },
        type: 'object',
      },
    ],
  },

  trail: {
    default: false,
    describe: 'an object of access trail settings, or false to keep none',
    hint: 'The trail is a table henri owns and appends to; it is off until this says otherwise',
    oneOf: [
      { const: false },
      {
        keys: {
          keep: keeps({
            default: '1y',
            hint: 'A trail of who touched personal data is personal data: false keeps it forever, which is a decision to make on purpose',
            oneOf: [{ const: false }, ...keeps().oneOf],
          }),
          reads: {
            default: false,
            describe: `one of ${READS.join(', ')}, or false to record no read`,
            hint: "'personal' records the answers carrying a model with a personal field; every read costs a round trip and an insert",
            oneOf: [{ const: false }, { enum: READS, type: 'string' }],
          },
          store: text({
            default: 'default',
            describe: 'the name of a store',
            hint: 'Which of config.stores the table lives in',
          }),
          table: {
            default: 'henri_trail',
            describe: 'a table name: letters, digits and underscores',
            hint: 'henri creates it on boot and only ever INSERTs and SELECTs',
            pattern: /^[A-Za-z_][A-Za-z0-9_]*$/u,
            type: 'string',
          },
        },
        type: 'object',
      },
    ],
  },

  calls: {
    default: false,
    describe: 'an object of call log settings, or false to keep none',
    hint: 'The call log holds request and response values; it is off until this says otherwise, and it is not the access trail (see the guide)',
    oneOf: [
      { const: false },
      {
        keys: {
          address: {
            default: {},
            describe:
              'an object ({ anonymize, header, from }), or false to record no address',
            hint: 'What henri believes about the client address, and when. X-Forwarded-For is config.trustProxy\'s business; a named header needs "from" as well, and a blanket "trustProxy": true records no client address at all',
            oneOf: [
              { const: false },
              {
                keys: {
                  anonymize: {
                    default: false,
                    describe: 'true or false',
                    hint: 'true drops the last octet of an IPv4 and the last 80 bits of an IPv6, keeping the prefix length in the value (203.0.113.0/24)',
                    type: 'boolean',
                  },
                  from: {
                    describe:
                      'a list of addresses or ranges (10.0.0.0/8, 2400:cb00::/32)',
                    hint: 'The proxies allowed to set the named header. Without it a header is text any client can send, so naming one fails the boot',
                    of: text(),
                    type: 'array',
                  },
                  header: {
                    describe: 'a header name (cf-connecting-ip)',
                    hint: 'A header express will not read on its own; it is only believed when the peer is one of "from". henri names none by default',
                    type: 'string',
                  },
                },
                type: 'object',
              },
            ],
          },
          always: {
            default: ['error'],
            describe: `a list of ${ALWAYS.join(', ')}, or an empty list`,
            hint: 'The outcomes sampling never drops. They are recorded without their bodies: the decision not to capture one was made before the status was known',
            of: { enum: ALWAYS, type: 'string' },
            type: 'array',
          },
          batch: {
            default: 500,
            describe: 'a whole number above zero',
            hint: 'How many buffered rows trigger a flush before the timer does',
            above: 0,
            integer: true,
            type: 'number',
          },
          bodies: {
            default: true,
            describe: 'true or false',
            hint: 'false keeps the timings, the statuses and the headers and captures no body at all',
            type: 'boolean',
          },
          buffer: {
            default: 1000,
            describe: 'a whole number above zero',
            hint: 'How many rows may wait to be written; past it a row is dropped and counted rather than queued forever',
            above: 0,
            integer: true,
            type: 'number',
          },
          flush: {
            default: 1000,
            describe: 'a number of milliseconds above zero',
            hint: 'How often the buffer is written',
            above: 0,
            integer: true,
            type: 'number',
          },
          ignore: {
            default: [],
            describe: 'a list of path prefixes',
            hint: 'Paths that are never recorded. The health probes never are, whatever this says',
            of: text(),
            type: 'array',
          },
          inbound: {
            default: true,
            describe: 'true or false',
            hint: 'false stops henri mounting the middleware at all',
            type: 'boolean',
          },
          keep: keeps({
            default: '30d',
            hint: 'A call log holds values, so keeping it forever is a decision to make on purpose; the retention sweep prunes it',
            oneOf: [{ const: false }, ...keeps().oneOf],
          }),
          maxBody: sizeLimit({
            default: '8kb',
            hint: 'How much of a body is stored before it is cut and marked truncated',
          }),
          maxPerSecond: {
            default: 100,
            describe: 'a whole number above zero, or false for no ceiling',
            hint: 'The absolute per-process ceiling: sampling is proportional and a burst is not, so this is what a spike runs into',
            oneOf: [
              { const: false },
              { above: 0, integer: true, type: 'number' },
            ],
          },
          outbound: {
            default: true,
            describe: 'true or false',
            hint: 'false makes henri.calls.track() and outbound() no-ops',
            type: 'boolean',
          },
          partition: {
            default: false,
            describe: `one of ${PARTITIONS.join(', ')}, or false`,
            hint: 'PostgreSQL and MySQL only: the sweep then drops a partition instead of deleting rows. Anything else fails the boot',
            oneOf: [{ const: false }, { enum: PARTITIONS, type: 'string' }],
          },
          partitionsAhead: {
            default: 7,
            describe: 'a whole number above zero',
            hint: 'How many periods are kept ready in front of the clock',
            above: 0,
            integer: true,
            type: 'number',
          },
          sample: {
            default: 1,
            describe: 'a fraction between 0 and 1',
            hint: 'The share of requests recorded, decided by a hash of the request id seeded with config.secret so the inbound call and its outbound calls agree',
            max: 1,
            min: 0,
            type: 'number',
          },
          store: text({
            default: 'default',
            describe: 'the name of a store',
            hint: 'Which of config.stores the table lives in',
          }),
          sweep: {
            default: 5000,
            describe: 'a whole number above zero',
            hint: 'How many rows one pass of the delete path takes at a time',
            above: 0,
            integer: true,
            type: 'number',
          },
          table: {
            default: 'henri_calls',
            describe: 'a table name: letters, digits and underscores',
            hint: 'henri creates it on boot; changing calls.partition afterwards needs a migration of your own',
            pattern: /^[A-Za-z_][A-Za-z0-9_]*$/u,
            type: 'string',
          },
        },
        type: 'object',
      },
    ],
  },

  queries: {
    describe:
      'an object of query seam settings, or false to record no model call',
    hint: 'What the adapters report running, and the repeated model calls the detector counts. On in development and in test, off in production, unless "enabled" says otherwise',
    oneOf: [
      { const: false },
      {
        keys: {
          callsites: {
            describe: 'true or false',
            hint: 'Whether an event carries the line the model call was made on. It costs an Error allocation per call, so it follows the detector unless this says otherwise',
            type: 'boolean',
          },
          detect: {
            default: {},
            describe:
              'an object of detector settings, or false to detect nothing',
            hint: 'false keeps the events and reports nothing; the seam is still there for onQuery()',
            oneOf: [
              { const: false },
              {
                keys: {
                  header: {
                    default: true,
                    describe: 'true or false',
                    hint: 'X-Henri-Queries on the answer, in development only: the counts and the names of the repeated calls, never a value',
                    type: 'boolean',
                  },
                  ignore: {
                    default: [],
                    describe:
                      'a list of Model, Model.operation or *.operation names',
                    hint: 'Calls the detector never counts. An operation is one of count, delete, insert, other, raw, select, update',
                    of: text(),
                    type: 'array',
                  },
                  log: {
                    default: true,
                    describe: 'true or false',
                    hint: 'One warning per request naming the call, the count, the line and what to do instead',
                    type: 'boolean',
                  },
                  raise: {
                    default: false,
                    describe: 'true or false',
                    hint: 'Throw HENRI_QUERIES_N_PLUS_ONE the moment the threshold is crossed, so the stack names the call. This is what makes a test suite fail on an N+1',
                    type: 'boolean',
                  },
                  threshold: {
                    default: 5,
                    describe: 'a whole number, at least 2',
                    hint: 'How many times the same model call has to run in one request before it is reported. It counts model calls, never statements',
                    integer: true,
                    min: 2,
                    type: 'number',
                  },
                },
                type: 'object',
              },
            ],
          },
          enabled: {
            describe: 'true or false',
            hint: 'Absent means on outside production. true is the production opt-in: every model call is timed and counted',
            type: 'boolean',
          },
        },
        type: 'object',
      },
    ],
  },

  versions: {
    default: {},
    describe: 'an object of model versioning settings',
    hint: 'This does not turn versioning on: a model does, with options: { versioned: true }. It says where the table lives and how long its rows are kept',
    keys: {
      keep: keeps({
        default: false,
        hint: 'A version holds the old values of a record, personal ones included, so keeping them forever is a decision to make on purpose; the retention sweep prunes them. false keeps them for as long as the application does',
        oneOf: [{ const: false }, ...keeps().oneOf],
      }),
      onErase: {
        default: 'follow',
        describe: `one of ${ON_VERSION_ERASE.join(', ')}`,
        hint: "'follow' takes the versions of a deleted record away and empties the erased values out of the versions of a record that survives; 'delete' takes them all; 'retain' leaves them and says so in the receipt",
        enum: ON_VERSION_ERASE,
        type: 'string',
      },
      store: text({
        default: 'default',
        describe: 'the name of a store',
        hint: 'Which of config.stores the table lives in',
      }),
      table: {
        default: 'henri_versions',
        describe: 'a table name: letters, digits and underscores',
        hint: 'henri creates it on the first boot where a model says versioned',
        pattern: /^[A-Za-z_][A-Za-z0-9_]*$/u,
        type: 'string',
      },
    },
    type: 'object',
  },

  bodyLimit: {
    default: '1mb',
    describe: 'a size, as a string ("1mb") or a number of bytes',
    hint: 'It bounds a JSON or urlencoded body; a multipart one is bounded by uploads.maxTotalSize and uploads.maxFileSize instead',
    oneOf: [text(), positive({ describe: 'a number of bytes above zero' })],
  },

  uploads: {
    describe: 'an object of upload settings, or false to accept no file',
    hint: 'Uploads are read by @usehenri/uploads, which the application installs; every key is optional',
    oneOf: [
      { const: false },
      {
        keys: {
          allow: {
            describe:
              "a list of media types ('image/png', 'image/*'), matched against what the bytes say",
            hint: 'Without it every type is accepted; the type never comes from the extension',
            of: text(),
            type: 'array',
          },
          maxFieldNameSize: {
            default: 100,
            describe: 'a whole number of bytes, above zero',
            hint: 'The name of a form field; uploads.maxFieldSize is what bounds its value',
            integer: true,
            min: 1,
            type: 'number',
          },
          maxFieldSize: sizeLimit({
            hint: 'One non-file part of the form; defaults to config.bodyLimit',
          }),
          maxFields: limit(100, {
            hint: 'How many non-file fields one request may carry; false lifts the bound',
          }),
          maxFileSize: sizeLimit({
            default: '10mb',
            hint: 'The largest single file; uploads.maxTotalSize is what bounds all the parts together',
          }),
          maxFilenameLength: {
            default: 255,
            describe: 'a whole number of characters, above zero',
            hint: 'How much of the original name is kept as metadata; the stored name is generated',
            integer: true,
            min: 1,
            type: 'number',
          },
          maxFiles: limit(10, {
            hint: 'How many files one request may carry; false lifts the bound',
          }),
          maxTotalSize: sizeLimit({
            default: '25mb',
            hint: 'Every part together, checked against Content-Length before a parser is built and then counted as the bytes arrive',
          }),
          paths: {
            describe: "a list of path prefixes ('/api/artworks')",
            hint: 'Without it a multipart body is read on every route that takes one',
            of: text({ pattern: /^\//u }),
            type: 'array',
          },
          root: text({
            default: 'storage/uploads',
            describe: 'a directory, relative to the application',
            hint: 'It must be outside app/views/public, which express serves',
          }),
          sniff: {
            default: true,
            describe: 'true or false',
            hint: 'false trusts the Content-Type the client sent, which is not evidence',
            type: 'boolean',
          },
          storage: {
            default: 'local',
            describe:
              "a backend name ('local', 's3'), the module id of a HenriStorage, or an object naming one ({ adapter, ... })",
            hint: 'A name that is not local resolves @usehenri/<name> from the application: pnpm add @usehenri/s3',
            oneOf: [
              text(),
              {
                keys: {
                  adapter: {
                    describe:
                      "a backend name ('s3'), or the module id of a HenriStorage",
                    hint: "A name that is not local resolves @usehenri/<name> from the application; the keys next to it are that backend's own (a bucket, a region, an endpoint) and henri reads none of them",
                    required: true,
                    type: 'string',
                  },
                },
                // Everything else is the backend's own (a bucket, a region,
                // an endpoint), which henri does not own and does not read
                type: 'object',
                unknown: 'near',
              },
            ],
          },
          urls: {
            default: false,
            describe:
              'an object of signed url settings, or false to hand out none',
            hint: 'A signed url hands a file to whoever holds the link, with no session and no policy, until it expires: it is off until this says otherwise',
            oneOf: [
              { const: false },
              {
                keys: {
                  cdn: text({
                    describe:
                      "a base url henri's own signed urls are built against",
                    hint: "The host is outside henri's signature, so a cache may sit in front of the route; a storage that signs its own names its public host in its own block instead",
                  }),
                  expiresIn: {
                    default: 300,
                    describe:
                      'a whole number of seconds, from 1 to 604800 (a week)',
                    hint: 'Until it expires the url is a bearer capability: whoever holds the link gets the file, with no session and no policy. A week is the ceiling because it is what S3 honours',
                    integer: true,
                    max: 604800,
                    min: 1,
                    type: 'number',
                  },
                  path: text({
                    default: '/_uploads',
                    describe:
                      'a path, where the route verifying them is mounted',
                    hint: 'Only used by a storage that signs no url of its own, which is the local disk',
                    pattern: /^\//u,
                  }),
                },
                type: 'object',
              },
            ],
          },
          variants: {
            describe: 'an object of derived images, by name',
            hint: 'A variant is derived once, on demand, and needs sharp in the application: pnpm add sharp',
            type: 'record',
            values: {
              hint: 'A variant needs a width, a height, or both',
              keys: {
                fit: {
                  default: 'cover',
                  describe: 'one of contain, cover, fill, inside, outside',
                  hint: "sharp's, and it decides how the box is filled: cover crops to it, contain fits inside it and pads, fill stretches",
                  enum: ['contain', 'cover', 'fill', 'inside', 'outside'],
                  type: 'string',
                },
                format: {
                  default: 'webp',
                  describe: 'one of avif, jpeg, png, webp',
                  hint: 'What the variant is encoded as, whatever the source was. The build of libvips has to carry it: avif is in the prebuilt binaries and missing from some distribution packages',
                  enum: ['avif', 'jpeg', 'png', 'webp'],
                  type: 'string',
                },
                height: {
                  describe: 'a whole number of pixels, from 1 to 8192',
                  hint: 'With `width` it is the box `fit` fills; one of the two is enough, and a variant needs at least one',
                  integer: true,
                  max: 8192,
                  min: 1,
                  type: 'number',
                },
                quality: {
                  default: 80,
                  describe: 'a whole number from 1 to 100',
                  hint: 'What the encoder is asked for; it does not mean the same thing in two formats, so it is worth setting next to `format`',
                  integer: true,
                  max: 100,
                  min: 1,
                  type: 'number',
                },
                width: {
                  describe: 'a whole number of pixels, from 1 to 8192',
                  hint: 'With `height` it is the box `fit` fills; one of the two is enough, and a variant needs at least one',
                  integer: true,
                  max: 8192,
                  min: 1,
                  type: 'number',
                },
              },
              type: 'object',
            },
          },
        },
        type: 'object',
      },
    ],
  },

  requestTimeout: {
    default: 30000,
    describe: 'a number of milliseconds above zero, or false',
    hint: 'A request with no answer by then is sent a 503, and nothing is sent once the headers are out (a stream, an event source). The handler keeps running either way: req.timedout is what it can read before doing more work',
    oneOf: [{ const: false }, positive()],
  },

  shutdown: {
    describe: 'an object of graceful shutdown settings',
    hint: 'Keep shutdown.delay plus shutdown.drain under the termination grace period of the platform, which is thirty seconds on Kubernetes, so the process leaves before it is killed',
    keys: {
      delay: {
        default: 0,
        describe: 'a number of milliseconds, zero or more',
        hint: 'How long to keep serving after readiness turns 503, before the port closes',
        min: 0,
        type: 'number',
      },
      drain: {
        default: 10000,
        describe: 'a number of milliseconds, zero or more',
        hint: 'How long the requests in flight get before their socket is closed',
        min: 0,
        type: 'number',
      },
      signals: {
        default: true,
        describe: 'true or false',
        hint: 'false leaves SIGINT and SIGTERM to the application',
        type: 'boolean',
      },
    },
    type: 'object',
  },

  maintenance: {
    describe: 'an object of maintenance settings, or false to have no switch',
    hint: 'Maintenance is thrown from a shell (henri maintenance:on), not from a deploy; this is only where the switch lives and what the visitor is told',
    oneOf: [
      { const: false },
      {
        keys: {
          bypass: {
            default: 'token',
            describe: `one of ${MAINTENANCE_BYPASSES.join(', ')}`,
            hint: "'loopback' also lets anything connecting from this machine through, which is wrong when a reverse proxy runs on it; henri audit reports the pair",
            enum: MAINTENANCE_BYPASSES,
            type: 'string',
          },
          file: text({
            default: '.henri/maintenance.json',
            describe: 'a path, relative to the application',
            hint: 'Where the switch is written when it is not in the shared store; it reaches the processes on that machine and no other',
          }),
          message: text({
            describe: 'what a visitor is told',
            hint: 'The default for every window; henri maintenance:on --message says it for one',
          }),
          page: text({
            default: 'app/views/maintenance.html',
            describe: 'a path to an html file, relative to the application',
            hint: 'Read as it is, with {{message}}, {{retryAfter}} and {{since}} replaced; henri ships a page for when there is none',
          }),
          poll: {
            default: 1000,
            describe: 'a number of milliseconds, zero or more',
            hint: 'How stale the switch may be in a running process; zero re-reads it on every request',
            min: 0,
            type: 'number',
          },
          readyz: {
            default: 'ready',
            describe: `one of ${MAINTENANCE_READYZ.join(', ')}`,
            hint: "'ready' keeps the traffic coming so the maintenance page is what a visitor sees; 'unavailable' takes every process out of the pool at once, which hands the visitor the proxy's own error page",
            enum: MAINTENANCE_READYZ,
            type: 'string',
          },
          retryAfter: {
            default: 300,
            describe: 'a number of seconds, at least one',
            hint: 'The Retry-After of the 503; henri maintenance:on --retry-after says it for one window',
            above: 0,
            type: 'number',
          },
          switch: {
            default: 'auto',
            describe: `one of ${MAINTENANCE_SWITCHES.join(', ')}`,
            hint: "'auto' is the shared store when config.shared names one and a file otherwise, which is what the boot line says",
            enum: MAINTENANCE_SWITCHES,
            type: 'string',
          },
        },
        type: 'object',
      },
    ],
  },

  errors: {
    describe: 'an object of error code settings',
    hint: 'The one key is `url`, the template that turns a code into a link; the codes themselves are always there and this block only decides whether a message carries an address',
    keys: {
      url: {
        describe: 'a url template holding {code}',
        hint: 'Unset by default: nothing prints a link. Point it at wherever the catalogue of https://usehenri.io/reference/errors/ is published (https://example.com/e/{code})',
        pattern: /\{code\}/u,
        type: 'string',
      },
    },
    type: 'object',
  },
};

module.exports = {
  ADAPTERS,
  ALWAYS,
  BOUNDARIES,
  CLIENTS,
  DIALECTS,
  LOG_FORMATS,
  MAINTENANCE_BYPASSES,
  MAINTENANCE_READYZ,
  MAINTENANCE_SWITCHES,
  MISSING,
  PARTITIONS,
  READS,
  RENDERERS,
  SCHEMA,
  STORE,
};
