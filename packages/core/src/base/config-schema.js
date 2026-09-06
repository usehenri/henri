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

/** A number strictly above zero */
const positive = (extra = {}) => ({
  above: 0,
  describe: 'a number of milliseconds above zero',
  type: 'number',
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

  user: {
    describe:
      'the name of the user model, or an object ({ model, public, loginPath, afterLogin, sessionMaxAge })',
    oneOf: [
      text(),
      {
        keys: {
          afterLogin: text({
            default: '/',
            describe: 'a path to land on after a form login',
          }),
          loginPath: text({
            default: '/login',
            describe: 'a path to send denied browsers to',
          }),
          model: text({ default: 'user', describe: 'the user model name' }),
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
    describe: 'true or false',
    hint: 'false disables the double-submit CSRF protection',
    type: 'boolean',
  },

  graphql: text({
    default: '/_henri/gql',
    describe: 'a path starting with /',
    pattern: /^\//u,
  }),

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

  requestTimeout: {
    default: 30000,
    describe: 'a number of milliseconds above zero, or false',
    oneOf: [{ const: false }, positive()],
  },
};

module.exports = { ADAPTERS, DIALECTS, RENDERERS, SCHEMA, STORE };
