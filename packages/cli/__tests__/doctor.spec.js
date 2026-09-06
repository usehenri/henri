const fs = require('fs');
const path = require('path');

const {
  agentsClaim,
  check,
  definesAction,
  definesGraphql,
  exportsOf,
  ignores,
  imports,
  looksPlural,
  mailerActions,
  moduleDeclaration,
  packageForShared,
  policyFor,
  reach,
  schema,
  storeOf,
  uncommented,
} = require('../scripts/doctor');
const { cleanup, henri, linkAdapter, scaffold, tmpdir } = require('./helpers');

/**
 * The problems of a check, keyed by check name
 *
 * @param {string} app The application directory
 * @returns {{ok: boolean, names: Array<string>, problems: Array<object>}} The result
 */
const run = (app) => {
  const report = check(app);

  return {
    names: report.problems.map((problem) => problem.check),
    ok: report.ok,
    problems: report.problems,
  };
};

/**
 * Rewrite every config/*.json of the application, and answer what restores
 * them
 *
 * `henri doctor` schema-checks every configuration file but reads one for
 * everything else: `config/<NODE_ENV>.json`, falling back to
 * `config/default.json`. These tests run under `NODE_ENV=test`, and a
 * scaffolded application has a `config/test.json` of its own, so a change
 * written to `default.json` alone would not be the one the check reads.
 *
 * @param {string} app The application directory
 * @param {Function} mutate Receives the parsed configuration and changes it
 * @returns {Function} Puts the files back
 */
const patchConfig = (app, mutate) => {
  const dir = path.join(app, 'config');
  const files = fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => path.join(dir, entry));
  const originals = files.map((file) => fs.readFileSync(file, 'utf8'));

  for (const file of files) {
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));

    fs.writeFileSync(file, JSON.stringify(mutate(config) || config, null, 2));
  }

  return () =>
    files.forEach((file, at) => fs.writeFileSync(file, originals[at]));
};

describe('doctor helpers', () => {
  test('tells plural looking names', () => {
    expect(looksPlural('Tasks')).toBe(true);
    expect(looksPlural('Categories')).toBe(true);
    expect(looksPlural('Task')).toBe(false);
    expect(looksPlural('Status')).toBe(false);
    expect(looksPlural('Address')).toBe(false);
    expect(looksPlural('Analysis')).toBe(false);
  });

  test('reads gitignore lines', () => {
    expect(ignores('node_modules\n.env\n', '.env')).toBe(true);
    expect(ignores('/.env', '.env')).toBe(true);
    expect(ignores('.env*', '.env')).toBe(true);
    expect(ignores('/config/local.json\n', '.env')).toBe(false);
    expect(ignores('.henri/\n', '.henri')).toBe(true);
  });

  test('finds actions in a controller source', () => {
    const source = `module.exports = {
  index: async (req, res) => {},
  async show(req, res) {},
  update: handler,
};`;

    expect(definesAction(source, 'index')).toBe(true);
    expect(definesAction(source, 'show')).toBe(true);
    expect(definesAction(source, 'update')).toBe(true);
    expect(definesAction(source, 'destroy')).toBe(false);
  });

  test('names the package config.shared needs installed', () => {
    expect(packageForShared({ adapter: 'redis' })).toBe('@usehenri/redis');
    expect(packageForShared({ adapter: 'redis', enabled: false })).toBeNull();
    // A path or a module id of its own is the application's business
    expect(packageForShared({ adapter: './lib/backend' })).toBeNull();
    expect(packageForShared({ adapter: '@acme/shared' })).toBeNull();
    expect(packageForShared(undefined)).toBeNull();
  });

  test('reads the top level of a module.exports object', () => {
    const source = `/** @type {import('@usehenri/core').ModelFile} */
module.exports = {
  schema: { store: { type: 'string' }, title: { type: 'string' } },
  options: {},
  store: 'reporting',
  async show(req, res) {},
  home: async (req, res) => {},
};`;

    expect([...exportsOf(source).keys()]).toEqual([
      'schema',
      'options',
      'store',
      'show',
      'home',
    ]);
    expect(exportsOf(source).get('store')).toEqual({
      kind: 'string',
      value: 'reporting',
    });
    expect(exportsOf(source).get('show').kind).toBe('function');
    // A `store` inside the schema is a column, not the model's store
    expect(storeOf(source)).toBe('reporting');
    expect(storeOf(`module.exports = { schema: { store: {} } };`)).toBeNull();
    // Anything it cannot read answers with nothing rather than a guess
    expect(storeOf(`module.exports = { store: NAMES.reporting };`)).toBeNull();
    expect(storeOf(`exports.store = 'reporting';`)).toBeNull();
    expect([...exportsOf(`// module.exports = { store: 'x' }`).keys()]).toEqual(
      []
    );
  });

  // The stripper feeds every reader here -- the object scanner, the mailer
  // actions, the module declarations, the renderer imports -- so it is worth
  // its own test rather than only the checks built on it
  test('blanks comments and leaves strings alone', () => {
    const source = `const url = 'https://example.com/a'; // the site
/* a block */ const two = "b/*c*/d";`;
    const clean = uncommented(source);

    expect(clean).toContain("'https://example.com/a'");
    expect(clean).toContain('"b/*c*/d"');
    expect(clean).not.toContain('the site');
    expect(clean).not.toContain('a block');
    // Offsets and lines are kept, so a scanner reads the same positions
    expect(clean).toHaveLength(source.length);
    expect(clean.split('\n')).toHaveLength(source.split('\n').length);
  });

  // What the stripper protects, with nothing to fall back on: a mailer whose
  // `defaults` carries a url would otherwise have no actions at all, and
  // `mailers.view` would quietly stop looking
  test('matches a package name literally, backslash included', () => {
    // The escape covered `/`, `@` and `-` and not `\\`, so a name holding one
    // made the character after it an escape sequence of the name's choosing
    expect(imports("import x from '@usehenri/react';", '@usehenri/react')).toBe(
      true
    );
    expect(
      imports("import x from '@usehenri/inertia';", '@usehenri/react')
    ).toBe(false);
    // `.` is not a wildcard, `+` is not a repetition, and a backslash is a
    // backslash: each of these matches itself and nothing else
    expect(imports("require('a.b')", 'a.b')).toBe(true);
    expect(imports("require('axb')", 'a.b')).toBe(false);
    expect(imports("require('a\\\\d')", 'a\\\\d')).toBe(true);
    expect(imports("require('a1')", 'a\\\\d')).toBe(false);
  });

  test('finds the actions of a mailer whose defaults carry a url', () => {
    expect(
      mailerActions(`module.exports = {
  defaults: { from: 'a@b.c', replyTo: 'https://acme.example/x' },
  confirm: async (user) => ({ subject: 'Hi', to: user.email }),
};`)
    ).toEqual(['confirm']);
  });

  // A `//` inside a string is not a comment. Blanking it leaves an
  // unterminated quote, and a scanner that then swallows the rest of the
  // file stops seeing `store` -- in one application and not another, which
  // is the worst way for a check to be wrong
  test('reads past a string that carries a url, and past every comment', () => {
    const withUrl = `module.exports = {
  schema: { home: { type: 'string', default: 'https://example.com/a' } },
  store: 'warehouse',
};`;

    expect(storeOf(withUrl)).toBe('warehouse');
    expect(
      storeOf(`module.exports = {
  /* the columns of the table */
  schema: {},
  store: 'warehouse', // a store name
};`)
    ).toBe('warehouse');
    expect(
      storeOf(`module.exports = {
  // don't touch this one
  store: 'warehouse',
};`)
    ).toBe('warehouse');
    // A key inside a comment is still not a key
    expect(
      storeOf(`module.exports = {
  // store: 'warehouse',
  schema: {},
};`)
    ).toBeNull();
  });

  // Two ways of reading it, because one way of missing is one too many
  test('falls back to a store key at the left margin', () => {
    const frozen = `module.exports = Object.freeze({
  schema: {},
  store: 'warehouse',
});`;

    // The scanner cannot read that shape at all
    expect([...exportsOf(frozen).keys()]).toEqual([]);
    expect(storeOf(frozen)).toBe('warehouse');
    // And a nested one is still not the model's store: the scanner answered
    expect(
      storeOf(`module.exports = {
  schema: {
    store: 'nested',
  },
};`)
    ).toBeNull();
  });

  test('tells a mailer action from a key that describes the mailer', () => {
    const source = `module.exports = {
  defaults: { from: 'a@b.c' },
  previews: { confirm: () => [{}] },
  async confirm(user) { return { to: user.email }; },
  welcome: async (user) => ({ to: user.email }),
  identity: 'welcome',
};`;

    expect(mailerActions(source)).toEqual(['confirm', 'welcome']);
  });

  test('reads what an app/modules file declares about itself', () => {
    expect(
      moduleDeclaration(
        `class Search extends Module {
  constructor() { super(); this.name = 'search'; this.needs = ['model']; }
}`,
        'metrics'
      )
    ).toEqual({ name: 'search', named: true, needs: ['model'] });

    // A module that names itself nothing takes the file name (0.modules.js)
    expect(moduleDeclaration('module.exports = class {};', 'metrics')).toEqual({
      name: 'metrics',
      named: false,
      needs: [],
    });
  });

  test('resolves a policy the way henri.policies resolves one', () => {
    const policies = new Set(['task', 'admin/proposal']);

    expect(policyFor('tasks', policies)).toBe('task');
    expect(policyFor('Task', policies)).toBe('task');
    // The namespace is kept: admin/proposals never borrows proposal
    expect(policyFor('admin/proposals', policies)).toBe('admin/proposal');
    expect(policyFor('proposals', policies)).toBeNull();
    expect(policyFor('', policies)).toBeNull();
  });

  test('reads what AGENTS.md claims the application is', () => {
    expect(
      agentsClaim(
        'CommonJS\non the server, renderer `inertia`, store `drizzle`. Follow'
      )
    ).toEqual({ renderer: 'inertia', store: 'drizzle' });
    expect(agentsClaim('# My app\n\nNothing to read here')).toBeNull();
  });

  test('finds a graphql key in a model source', () => {
    expect(definesGraphql(`module.exports = { graphql: { types: '' } };`)).toBe(
      true
    );
    expect(definesGraphql(`module.exports = {\n  graphql:{},\n};`)).toBe(true);
    expect(definesGraphql(`{ "graphql": { "types": "" } }`)).toBe(true);
    expect(definesGraphql(`module.exports = { schema: { title: {} } };`)).toBe(
      false
    );
    expect(definesGraphql(`// see the graphql guide`)).toBe(false);
  });
});

