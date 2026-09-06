const fs = require('fs');
const path = require('path');

const { SCHEMA, STORE } = require('../base/config-schema');
const {
  ConfigurationError,
  coercionFor,
  describe: describeNode,
  distance,
  format,
  nearest,
  nodeAt,
  received,
  validate,
} = require('../base/config-validate');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/** The keys of the `user` object form, the second branch of its union */
const userKeys = () => Object.keys(SCHEMA.user.oneOf[1].keys);

/** The keys of `user.password`, and of `user.lockout`'s object form */
const passwordKeys = () => Object.keys(SCHEMA.user.oneOf[1].keys.password.keys);
const lockoutKeys = () =>
  Object.keys(SCHEMA.user.oneOf[1].keys.lockout.oneOf[1].keys);

/** The keys of the object form of one of the account flows */
const flowKeys = (name) =>
  Object.keys(SCHEMA.user.oneOf[1].keys[name].oneOf[1].keys);

/** The keys of the object forms of `csrf` and `graphql` */
const csrfKeys = () => Object.keys(SCHEMA.csrf.oneOf[1].keys);
const graphqlKeys = () => Object.keys(SCHEMA.graphql.oneOf[1].keys);

/** The keys of the `rateLimit` object form */
const rateLimitKeys = () => Object.keys(SCHEMA.rateLimit.oneOf[1].keys);

/** The keys of the `uploads` object form */
const uploadsKeys = () => Object.keys(SCHEMA.uploads.oneOf[1].keys);

/**
 * The member names of an interface of index.d.ts, at its own level (the
 * keys of an inline object type are not members of the interface)
 *
 * @param {string} source the content of index.d.ts
 * @param {string} name the interface name
 * @returns {Array<string>} the member names
 */
const members = (source, name) => {
  const start = source.indexOf(`interface ${name} {`);

  expect(start).toBeGreaterThan(-1);

  const found = [];
  let depth = 0;

  for (const line of source.slice(start).split('\n').slice(1)) {
    const opens = (line.match(/\{/gu) || []).length;
    const closes = (line.match(/\}/gu) || []).length;

    if (depth === 0) {
      const match = /^\s{4}(\w+)\??:/u.exec(line);

      if (match) {
        found.push(match[1]);
      }
    }

    depth += opens - closes;

    if (depth < 0) {
      break;
    }
  }

  return found;
};

/**
 * The keys named in the main table of the documentation page
 *
 * @param {string} source the content of configuration.md
 * @returns {Array<string>} the keys
 */
const documented = (source) => {
  const section = source.slice(source.indexOf('\n## Keys'));
  const table = section.slice(0, section.indexOf('\n## ', 1));

  return [...table.matchAll(/^\|\s*`([A-Za-z]\w*)`\s*\|/gmu)].map(
    (match) => match[1]
  );
};

/**
 * Every config/*.json of this repository, as [label, parsed] pairs
 *
 * @returns {Array<Array>} the configurations
 */
const configurations = () => {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (
          ![
            '.claude',
            '.git',
            '.henri',
            '.next',
            '.tmp',
            'coverage',
            'dist',
            'node_modules',
          ].includes(entry.name)
        ) {
          walk(full);
        }
        continue;
      }

      if (
        path.basename(dir) === 'config' &&
        entry.name.endsWith('.json') &&
        !entry.name.startsWith('.')
      ) {
        found.push([
          path.relative(ROOT, full),
          JSON.parse(fs.readFileSync(full, 'utf8')),
        ]);
      }
    }
  };

  walk(ROOT);

  return found;
};

