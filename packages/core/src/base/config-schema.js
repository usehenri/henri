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

/** A string that is not empty */
const text = (extra = {}) => ({ pattern: /\S/u, type: 'string', ...extra });

/** One bound of the graphql endpoint: a whole number, or false to lift it */
const limit = (value) => ({
  default: value,
  describe: 'a whole number above zero, or false',
  oneOf: [{ const: false }, { above: 0, integer: true, type: 'number' }],
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

/** One entry of `stores`: an adapter and how to reach its database */
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
    database: text({ describe: 'a database name' }),
    dbName: text({ default: 'henri', describe: 'a database name (disk)' }),
    dialect: {
      describe: `one of ${DIALECTS.join(', ')} (drizzle)`,
      enum: DIALECTS,
      hint: 'The application installs the driver: better-sqlite3, pg or mysql2',
      type: 'string',
    },
    host: text({ describe: 'a host name (or a url, on mongoose)' }),
    migrate: {
      describe: 'true or false',
      hint: 'drizzle: true applies db/migrations on a production boot',
      type: 'boolean',
    },
    opts: {
      describe: 'an object of mongoose.connect() options',
      type: 'object',
      unknown: 'allow',
    },
    password: { type: 'string' },
    path: text({
      default: '.henri/data',
      describe: 'a data directory, relative to the application (disk)',
    }),
    port: {
      describe: 'a port number between 1 and 65535',
      integer: true,
      max: 65535,
      min: 1,
      type: 'number',
    },
    session: {
      describe: 'an object of session store options',
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
      hint: 'drizzle: false stops a development boot from pushing the schema',
      type: 'boolean',
    },
    url: text({ describe: 'a connection string' }),
    username: { type: 'string' },
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
    keys: {
      entry: text({
        default: 'main.jsx',
        describe: 'a client entry, relative to app/views',
      }),
      id: text({ default: 'app', describe: 'the id of the root element' }),
      ssr: { default: true, type: 'boolean' },
      ssrEntry: text({
        default: 'ssr.jsx',
        describe: 'a server entry, relative to app/views',
      }),
      template: text({
        default: 'index.html',
        describe: 'an html shell, relative to app/views',
      }),
    },
    type: 'object',
  },

  experimental: {
    describe: 'an object of renderer opt-ins',
    keys: { vue: { type: 'boolean' } },
    type: 'object',
  },

  stores: {
    describe: 'an object of named stores',
    hint: 'A model picks one with its `store` key, or uses `default`',
    type: 'record',
    values: STORE,
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
    oneOf: [
      text(),
      {
        keys: {
          afterLogin: text({
            default: '/',
            describe: 'a path to land on after a form login',
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
                  }),
                  path: text({
                    default: '/confirm',
                    describe: 'the prefix of the confirmation endpoints',
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
                    integer: true,
                    min: 1,
                    type: 'number',
                  },
                  store: {
                    describe:
                      'the module id of an express-rate-limit store, or of a (henri, { name }) => store factory',
                    hint: 'defaults to rateLimit.store; without one the count is per process',
                    oneOf: [{ const: null }, text()],
                  },
                  windowMs: positive({
                    default: 900000,
                    describe: 'a window in milliseconds',
                  }),
                },
                type: 'object',
              },
            ],
          },
          loginPath: text({
            default: '/login',
            describe: 'a path to send denied browsers to',
          }),
          model: text({ default: 'user', describe: 'the user model name' }),
          password: {
            describe: 'the password policy and the hashing parameters',
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
                integer: true,
                min: 8,
                type: 'number',
              },
              minLength: {
                default: 12,
                describe: 'a password length, at least 8',
                integer: true,
                min: 8,
                type: 'number',
              },
              parallelism: {
                default: 1,
                describe: 'a number of argon2id lanes, at least 1',
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
                      current: text({ describe: 'the key in force' }),
                      previous: {
                        describe: 'a list of keys it replaced',
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
    oneOf: [text(), { of: text(), type: 'array' }],
  },

  trustProxy: {
    default: true,
    describe:
      "express' trust proxy setting: a boolean, a hop count or a list of addresses",
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
          maxAliases: limit(15),
          maxComplexity: limit(1000),
          maxDepth: limit(10),
          maxTokens: limit(5000),
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
    oneOf: [{ const: 'test' }, { type: 'object', unknown: 'allow' }],
  },

  mailers: {
    describe: 'an object of mailer defaults',
    keys: {
      from: text({ describe: 'a sender address' }),
      layout: {
        default: 'mailer',
        describe:
          'the name of a layout in app/views/mailers/layouts, or false for none',
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

  api: {
    describe: 'an object of JSON API settings',
    keys: {
      idempotency: {
        describe:
          'false, or an object ({ ttl, store }) of Idempotency-Key settings',
        oneOf: [
          { const: false },
          {
            keys: {
              store: {
                describe:
                  'the module id of a shared { get, set, delete } store',
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
      maxPerPage: {
        default: 100,
        describe: 'a whole number of records, above zero',
        integer: true,
        min: 1,
        type: 'number',
      },
      perPage: {
        default: 25,
        describe: 'a whole number of records, above zero',
        integer: true,
        min: 1,
        type: 'number',
      },
      strict: {
        default: false,
        describe: 'true or false',
        hint: 'true refuses (500) a JSON answer without _links',
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
        keys: {
          base: duration({ default: '5s' }),
          factor: positive({ default: 4, describe: 'a number above zero' }),
          jitter: {
            default: 0.15,
            describe: 'a number between 0 and 1',
            max: 1,
            min: 0,
            type: 'number',
          },
          max: duration({ default: '1h' }),
        },
        type: 'object',
      },
      concurrency: {
        default: 5,
        describe: 'a whole number of jobs, above zero',
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
      keepCompleted: duration({ default: '1d' }),
      mailQueue: text({ default: 'mailers', describe: 'a queue name' }),
      maxArgsBytes: {
        default: 524288,
        describe: 'a whole number of bytes, above zero',
        integer: true,
        min: 1,
        type: 'number',
      },
      maxAttempts: {
        default: 5,
        describe: 'a whole number of attempts, above zero',
        integer: true,
        min: 1,
        type: 'number',
      },
      pollInterval: duration({ default: '1s' }),
      priority: {
        default: 0,
        describe: 'a number (the higher, the sooner)',
        type: 'number',
      },
      queue: text({ default: 'default', describe: 'a queue name' }),
      queues: {
        describe: "a list of queue names, or one string ('a,b')",
        oneOf: [text(), { of: text(), type: 'array' }],
      },
      recurring: {
        describe: 'an object of schedules, by name',
        type: 'record',
        values: {
          hint: 'A schedule needs a "cron" or an "every", never both',
          keys: {
            args: { describe: 'the arguments of the job', type: 'any' },
            cron: text({ describe: 'a cron expression, read in UTC' }),
            every: duration(),
            job: text({
              describe: 'the job name (the schedule name by default)',
            }),
            name: text({ describe: 'an alias of `job`' }),
            priority: { describe: 'a number', type: 'number' },
            queue: text({ describe: 'a queue name' }),
          },
          type: 'object',
        },
      },
      store: text({
        default: 'default',
        describe: 'the name of a store of `stores`',
      }),
      stuckAfter: duration({ default: '5m' }),
      table: text({
        default: 'henri_jobs',
        describe: 'a table name: letters, digits and underscores only',
        pattern: /^[A-Za-z_][A-Za-z0-9_]*$/u,
      }),
      timeout: {
        describe: "a duration, or null for 'no limit'",
        oneOf: [{ const: null }, duration()],
      },
    },
    type: 'object',
  },

  rateLimit: {
    describe: 'an object of limits, true for the defaults, or false for none',
    oneOf: [
      { type: 'boolean' },
      {
        keys: {
          auth: {
            describe:
              'false, or an object ({ windowMs, max, paths }) for the login paths',
            oneOf: [
              { const: false },
              {
                keys: {
                  limit: positive({ describe: 'an alias of max' }),
                  max: positive({
                    default: 10,
                    describe: 'a number of requests per window, above zero',
                  }),
                  paths: {
                    describe: 'a list of paths to guard',
                    of: text(),
                    type: 'array',
                  },
                  windowMs: positive({ default: 60000 }),
                },
                type: 'object',
              },
            ],
          },
          limit: positive({ describe: 'an alias of max' }),
          max: positive({
            default: 600,
            describe: 'a number of requests per window, above zero',
          }),
          store: {
            describe:
              'the module id of an express-rate-limit store, or of a (henri, { name }) => store factory',
            oneOf: [{ const: null }, text()],
          },
          windowMs: positive({ default: 60000 }),
        },
        type: 'object',
      },
    ],
  },

  helmet: {
    describe: 'an object of helmet options, or false to disable helmet',
    oneOf: [{ const: false }, { type: 'object', unknown: 'allow' }],
  },

  filterParameters: {
    default: ['password', 'token', 'secret', 'authorization'],
    describe: 'a list of parameter names to mask, or false',
    oneOf: [{ const: false }, { of: text(), type: 'array' }],
  },

  bodyLimit: {
    default: '1mb',
    describe: 'a size, as a string ("1mb") or a number of bytes',
    oneOf: [text(), positive({ describe: 'a number of bytes above zero' })],
  },

  errors: {
    describe: 'an object of error code settings',
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

  requestTimeout: {
    default: 30000,
    describe: 'a number of milliseconds above zero, or false',
    oneOf: [{ const: false }, positive()],
  },

  shutdown: {
    describe: 'an object of graceful shutdown settings',
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
};

module.exports = { ADAPTERS, DIALECTS, RENDERERS, SCHEMA, STORE };