describe('henri doctor', () => {
  let dir;
  let app;

  beforeAll(() => {
    ({ app, dir } = scaffold(['--no-git']));
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('passes on a fresh app (only the install warning)', () => {
    const { status, stdout } = henri(['doctor'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain('1 problem (0 errors, 1 warning)');
    expect(stdout).toContain('deps.installed');

    const json = henri(['doctor', '--json'], { cwd: app });

    expect(json.status).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      ok: true,
      problems: [
        {
          check: 'deps.installed',
          code: null,
          file: null,
          hint: expect.stringMatching(/install$/),
          level: 'warning',
          message: expect.stringContaining('node_modules is missing'),
        },
      ],
      summary: {
        controllers: 2,
        errors: 0,
        models: 1,
        renderer: 'inertia',
        routes: 9,
        warnings: 1,
      },
    });
  });

  test('fails when a model file is plural', () => {
    fs.renameSync(
      path.join(app, 'app/models/Task.js'),
      path.join(app, 'app/models/Tasks.js')
    );

    const { status, stdout, stderr } = henri(['doctor'], { cwd: app });

    expect(status).toBe(1);
    expect(stdout).toContain('models.naming');
    expect(stdout).toContain('app/models/Tasks.js');
    expect(stdout).toContain('Task.js, not Tasks.js');
    expect(stderr).toContain('1 problem found');

    const json = henri(['doctor', '--json'], { cwd: app });

    expect(json.status).toBe(1);
    expect(JSON.parse(json.stdout).ok).toBe(false);
    expect(JSON.parse(json.stderr).error).toMatchObject({
      code: 'HENRI_CLI_CHECKS_FAILED',
      command: 'doctor',
      exitCode: 1,
    });

    fs.renameSync(
      path.join(app, 'app/models/Tasks.js'),
      path.join(app, 'app/models/task.js')
    );

    expect(run(app).problems).toContainEqual(
      expect.objectContaining({
        check: 'models.naming',
        file: 'app/models/task.js',
        hint: expect.stringContaining('app/models/Task.js'),
        level: 'error',
      })
    );

    fs.renameSync(
      path.join(app, 'app/models/task.js'),
      path.join(app, 'app/models/Task.js')
    );
    expect(run(app).ok).toBe(true);
  });

  test('reports a secret in the configuration', () => {
    const file = path.join(app, 'config/default.json');
    const original = fs.readFileSync(file, 'utf8');

    fs.writeFileSync(
      file,
      JSON.stringify({ ...JSON.parse(original), secret: 'nope' })
    );

    const { ok, problems } = run(app);

    fs.writeFileSync(file, original);

    expect(ok).toBe(false);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'config.secret',
        file: 'config/default.json',
        hint: expect.stringContaining('HENRI_SECRET'),
        level: 'error',
      })
    );
  });

  test('reports an unknown adapter and a missing dependency', () => {
    const restore = patchConfig(app, (config) => {
      config.stores = {
        default: { adapter: 'redis' },
        sql: { adapter: 'mysql' },
      };
    });

    const { names, problems } = run(app);

    restore();

    expect(names).toContain('config.adapter');
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'deps.declared',
        hint: expect.stringContaining('@usehenri/mysql'),
        level: 'error',
      })
    );
  });

  test('runs the configuration through the schema of @usehenri/core', () => {
    const file = path.join(app, 'config/default.json');
    const original = fs.readFileSync(file, 'utf8');

    fs.writeFileSync(
      file,
      JSON.stringify({
        ...JSON.parse(original),
        port: 'eight thousand',
        renderers: 'react',
      })
    );

    const { ok, problems } = run(app);

    fs.writeFileSync(file, original);

    expect(ok).toBe(false);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'config.invalid',
        file: 'config/default.json',
        level: 'error',
        message: expect.stringContaining(
          '"port" must be a port number between 1 and 65535'
        ),
      })
    );
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'config.unknown',
        hint: 'Rename it to "renderer", or remove it',
        level: 'warning',
      })
    );
  });

  test('asks for @usehenri/graphql when a model declares types', () => {
    const file = path.join(app, 'app/models/Task.js');
    const original = fs.readFileSync(file, 'utf8');

    fs.writeFileSync(
      file,
      original.replace(
        'module.exports = {',
        "module.exports = {\n  graphql: { types: 'type Query { tasks: [Task] }' },"
      )
    );

    const { problems } = run(app);

    fs.writeFileSync(file, original);

    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'deps.declared',
        hint: expect.stringContaining('@usehenri/graphql'),
        level: 'error',
      })
    );

    expect(run(app).names).not.toContain('deps.declared');
  });

  // A model saying `graphql: true` has henri derive its definition from its
  // schema. What is invisible until a query arrives is the authorization
  // around it, and what is invisible forever is a hand-written type naming
  // a field the rest of henri refuses to publish.
  describe('the graphql definitions', () => {
    const model = () => path.join(app, 'app/models/Task.js');
    const policy = () => path.join(app, 'app/policies/task.js');
    let source;

    beforeEach(() => {
      source = fs.readFileSync(model(), 'utf8');
    });

    afterEach(() => {
      fs.writeFileSync(model(), source);
      fs.rmSync(policy(), { force: true });
    });

    /**
     * Writes a `graphql` key into the scaffolded model
     *
     * @param {string} declaration what the key holds, as source
     * @returns {void}
     */
    const declare = (declaration) =>
      fs.writeFileSync(
        model(),
        source.replace(
          'module.exports = {',
          `module.exports = {\n  graphql: ${declaration},`
        )
      );

    test('reports a derived model with no policy behind it', () => {
      declare('true');

      expect(run(app).problems).toContainEqual(
        expect.objectContaining({
          check: 'graphql.policy',
          file: 'app/models/Task.js',
          level: 'warning',
          message: expect.stringContaining('app/policies/task.js does not'),
        })
      );
    });

    test('reports a policy with no scope behind a list query', () => {
      declare('true');
      fs.mkdirSync(path.dirname(policy()), { recursive: true });
      fs.writeFileSync(policy(), 'module.exports = { index: () => true };\n');

      expect(run(app).problems).toContainEqual(
        expect.objectContaining({
          check: 'graphql.policy',
          code: 'HENRI_API_GRAPHQL_SCOPE_REQUIRED',
          file: 'app/policies/task.js',
          level: 'warning',
        })
      );
    });

    test('says nothing when the policy answers both questions', () => {
      declare('true');
      fs.mkdirSync(path.dirname(policy()), { recursive: true });
      fs.writeFileSync(
        policy(),
        'module.exports = { index: () => true, scope: () => ({}) };\n'
      );

      expect(run(app).names).not.toContain('graphql.policy');
    });

    // The drift a derived definition cannot have: a hand-written type
    // naming a field `res.render()` and `res.resource()` drop
    test('reports a hand-written type naming a field that never leaves', () => {
      fs.writeFileSync(
        model(),
        source
          .replace(
            'module.exports = {',
            "module.exports = {\n  graphql: { types: 'type Task { secret: String }' },"
          )
          .replace(
            'schema: {',
            "schema: {\n    secret: { type: 'string', personal: { expose: false } },"
          )
      );

      expect(run(app).problems).toContainEqual(
        expect.objectContaining({
          check: 'graphql.exposed',
          level: 'warning',
          message: expect.stringContaining('secret'),
        })
      );
    });

    test('fails on a declaration that would fail the boot', () => {
      declare("{ generate: true, mutations: ['publish'] }");

      expect(run(app).problems).toContainEqual(
        expect.objectContaining({
          check: 'graphql.declaration',
          code: 'HENRI_API_GRAPHQL_INVALID_DECLARATION',
          level: 'error',
        })
      );
    });
  });

  // The scaffold ships an empty app/jobs: writing the first job is what makes
  // the queue a dependency, and doctor is where an application hears about it
  test('asks for @usehenri/jobs when the application has a job', () => {
    const file = path.join(app, 'app/jobs/welcome.js');

    fs.writeFileSync(file, 'module.exports = { perform: async () => null };');

    const { problems } = run(app);

    fs.rmSync(file);

    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'deps.declared',
        hint: expect.stringContaining('@usehenri/jobs'),
        level: 'error',
      })
    );

    expect(run(app).names).not.toContain('deps.declared');
  });

  // An `uploads` block says an application means to accept a file, and
  // without the package nothing parses a multipart body at all
  test('asks for @usehenri/uploads when the configuration accepts files', () => {
    const restore = patchConfig(app, (config) => {
      config.uploads = { maxFileSize: '5mb' };
    });

    const { problems } = run(app);

    restore();

    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'deps.declared',
        hint: expect.stringContaining('@usehenri/uploads'),
        level: 'error',
      })
    );

    expect(run(app).names).not.toContain('deps.declared');
  });

  // The object store and the image library are named by the uploads block
  // and shipped by nobody: `s3` is a package, a variant needs sharp
  test('asks for @usehenri/s3 when the storage names it', () => {
    const restore = patchConfig(app, (config) => {
      config.uploads = {
        storage: { adapter: 's3', bucket: 'henri-uploads' },
      };
    });

    const { problems } = run(app);

    restore();

    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'deps.declared',
        hint: expect.stringContaining('@usehenri/s3'),
        level: 'error',
      })
    );
  });

  test('asks for sharp when a variant is declared', () => {
    const restore = patchConfig(app, (config) => {
      config.uploads = { variants: { thumb: { width: 320 } } };
    });

    const { problems } = run(app);

    restore();

    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'deps.declared',
        hint: expect.stringContaining('sharp'),
        level: 'error',
      })
    );

    expect(run(app).names).not.toContain('deps.declared');
  });

  // The only package henri can ask for here is the interface, since it
  // ships no SDK -- and only when the configuration says the application
  // requires telemetry rather than "instrument if you can"
  test('asks for @opentelemetry/api when telemetry.enabled is true', () => {
    const restore = patchConfig(app, (config) => {
      config.telemetry = { enabled: true };
    });

    const { problems } = run(app);

    restore();

    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'deps.declared',
        hint: expect.stringContaining('@opentelemetry/api'),
        level: 'error',
      })
    );

    expect(run(app).names).not.toContain('deps.declared');
  });

  test('and says nothing when telemetry only follows the package', () => {
    const restore = patchConfig(app, (config) => {
      config.telemetry = { spans: ['http'] };
    });

    const { names } = run(app);

    restore();

    expect(names).not.toContain('deps.declared');
  });

  // `config.shared` names the backend the rate limit, the sign-in lockout
  // and the idempotency keys count in, the way a store names its adapter
  test('asks for @usehenri/redis when config.shared names it', () => {
    const restore = patchConfig(app, (config) => {
      config.shared = { adapter: 'redis', url: 'redis://127.0.0.1:6399' };
    });

    const { problems } = run(app);

    restore();

    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'deps.declared',
        hint: expect.stringContaining('@usehenri/redis'),
        level: 'error',
      })
    );

    expect(run(app).names).not.toContain('deps.declared');
  });

  // The one check that opens a connection: an application that says its
  // counters live somewhere else gets told when that somewhere is not there
  test('reports a shared store that does not answer', async () => {
    const backend = path.join(app, 'lib');
    let restore;

    fs.mkdirSync(backend, { recursive: true });
    fs.writeFileSync(
      path.join(backend, 'shared.js'),
      `module.exports = class Down {
        async start() { throw new Error('connection refused'); }
        async ping() { return true; }
        async stop() { return true; }
        rateLimitStore() { return {}; }
        keyValueStore() { return {}; }
      };\n`
    );

    restore = patchConfig(app, (config) => {
      config.shared = { adapter: './lib/shared' };
    });

    const down = await reach(app, { problems: [], summary: { warnings: 0 } });

    expect(down.problems).toContainEqual(
      expect.objectContaining({
        check: 'shared.unreachable',
        level: 'warning',
        message: expect.stringContaining('connection refused'),
      })
    );
    expect(down.summary.warnings).toBe(1);

    // A backend that answers is silent
    fs.writeFileSync(
      path.join(backend, 'shared.js'),
      `module.exports = class Up {
        async start() { return true; }
        async ping() { return true; }
        async stop() { return true; }
        rateLimitStore() { return {}; }
        keyValueStore() { return {}; }
      };\n`
    );

    const fresh = { problems: [], summary: { warnings: 0 } };

    // Node caches a required module, so the second one needs its own file
    fs.writeFileSync(
      path.join(backend, 'up.js'),
      fs.readFileSync(path.join(backend, 'shared.js'), 'utf8')
    );
    restore();
    restore = patchConfig(app, (config) => {
      config.shared = { adapter: './lib/up' };
    });

    await reach(app, fresh);

    expect(fresh.problems).toEqual([]);

    // An adapter that is not installed is `deps.declared`, not this
    restore();
    restore = patchConfig(app, (config) => {
      config.shared = { adapter: 'nowhere' };
    });

    const absent = { problems: [], summary: { warnings: 0 } };

    await reach(app, absent);
    restore();
    fs.rmSync(backend, { force: true, recursive: true });

    expect(absent.problems).toEqual([]);
  });

  test('reports .env not ignored, and a missing .env as a warning', () => {
    const ignore = path.join(app, '.gitignore');
    const original = fs.readFileSync(ignore, 'utf8');

    fs.writeFileSync(ignore, original.replace(/^\.env$/m, ''));

    expect(run(app).problems).toContainEqual(
      expect.objectContaining({
        check: 'env.ignored',
        file: '.gitignore',
        level: 'error',
      })
    );

    fs.writeFileSync(ignore, original);
    fs.renameSync(path.join(app, '.env'), path.join(app, '.env.bak'));

    const { ok, problems } = run(app);

    fs.renameSync(path.join(app, '.env.bak'), path.join(app, '.env'));

    expect(ok).toBe(true);
    expect(problems).toContainEqual(
      expect.objectContaining({ check: 'env.missing', level: 'warning' })
    );
  });

  test('reports routes without a controller, an action or a page', () => {
    const routes = path.join(app, 'config/routes.js');
    const original = fs.readFileSync(routes, 'utf8');

    fs.writeFileSync(
      routes,
      original.replace(
        'module.exports = {',
        "module.exports = {\n  'get /ghosts': 'ghosts#index',\n  'get /tasks/stats': 'tasks#stats',"
      )
    );
    const show = path.join(app, 'app/views/pages/tasks/show.jsx');
    const page = fs.readFileSync(show, 'utf8');

    fs.unlinkSync(show);

    const { problems } = run(app);

    fs.writeFileSync(routes, original);
    fs.writeFileSync(show, page);

    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'routes.controller',
        hint: expect.stringContaining('henri generate controller ghosts index'),
        level: 'error',
        message: expect.stringContaining('"get /ghosts"'),
      })
    );
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'routes.action',
        file: 'app/controllers/tasks.js',
        level: 'error',
        message: expect.stringContaining('"stats"'),
      })
    );
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'views.pages',
        level: 'error',
        message: expect.stringContaining('app/views/pages/tasks/show.jsx'),
      })
    );

    // A controller nobody routes to is a warning
    fs.writeFileSync(
      path.join(app, 'app/controllers/orphans.js'),
      'module.exports = { index: async (req, res) => res.json({}) };\n'
    );

    expect(run(app).problems).toContainEqual(
      expect.objectContaining({
        check: 'controllers.unused',
        file: 'app/controllers/orphans.js',
        level: 'warning',
      })
    );

    fs.unlinkSync(path.join(app, 'app/controllers/orphans.js'));
  });

  test('warns about missing AGENTS.md and vitest.config.js', () => {
    fs.renameSync(path.join(app, 'AGENTS.md'), path.join(app, 'AGENTS.bak'));
    fs.renameSync(
      path.join(app, 'vitest.config.js'),
      path.join(app, 'vitest.bak')
    );

    const { ok, problems } = run(app);

    fs.renameSync(path.join(app, 'AGENTS.bak'), path.join(app, 'AGENTS.md'));
    fs.renameSync(
      path.join(app, 'vitest.bak'),
      path.join(app, 'vitest.config.js')
    );

    expect(ok).toBe(true);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'agents.missing',
        hint: 'henri generate agents',
        level: 'warning',
      })
    );
    expect(problems).toContainEqual(
      expect.objectContaining({ check: 'tests.config', level: 'warning' })
    );
  });

  test('reports migrations a Sequelize store can never apply', () => {
    const folder = path.join(app, 'db/migrations');
    let restore;

    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, '0000_init.sql'), 'CREATE TABLE a(b);');
    restore = patchConfig(app, (configuration) => {
      configuration.stores = {
        default: { adapter: 'mssql', url: 'mssql://x/y' },
      };
    });

    const { names, problems } = run(app);

    expect(names).toContain('schema.migrations-ignored');
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'schema.migrations-ignored',
        file: 'db/migrations',
        level: 'error',
      })
    );

    // The same folder with the drizzle adapter is fine, but nothing applies
    // it on a production boot until the store says so
    restore();
    restore = patchConfig(app, (configuration) => {
      configuration.stores = {
        default: { adapter: 'drizzle', url: 'postgres://x/y' },
      };
    });

    const drizzle = run(app);
    const production = path.join(app, 'config/production.json');

    // With "migrate": true in the production configuration, it is applied
    fs.writeFileSync(
      production,
      JSON.stringify({
        stores: { default: { adapter: 'drizzle', migrate: true } },
      })
    );

    const applied = run(app).names;

    // Without it, and with the file there, that file is the one to open
    fs.writeFileSync(
      production,
      JSON.stringify({ stores: { default: { adapter: 'drizzle' } } })
    );

    const named = run(app).problems;

    fs.unlinkSync(production);
    fs.rmSync(folder, { recursive: true });
    restore();

    expect(drizzle.names).not.toContain('schema.migrations-ignored');
    // There is no config/production.json in the first run, so the finding
    // names none -- and the hint says the deploy first, because that file
    // replaces config/default.json whole and a reader who creates it for
    // the flag alone loses the store block with it
    expect(drizzle.problems).toContainEqual(
      expect.objectContaining({
        check: 'schema.migrations-pending',
        file: null,
        hint: expect.stringContaining('entire "stores" block'),
        level: 'warning',
      })
    );
    expect(applied).not.toContain('schema.migrations-pending');
    expect(named).toContainEqual(
      expect.objectContaining({
        check: 'schema.migrations-pending',
        file: 'config/production.json',
        hint: expect.stringContaining('henri db:migrate'),
        level: 'warning',
      })
    );
  });

  // --- the things that break a boot ----------------------------------------

  // Every environment file is a whole configuration, so the store has to be
  // in all of them: the one that leaves it out is the boot that fails
  test('reports a model whose store an environment does not hold', () => {
    const file = path.join(app, 'app/models/Task.js');
    const original = fs.readFileSync(file, 'utf8');

    fs.writeFileSync(file, original.replace("'default'", "'reporting'"));

    const unknown = run(app);

    // A model that names no store needs a default one in every file
    fs.writeFileSync(
      file,
      original.replace(/\n\s+store: 'default',[^\n]*/, '')
    );

    const restore = patchConfig(app, (configuration) => {
      configuration.stores = { reporting: configuration.stores.default };
    });
    const none = run(app);

    restore();
    fs.writeFileSync(file, original);

    expect(unknown.ok).toBe(false);
    expect(unknown.problems).toContainEqual(
      expect.objectContaining({
        check: 'models.store',
        code: 'HENRI_MODEL_UNKNOWN_STORE',
        file: 'app/models/Task.js',
        hint: expect.stringContaining('config/default.json'),
        level: 'error',
        message: expect.stringContaining('config/default.json'),
      })
    );
    expect(none.problems).toContainEqual(
      expect.objectContaining({
        check: 'models.store',
        code: 'HENRI_MODEL_NO_STORE',
        level: 'error',
      })
    );
    expect(run(app).names).not.toContain('models.store');
  });

  // The same thing end to end, on the file `henri new` writes rather than a
  // hand-written one, with a url in it: this is the regression test for the
  // comment stripper above
  test('reports the store of a scaffolded model that carries a url', () => {
    const file = path.join(app, 'app/models/Task.js');
    const original = fs.readFileSync(file, 'utf8');

    fs.writeFileSync(
      file,
      original
        .replace(
          "done: { type: 'boolean', default: false },",
          "done: { type: 'boolean', default: false },\n    link: { type: 'string', default: 'https://example.com/a' },"
        )
        .replace("'default'", "'warehouse'")
    );

    const { ok, problems } = run(app);

    fs.writeFileSync(file, original);

    expect(ok).toBe(false);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'models.store',
        code: 'HENRI_MODEL_UNKNOWN_STORE',
        file: 'app/models/Task.js',
        level: 'error',
        message: expect.stringContaining('"warehouse"'),
      })
    );
    expect(run(app).names).not.toContain('models.store');
  });

  // A model and no store anywhere: reported, rather than a check that goes
  // quiet because its inputs were not what it expected
  test('reports models with no store configured anywhere', () => {
    const restore = patchConfig(app, (configuration) => {
      delete configuration.stores;
    });
    const { ok, problems } = run(app);

    restore();

    expect(ok).toBe(false);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'models.store',
        code: 'HENRI_MODEL_NO_STORE',
        level: 'error',
        message: expect.stringContaining('no config/*.json configures a store'),
      })
    );
    expect(run(app).names).not.toContain('models.store');
  });

  // The one an environment file introduces on its own: the store is in
  // config/default.json and config/production.json forgot it
  test('reports a store one environment holds and another does not', () => {
    const production = path.join(app, 'config/production.json');
    const base = JSON.parse(
      fs.readFileSync(path.join(app, 'config/default.json'), 'utf8')
    );

    fs.writeFileSync(
      production,
      JSON.stringify({ ...base, stores: { reporting: base.stores.default } })
    );

    const { ok, problems } = run(app);

    fs.unlinkSync(production);

    expect(ok).toBe(false);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'models.store',
        code: 'HENRI_MODEL_UNKNOWN_STORE',
        level: 'error',
        message: expect.stringContaining(
          'config/production.json does not hold'
        ),
      })
    );
    expect(run(app).names).not.toContain('models.store');
  });

  test('reports a jobs, webhooks or trail block naming a store that is not there', () => {
    const restore = patchConfig(app, (configuration) => {
      configuration.trail = { enabled: true, store: 'audit' };
    });

    const { ok, problems } = run(app);

    restore();

    expect(ok).toBe(false);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'config.store',
        code: 'HENRI_TRAIL_UNSUPPORTED_STORE',
        level: 'error',
        message: expect.stringContaining('"trail.store" is "audit"'),
      })
    );
    expect(run(app).names).not.toContain('config.store');
  });

  // Every environment is a whole configuration of its own, so the adapter
  // only config/production.json names is the one that fails on the deploy
  test('reports an adapter another environment configures and nothing installs', () => {
    const production = path.join(app, 'config/production.json');

    fs.writeFileSync(
      production,
      JSON.stringify({
        renderer: 'inertia',
        stores: { default: { adapter: 'postgresql', url: 'postgres://a/b' } },
      })
    );

    const { ok, problems } = run(app);

    fs.unlinkSync(production);

    expect(ok).toBe(false);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'deps.declared',
        code: 'HENRI_STORE_ADAPTER_NOT_INSTALLED',
        level: 'error',
        message: expect.stringContaining('config/production.json asks for it'),
      })
    );
    expect(run(app).names).not.toContain('deps.declared');
  });

  test('reports a route asking for a policy that does not exist', () => {
    const routes = path.join(app, 'config/routes.js');
    const original = fs.readFileSync(routes, 'utf8');

    fs.writeFileSync(
      routes,
      original.replace(
        'module.exports = {',
        "module.exports = {\n  'get /guarded': { controller: 'main#home', policy: 'task' },"
      )
    );

    const { ok, problems } = run(app);

    expect(ok).toBe(false);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'routes.policy',
        file: 'config/routes.js',
        hint: expect.stringContaining('henri generate policy task'),
        level: 'error',
        message: expect.stringContaining('app/policies/task.js'),
      })
    );

    // Written, and the route is fine: the plural of the controller finds it
    fs.mkdirSync(path.join(app, 'app/policies'), { recursive: true });
    fs.writeFileSync(
      path.join(app, 'app/policies/task.js'),
      'module.exports = { show: (user, record) => Boolean(record) };\n'
    );

    expect(run(app).names).not.toContain('routes.policy');

    fs.rmSync(path.join(app, 'app/policies'), { recursive: true });
    fs.writeFileSync(routes, original);
  });

  test('reports a file of app/jobs that is not a job', () => {
    const file = path.join(app, 'app/jobs/welcome.js');

    fs.writeFileSync(file, 'module.exports = { queue: "mailers" };\n');

    const { ok, problems } = run(app);

    expect(ok).toBe(false);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'jobs.perform',
        code: 'HENRI_JOB_INVALID_DEFINITION',
        file: 'app/jobs/welcome.js',
        level: 'error',
      })
    );

    fs.writeFileSync(
      file,
      'module.exports = { queue: "mailers", perform: async () => null };\n'
    );
    expect(run(app).names).not.toContain('jobs.perform');
    fs.rmSync(file);
  });

  // The quiet one: nothing fails, the runner logs once and the work never
  // happens again
  test('reports a recurring schedule naming a job that is not there', () => {
    const restore = patchConfig(app, (configuration) => {
      configuration.jobs = {
        recurring: { nightly: { cron: '0 3 * * *', job: 'cleanup' } },
      };
    });

    expect(run(app).problems).toContainEqual(
      expect.objectContaining({
        check: 'jobs.recurring',
        code: 'HENRI_JOB_INVALID_SCHEDULE',
        level: 'error',
        message: expect.stringContaining('app/jobs/cleanup.js'),
      })
    );

    const file = path.join(app, 'app/jobs/cleanup.js');

    fs.writeFileSync(file, 'module.exports = { perform: async () => null };\n');
    expect(run(app).names).not.toContain('jobs.recurring');
    fs.rmSync(file);

    // A job henri defines itself is not a job app/jobs has to hold
    restore();

    const builtin = patchConfig(app, (configuration) => {
      configuration.jobs = {
        recurring: { sweep: { every: '1d', job: 'henri/retention' } },
      };
    });

    expect(run(app).names).not.toContain('jobs.recurring');
    builtin();
  });

  test('reports a mailer action with no view, and leaves one it cannot read alone', () => {
    const mailer = path.join(app, 'app/mailers/welcome.js');

    fs.mkdirSync(path.dirname(mailer), { recursive: true });
    fs.writeFileSync(
      mailer,
      `module.exports = {
  defaults: { from: 'a@b.c' },
  confirm: async (user) => ({ subject: 'Hi', to: user.email }),
};
`
    );

    const { ok, problems } = run(app);

    expect(ok).toBe(false);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'mailers.view',
        code: 'HENRI_MAIL_VIEW_MISSING',
        file: 'app/mailers/welcome.js',
        level: 'error',
        message: expect.stringContaining(
          'app/views/mailers/welcome/confirm.hbs'
        ),
      })
    );

    const view = path.join(app, 'app/views/mailers/welcome/confirm.hbs');

    fs.mkdirSync(path.dirname(view), { recursive: true });
    fs.writeFileSync(view, '<p>Hi</p>\n');
    expect(run(app).names).not.toContain('mailers.view');
    fs.rmSync(path.join(app, 'app/views/mailers'), { recursive: true });

    // An action that hands back its own html reads no view at all, and a
    // file cannot say which action does: the whole mailer is left alone
    fs.writeFileSync(
      mailer,
      `module.exports = {
  confirm: async (user) => ({ html: '<p>Hi</p>', to: user.email }),
};
`
    );
    expect(run(app).names).not.toContain('mailers.view');
    fs.rmSync(path.join(app, 'app/mailers'), { recursive: true });
  });

  test('reports an app/modules file whose name is taken, and a needs nothing provides', () => {
    const modules = path.join(app, 'app/modules');

    fs.mkdirSync(modules, { recursive: true });
    // No name of its own: the loader takes the file name, and `config` is
    // core's own module
    fs.writeFileSync(
      path.join(modules, 'config.js'),
      'module.exports = class Metrics {};\n'
    );

    expect(run(app).problems).toContainEqual(
      expect.objectContaining({
        check: 'modules.name',
        code: 'HENRI_BOOT_DUPLICATE_MODULE',
        file: 'app/modules/config.js',
        level: 'error',
      })
    );

    fs.rmSync(path.join(modules, 'config.js'));
    fs.writeFileSync(
      path.join(modules, 'metrics.js'),
      `class Metrics {
  constructor() {
    this.name = 'metrics';
    this.needs = ['model', 'search'];
  }
}
module.exports = Metrics;
`
    );

    expect(run(app).problems).toContainEqual(
      expect.objectContaining({
        check: 'modules.needs',
        code: 'HENRI_BOOT_MISSING_DEPENDENCY',
        file: 'app/modules/metrics.js',
        level: 'error',
        message: expect.stringContaining('"search"'),
      })
    );

    fs.writeFileSync(
      path.join(modules, 'metrics.js'),
      `class Metrics {
  constructor() {
    this.name = 'metrics';
    this.needs = ['model'];
  }
}
module.exports = Metrics;
`
    );

    const clean = run(app).names;

    expect(clean).not.toContain('modules.needs');
    expect(clean).not.toContain('modules.name');
    fs.rmSync(modules, { recursive: true });
  });

  // --- what AGENTS.md claims -------------------------------------------------

  test('reports an AGENTS.md describing another renderer or another store', () => {
    const file = path.join(app, 'AGENTS.md');
    const original = fs.readFileSync(file, 'utf8');

    fs.writeFileSync(
      file,
      original.replace(
        'renderer `inertia`, store `drizzle`',
        'renderer `react`, store `mongoose`'
      )
    );

    const { ok, problems } = run(app);

    fs.writeFileSync(file, original);

    // Wrong, but nothing an application cannot run: a warning
    expect(ok).toBe(true);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'agents.stale',
        file: 'AGENTS.md',
        hint: expect.stringContaining('henri generate agents rewrites'),
        level: 'warning',
        message: expect.stringContaining('the renderer is "inertia"'),
      })
    );
    expect(
      problems.find((entry) => entry.check === 'agents.stale').message
    ).toContain('the default store is "drizzle"');
    expect(run(app).names).not.toContain('agents.stale');
  });

  test('reports a page written for the renderer the configuration does not name', () => {
    const page = path.join(app, 'app/views/pages/tasks/show.jsx');
    const original = fs.readFileSync(page, 'utf8');

    fs.writeFileSync(
      page,
      `import { useHenri } from '@usehenri/react';\n${original}`
    );

    expect(run(app).problems).toContainEqual(
      expect.objectContaining({
        check: 'views.renderer',
        file: 'app/views/pages/tasks/show.jsx',
        level: 'error',
        message: expect.stringContaining('@usehenri/react'),
      })
    );

    fs.writeFileSync(page, original);

    // And a page the Inertia glob (./pages/**/*.jsx) will never resolve
    fs.renameSync(page, page.replace(/\.jsx$/, '.js'));

    const { names, problems } = run(app);

    fs.renameSync(page.replace(/\.jsx$/, '.js'), page);

    expect(names).not.toContain('views.pages');
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'views.renderer',
        hint: expect.stringContaining('.jsx'),
        level: 'error',
      })
    );
    expect(run(app).ok).toBe(true);
  });

  // The page no route names, which is where such a file hides: nothing
  // renders it, nothing loads it and nothing says so
  test('reports a page no route names that the renderer cannot resolve', () => {
    const orphan = path.join(app, 'app/views/pages/Orphan.js');

    fs.writeFileSync(orphan, 'export default function Orphan() {}\n');

    const { ok, problems } = run(app);

    expect(ok).toBe(false);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'views.renderer',
        file: 'app/views/pages/Orphan.js',
        hint: expect.stringContaining('app/views/components'),
        level: 'error',
        message: expect.stringContaining('does not resolve'),
      })
    );

    // The same file with the extension the engine reads is a page
    fs.renameSync(orphan, orphan.replace(/\.js$/, '.jsx'));
    expect(run(app).names).not.toContain('views.renderer');
    fs.rmSync(orphan.replace(/\.js$/, '.jsx'));
  });

  test('refuses to run outside of a project', () => {
    const { status, stderr } = henri(['doctor', '--json'], { cwd: dir });

    expect(status).toBe(3);
    expect(JSON.parse(stderr).error.code).toBe('HENRI_CLI_NOT_A_PROJECT');
  });
});

