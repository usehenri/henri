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
      hint: 'SQL: false stops a development boot from bringing the schema up; on a Sequelize store true also lets a production boot create the tables that are missing, which it otherwise refuses to do',
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
                    hint: 'defaults to rateLimit.store, then to config.shared; without any the count is per process',
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
        keys: {
          base: duration({ default: '10s' }),
          factor: positive({ default: 3, describe: 'a number above zero' }),
          jitter: {
            default: 0.2,
            describe: 'a number between 0 and 1',
            max: 1,
            min: 0,
            type: 'number',
          },
          max: duration({ default: '6h' }),
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
      queue: text({ default: 'webhooks', describe: 'a queue name' }),
      store: text({
        default: 'default',
        describe: 'the name of a store of `stores`',
      }),
      table: text({
        default: 'henri_webhooks',
        describe: 'a table name: letters, digits and underscores only',
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
            hint: 'defaults to config.shared; without one the count is per process',
            oneOf: [{ const: null }, text()],
          },
          windowMs: positive({ default: 60000 }),
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
      url: text({ describe: 'a connection string (redis://, rediss://)' }),
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

  helmet: {
    describe: 'an object of helmet options, or false to disable helmet',
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
    oneOf: [{ const: false }, { of: text(), type: 'array' }],
  },

  logs: {
    describe: 'an object of log settings',
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
            integer: true,
            min: 1,
            type: 'number',
          },
          maxFieldSize: sizeLimit({
            hint: 'One non-file part of the form; defaults to config.bodyLimit',
          }),
          maxFields: limit(100),
          maxFileSize: sizeLimit({ default: '10mb' }),
          maxFilenameLength: {
            default: 255,
            describe: 'a whole number of characters, above zero',
            hint: 'How much of the original name is kept as metadata; the stored name is generated',
            integer: true,
            min: 1,
            type: 'number',
          },
          maxFiles: limit(10),
          maxTotalSize: sizeLimit({ default: '25mb' }),
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
                  enum: ['contain', 'cover', 'fill', 'inside', 'outside'],
                  type: 'string',
                },
                format: {
                  default: 'webp',
                  describe: 'one of avif, jpeg, png, webp',
                  enum: ['avif', 'jpeg', 'png', 'webp'],
                  type: 'string',
                },
                height: {
                  describe: 'a whole number of pixels, from 1 to 8192',
                  integer: true,
                  max: 8192,
                  min: 1,
                  type: 'number',
                },
                quality: {
                  default: 80,
                  describe: 'a whole number from 1 to 100',
                  integer: true,
                  max: 100,
                  min: 1,
                  type: 'number',
                },
                width: {
                  describe: 'a whole number of pixels, from 1 to 8192',
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
};

module.exports = {
  ADAPTERS,
  ALWAYS,
  BOUNDARIES,
  CLIENTS,
  DIALECTS,
  LOG_FORMATS,
  MISSING,
  PARTITIONS,
  READS,
  RENDERERS,
  SCHEMA,
  STORE,
};