describe('the configuration schema', () => {
  test('accepts every configuration of this repository', () => {
    const files = configurations();

    expect(files.length).toBeGreaterThan(4);

    for (const [label, config] of files) {
      const { errors } = validate(config, { source: () => label });

      expect(errors.map((problem) => `${label}: ${problem.message}`)).toEqual(
        []
      );
    }
  });

  test('takes the shapes the documentation shows', () => {
    const { errors, warnings } = validate({
      api: { idempotency: { store: null, ttl: 86400000 }, maxPerPage: 50 },
      baseRole: ['guest', 'member'],
      bodyLimit: '2mb',
      cors: { origin: 'https://example.com' },
      csp: { nonce: true },
      csrf: false,
      experimental: { vue: true },
      externalIds: { lookup: 'external', references: true },
      filterParameters: false,
      graphql: '/_henri/gql',
      helmet: false,
      host: '0.0.0.0',
      inertia: { entry: 'main.jsx', ssr: true },
      mail: 'test',
      mailers: { from: 'Acme <no-reply@acme.com>', layout: false },
      policies: { status: 403, verify: true },
      port: 3000,
      privacy: { expose: true, onErase: 'anonymize', receipts: 'privacy' },
      rateLimit: { auth: false, max: 10, store: './lib/limit' },
      renderer: 'vue',
      requestTimeout: false,
      secret: 'a-secret',
      shared: {
        adapter: 'redis',
        onError: 'open',
        prefix: 'lineup:',
        url: 'redis://127.0.0.1:6379',
      },
      shutdown: { delay: 5000, drain: 20000, signals: false },
      stores: {
        default: {
          adapter: 'drizzle',
          dialect: 'postgres',
          url: 'postgres://',
        },
        legacy: { adapter: 'mysql', logging: false, pool: { max: 5 } },
      },
      trustProxy: 2,
      uploads: {
        allow: ['image/png', 'image/*'],
        maxFileSize: '5mb',
        maxFiles: 3,
        maxTotalSize: 20971520,
        paths: ['/artworks'],
        root: 'storage/uploads',
        sniff: true,
        storage: 'local',
      },
      user: {
        afterLogin: '/',
        lockout: { max: 10, windowMs: 900000 },
        model: 'user',
        password: { minLength: 16, pepper: { current: 'a-key' } },
        public: ['name'],
      },
      webhooks: {
        allowHttp: false,
        allowPrivate: false,
        backoff: { base: '10s', factor: 3, jitter: 0.2, max: '6h' },
        maxAttempts: 8,
        queue: 'webhooks',
        table: 'henri_webhooks',
        timeout: '10s',
      },
    });

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('refuses a value of the wrong type, naming the key and what arrived', () => {
    const { errors } = validate(
      { port: 'eight thousand' },
      { source: () => 'config/default.json' }
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      expected: 'a port number between 1 and 65535',
      key: 'port',
      level: 'error',
      received: 'the string "eight thousand"',
      source: 'config/default.json',
    });
    expect(errors[0].message).toBe(
      '"port" must be a port number between 1 and 65535, but it is the string "eight thousand"'
    );
    expect(errors[0].hint).toContain('{ "port": 3000 }');
  });

  test('reports every problem, not the first one', () => {
    const { errors } = validate({
      csrf: 'yes',
      port: 0,
      renderer: 'preact',
      requestTimeout: -1,
      stores: { default: { adapter: 'redis' } },
    });

    expect(errors.map((problem) => problem.key).sort()).toEqual([
      'csrf',
      'port',
      'renderer',
      'requestTimeout',
      'stores.default.adapter',
    ]);
  });

  test('a store needs an adapter, and only one henri can load', () => {
    const { errors } = validate({ stores: { default: { url: 'x' } } });

    expect(errors[0].key).toBe('stores.default.adapter');
    expect(errors[0].message).toContain('is missing');
  });

  test('an unknown key is a warning, a near miss suggests the right one', () => {
    const { errors, warnings } = validate({
      appName: 'lineup',
      rateLimits: false,
      renderers: 'react',
      trustproxy: true,
    });

    expect(errors).toEqual([]);
    expect(warnings.map((problem) => [problem.key, problem.hint])).toEqual([
      [
        'appName',
        'henri ignores it; remove it, or keep it if the application reads it with henri.config.get()',
      ],
      ['rateLimits', 'Rename it to "rateLimit", or remove it'],
      ['renderers', 'Rename it to "renderer", or remove it'],
      ['trustproxy', 'Rename it to "trustProxy", or remove it'],
    ]);
  });

  test('a store forwards what it does not know, but says so on a near miss', () => {
    const { warnings } = validate({
      stores: {
        default: {
          adapter: 'mysql',
          dialectOptions: {},
          logging: false,
          pool: { max: 5 },
          urls: 'mysql://',
        },
      },
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('did you mean "stores.default.url"?');
    expect(warnings[0].hint).toBe(
      'Rename it to "stores.default.url", or remove it'
    );
  });

  test('the vue renderer needs its experimental flag', () => {
    expect(validate({ renderer: 'vue' }).errors[0].key).toBe('renderer');
    expect(
      validate({ experimental: { vue: true }, renderer: 'vue' }).errors
    ).toEqual([]);
  });

  test('a value that must not be printed shows as its type', () => {
    const { errors } = validate(
      { secret: 42 },
      { mask: (key) => key === 'secret' }
    );

    expect(errors[0].message).toContain('a number');
    expect(errors[0].message).not.toContain('42');
  });

  test('the password of a connection string is always masked', () => {
    expect(received('postgres://henri:hunter2@db:5432/app')).toBe(
      'the string "postgres://henri:[FILTERED]@db:5432/app"'
    );
  });

  test('a configuration that is not an object is refused', () => {
    expect(validate(null).errors[0].message).toContain('must be an object');
    expect(validate([]).errors[0].message).toContain('must be an object');
  });

  test('ConfigurationError carries the problems and the command line code', () => {
    const { errors } = validate({ port: 'nope' }, { source: () => '.env' });
    const error = new ConfigurationError(errors);

    expect(error.code).toBe('HENRI_CONFIG_INVALID');
    expect(error.exitCode).toBe(1);
    expect(error.problems).toBe(errors);
    // The message is one line: whoever prints it has the problems too
    expect(error.message).toBe('invalid configuration (1 problem): port');
    expect(format(error.problems)).toContain('(from .env)');
  });
});

describe('reading the schema', () => {
  test('nodeAt walks records and the branches of a union', () => {
    expect(nodeAt('port').type).toBe('number');
    expect(nodeAt('stores.reporting.adapter').enum).toContain('mongoose');
    expect(nodeAt('user.sessionMaxAge').type).toBe('number');
    expect(nodeAt('rateLimit.auth.max').type).toBe('number');
    expect(nodeAt('mail.host')).toBeNull();
    expect(nodeAt('whatever')).toBeNull();
  });

  test('coercionFor types an environment variable from the schema', () => {
    expect(coercionFor('port', '8080')).toBe('number');
    expect(coercionFor('csrf', 'false')).toBe('boolean');
    expect(coercionFor('stores.a.url', '5432')).toBe('string');
    expect(coercionFor('requestTimeout', 'false')).toBe('boolean');
    expect(coercionFor('requestTimeout', '5000')).toBe('number');
    // Nothing plausible: the value reaches the validator, whose message
    // names the key and what was expected
    expect(coercionFor('port', 'nope')).toBeNull();
    expect(coercionFor('mail.host', 'smtp')).toBeNull();
  });

  test('nearest only suggests a name that is actually close', () => {
    expect(distance('renderers', 'renderer')).toBe(1);
    expect(nearest('pool', Object.keys(STORE.keys))).toBeNull();
    expect(nearest('adaptor', Object.keys(STORE.keys))).toBe('adapter');
  });

  test('describe says what a key accepts', () => {
    expect(describeNode(SCHEMA.port)).toBe('a port number between 1 and 65535');
    expect(describeNode({ type: 'boolean' })).toBe('true or false');
    expect(describeNode({ enum: ['a', 'b'], type: 'string' })).toBe(
      'one of a, b'
    );
    expect(describeNode({ const: false })).toBe('false');
  });
});

describe('the schema, the declarations and the documentation', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'packages', 'core', 'index.d.ts'),
    'utf8'
  );

  test.each([
    ['Configuration', () => Object.keys(SCHEMA)],
    ['StoreConfig', () => Object.keys(STORE.keys)],
    ['UserConfig', userKeys],
    ['PasswordConfig', passwordKeys],
    ['LockoutConfig', lockoutKeys],
    ['SignupConfig', () => flowKeys('signup')],
    ['PasswordResetConfig', () => flowKeys('passwordReset')],
    ['ConfirmationConfig', () => flowKeys('confirmation')],
    ['CsrfConfig', csrfKeys],
    ['GraphqlConfig', graphqlKeys],
    ['ApiConfig', () => Object.keys(SCHEMA.api.keys)],
    ['ExternalIdsConfig', () => Object.keys(SCHEMA.externalIds.keys)],
    ['PoliciesConfig', () => Object.keys(SCHEMA.policies.keys)],
    ['PrivacyConfig', () => Object.keys(SCHEMA.privacy.keys)],
    ['RetentionConfig', () => Object.keys(SCHEMA.retention.keys)],
    ['TrailConfig', () => Object.keys(SCHEMA.trail.oneOf[1].keys)],
    ['RateLimitConfig', rateLimitKeys],
    ['SharedConfig', () => Object.keys(SCHEMA.shared.keys)],
    ['CacheConfig', () => Object.keys(SCHEMA.cache.oneOf[1].keys)],
    ['CspConfig', () => Object.keys(SCHEMA.csp.keys)],
    ['ShutdownConfig', () => Object.keys(SCHEMA.shutdown.keys)],
    ['UploadsConfig', uploadsKeys],
    ['InertiaConfig', () => Object.keys(SCHEMA.inertia.keys)],
    ['MailersConfig', () => Object.keys(SCHEMA.mailers.keys)],
    ['JobsConfig', () => Object.keys(SCHEMA.jobs.keys)],
    ['WebhooksConfig', () => Object.keys(SCHEMA.webhooks.keys)],
    [
      'RecurringConfig',
      () => Object.keys(SCHEMA.jobs.keys.recurring.values.keys),
    ],
  ])('%s declares exactly what the schema does', (name, keys) => {
    expect(members(source, name).sort()).toEqual(keys().sort());
  });

  test('the documentation lists exactly the keys henri owns', () => {
    const page = path.join(
      ROOT,
      'website',
      'src',
      'content',
      'docs',
      'configuration.md'
    );

    expect(fs.existsSync(page)).toBe(true);
    expect(documented(fs.readFileSync(page, 'utf8')).sort()).toEqual(
      Object.keys(SCHEMA).sort()
    );
  });
});