/**
 * A henri application with nothing in it: enough for `isProject`, and the
 * `template` renderer so no view engine, no page and no renderer package is
 * asked for. What each test adds is the one thing it is about.
 *
 * @param {object} [config={}] What to write in config/default.json
 * @param {object} [pkg={}] What to write in package.json
 * @returns {string} The application directory
 */
const minimal = (config = {}, pkg = {}) => {
  const app = tmpdir('henri-doctor-');

  fs.mkdirSync(path.join(app, 'app/views/pages'), { recursive: true });
  fs.mkdirSync(path.join(app, 'config'), { recursive: true });
  fs.writeFileSync(path.join(app, 'app/views/pages/index.hbs'), '<p>hi</p>\n');
  fs.writeFileSync(
    path.join(app, 'config/routes.js'),
    'module.exports = {};\n'
  );
  fs.writeFileSync(
    path.join(app, 'config/default.json'),
    JSON.stringify({ renderer: 'template', ...config }, null, 2)
  );
  fs.writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify(
      { henri: '1.0.0', name: 'minimal', private: true, ...pkg },
      null,
      2
    )
  );

  return app;
};

/**
 * Put a package in an application's node_modules: a real one from the
 * workspace, or a manifest of the test's own
 *
 * @param {string} app The application directory
 * @param {string} name The package name
 * @param {object|string} what A package.json to write, or a directory to link
 * @returns {void}
 */
const install = (app, name, what) => {
  const target = path.join(app, 'node_modules', ...name.split('/'));

  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (typeof what === 'string') {
    fs.symlinkSync(what, target, 'junction');

    return;
  }

  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(
    path.join(target, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', ...what }, null, 2)
  );
};

describe('henri doctor: the packages an application installed', () => {
  let app;

  afterEach(() => cleanup(app));

  test('reports a package that ships a module whose file is not there', () => {
    app = minimal({}, { dependencies: { 'acme-search': '^1.0.0' } });
    install(app, 'acme-search', { henri: { module: './module.js' } });

    expect(run(app).problems).toContainEqual(
      expect.objectContaining({
        check: 'modules.package',
        file: 'package.json',
        level: 'error',
        message: expect.stringContaining('acme-search ships a module'),
      })
    );

    fs.writeFileSync(
      path.join(app, 'node_modules/acme-search/module.js'),
      'module.exports = class {};\n'
    );
    expect(run(app).names).not.toContain('modules.package');
  });

  // A package outside the table of the modules henri ships registers a name
  // doctor cannot learn without loading it, so the `needs` check stops
  test('says nothing about a needs when an unknown package ships a module', () => {
    app = minimal({}, { dependencies: { 'acme-search': '^1.0.0' } });
    install(app, 'acme-search', { henri: { module: './module.js' } });
    fs.writeFileSync(
      path.join(app, 'node_modules/acme-search/module.js'),
      'module.exports = class {};\n'
    );
    fs.mkdirSync(path.join(app, 'app/modules'), { recursive: true });
    fs.writeFileSync(
      path.join(app, 'app/modules/metrics.js'),
      "module.exports = class { constructor() { this.needs = ['search']; } };\n"
    );

    expect(run(app).names).not.toContain('modules.needs');
  });

  test('reports the henri packages installed at two different versions', () => {
    const dependencies = {
      '@usehenri/core': '^1.1.0',
      '@usehenri/jobs': '^1.0.0',
    };

    app = minimal({}, { dependencies });
    install(app, '@usehenri/core', { version: '1.1.0' });
    install(app, '@usehenri/jobs', { version: '1.0.0' });

    const { ok, problems } = run(app);

    // A half-finished upgrade, not a broken application: a warning
    expect(ok).toBe(true);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'deps.version',
        file: 'package.json',
        level: 'warning',
        message: expect.stringContaining('@usehenri/jobs 1.0.0'),
      })
    );

    // One version everywhere, and there is nothing to say (a second
    // directory: `require` holds on to the manifests it has read)
    const agreeing = minimal({}, { dependencies });

    install(agreeing, '@usehenri/core', { version: '1.1.0' });
    install(agreeing, '@usehenri/jobs', { version: '1.1.0' });
    expect(run(agreeing).names).not.toContain('deps.version');
    cleanup(agreeing);
  });
});

describe('henri doctor: the schema of a store', () => {
  const drizzle = path.resolve(__dirname, '../../drizzle');
  const sqlite = path.dirname(
    require.resolve('better-sqlite3/package.json', { paths: [drizzle] })
  );
  let app;

  /**
   * An application with one drizzle store on a sqlite file of its own, and
   * one migration written but not applied
   *
   * @param {object} [store] What to write as the default store
   * @returns {string} The application directory
   */
  const migrating = (store = undefined) => {
    const made = minimal(
      {
        stores: {
          default: store || {
            adapter: 'drizzle',
            dialect: 'sqlite',
            url: 'file:PLACEHOLDER',
          },
        },
      },
      {
        dependencies: {
          '@usehenri/core': '^1.1.0',
          '@usehenri/drizzle': '^1.1.0',
          'better-sqlite3': '^13.0.3',
        },
      }
    );
    const config = path.join(made, 'config/default.json');

    fs.writeFileSync(
      config,
      fs
        .readFileSync(config, 'utf8')
        .replace('PLACEHOLDER', path.join(made, 'app.db'))
    );
    fs.mkdirSync(path.join(made, 'db/migrations/meta'), { recursive: true });
    fs.writeFileSync(
      path.join(made, 'db/migrations/0000_init.sql'),
      'CREATE TABLE tasks (id integer primary key);\n'
    );
    fs.writeFileSync(
      path.join(made, 'db/migrations/meta/_journal.json'),
      JSON.stringify({
        dialect: 'sqlite',
        entries: [
          {
            breakpoints: true,
            idx: 0,
            tag: '0000_init',
            version: '7',
            when: 1788651338666,
          },
        ],
        version: '7',
      })
    );
    linkAdapter(made, 'core', 'drizzle');
    install(made, 'better-sqlite3', sqlite);

    return made;
  };

  /**
   * The schema step of `henri doctor`, on its own
   *
   * @param {string} where The application directory
   * @returns {Promise<Array<object>>} The problems it added
   */
  const ask = async (where) => {
    const report = {
      ok: true,
      problems: [],
      summary: { errors: 0, warnings: 0 },
    };

    await schema(where, report);

    return report.problems;
  };

  afterEach(() => cleanup(app));

  test('says how far behind db/migrations a store that answers is', async () => {
    app = migrating();

    expect(await ask(app)).toContainEqual(
      expect.objectContaining({
        check: 'schema.behind',
        file: 'db/migrations',
        hint: expect.stringContaining('henri db:migrate'),
        level: 'warning',
        message: expect.stringContaining('behind db/migrations by 1 migration'),
      })
    );
  });

  // The one that matters: a store that is down and a store that is behind
  // are different problems, and doctor never reports one as the other
  test('says it could not tell when the store does not answer', async () => {
    app = migrating();

    // A url whose folder cannot be made: the driver never opens anything
    fs.writeFileSync(path.join(app, 'blocked'), 'not a directory');

    const config = path.join(app, 'config/default.json');

    fs.writeFileSync(
      config,
      fs
        .readFileSync(config, 'utf8')
        .replace(
          JSON.stringify(path.join(app, 'app.db')).slice(1, -1),
          `${path.join(app, 'blocked')}/app.db`
        )
    );

    const problems = await ask(app);

    expect(problems.map((entry) => entry.check)).toEqual([
      'schema.unreachable',
    ]);
    expect(problems[0]).toMatchObject({
      hint: expect.stringContaining('henri db:status'),
      level: 'warning',
      message: expect.stringContaining('could not tell'),
    });
  });

  test('says nothing when the store holds every migration', async () => {
    app = migrating();

    const Drizzle = require(path.join(app, 'node_modules/@usehenri/drizzle'));
    const store = JSON.parse(
      fs.readFileSync(path.join(app, 'config/default.json'), 'utf8')
    ).stores.default;
    const adapter = new Drizzle('default', store, {
      config: { get: () => undefined, has: () => false },
      cwd: () => app,
      isDev: false,
      isProduction: false,
      isTest: false,
      pen: {
        debug: () => null,
        error: () => null,
        fatal: (name, message) => new Error(message),
        info: () => null,
        warn: () => null,
      },
    });

    process.env.HENRI_SKIP_SYNC = 'true';
    await adapter.start();
    await adapter.migrations.migrate();
    await adapter.stop();
    delete process.env.HENRI_SKIP_SYNC;

    expect(await ask(app)).toEqual([]);
  });

  test('asks nothing at all without a migration written', async () => {
    app = migrating();

    fs.rmSync(path.join(app, 'db'), { recursive: true });

    expect(await ask(app)).toEqual([]);
    // And the database was never opened: nothing here writes
    expect(fs.existsSync(path.join(app, 'app.db'))).toBe(false);
  });

  // A store whose adapter keeps no migration history is compared with the
  // models instead, and that needs them loaded: `henri db:status` is that
  // command, and doctor says nothing rather than half of it
  test('leaves a store with no migrations to henri db:status', async () => {
    app = migrating({ adapter: 'disk' });

    expect(await ask(app)).toEqual([]);
  });
});
