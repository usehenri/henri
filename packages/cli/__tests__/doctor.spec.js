const fs = require('fs');
const path = require('path');

const {
  check,
  definesAction,
  definesGraphql,
  ignores,
  looksPlural,
  packageForShared,
  reach,
} = require('../scripts/doctor');
const { cleanup, henri, scaffold } = require('./helpers');

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
    const file = path.join(app, 'config/default.json');
    const original = fs.readFileSync(file, 'utf8');

    fs.writeFileSync(
      file,
      JSON.stringify({
        ...JSON.parse(original),
        stores: { default: { adapter: 'redis' }, sql: { adapter: 'mysql' } },
      })
    );

    const { names, problems } = run(app);

    fs.writeFileSync(file, original);

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
    const file = path.join(app, 'config/default.json');
    const original = fs.readFileSync(file, 'utf8');
    const config = JSON.parse(original);

    fs.writeFileSync(
      file,
      JSON.stringify({ ...config, uploads: { maxFileSize: '5mb' } }, null, 2)
    );

    const { problems } = run(app);

    fs.writeFileSync(file, original);

    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'deps.declared',
        hint: expect.stringContaining('@usehenri/uploads'),
        level: 'error',
      })
    );

    expect(run(app).names).not.toContain('deps.declared');
  });

  // `config.shared` names the backend the rate limit, the sign-in lockout
  // and the idempotency keys count in, the way a store names its adapter
  test('asks for @usehenri/redis when config.shared names it', () => {
    const file = path.join(app, 'config/default.json');
    const original = fs.readFileSync(file, 'utf8');
    const config = JSON.parse(original);

    config.shared = { adapter: 'redis', url: 'redis://127.0.0.1:6399' };
    fs.writeFileSync(file, JSON.stringify(config, null, 2));

    const { problems } = run(app);

    fs.writeFileSync(file, original);

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
    const file = path.join(app, 'config/default.json');
    const original = fs.readFileSync(file, 'utf8');
    const config = JSON.parse(original);
    const backend = path.join(app, 'lib');

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

    config.shared = { adapter: './lib/shared' };
    fs.writeFileSync(file, JSON.stringify(config, null, 2));

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
    config.shared = { adapter: './lib/up' };
    fs.writeFileSync(file, JSON.stringify(config, null, 2));

    await reach(app, fresh);

    expect(fresh.problems).toEqual([]);

    // An adapter that is not installed is `deps.declared`, not this
    config.shared = { adapter: 'nowhere' };
    fs.writeFileSync(file, JSON.stringify(config, null, 2));

    const absent = { problems: [], summary: { warnings: 0 } };

    await reach(app, absent);
    fs.writeFileSync(file, original);
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
    const config = path.join(app, 'config/default.json');
    const original = fs.readFileSync(config, 'utf8');
    const folder = path.join(app, 'db/migrations');

    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, '0000_init.sql'), 'CREATE TABLE a(b);');
    fs.writeFileSync(
      config,
      JSON.stringify({
        ...JSON.parse(original),
        stores: { default: { adapter: 'postgresql', url: 'postgres://x/y' } },
      })
    );

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
    fs.writeFileSync(
      config,
      JSON.stringify({
        ...JSON.parse(original),
        stores: { default: { adapter: 'drizzle', url: 'postgres://x/y' } },
      })
    );

    const drizzle = run(app);

    expect(drizzle.names).not.toContain('schema.migrations-ignored');
    expect(drizzle.problems).toContainEqual(
      expect.objectContaining({
        check: 'schema.migrations-pending',
        level: 'warning',
      })
    );

    // With "migrate": true in the production configuration, it is applied
    const production = path.join(app, 'config/production.json');

    fs.writeFileSync(
      production,
      JSON.stringify({
        stores: { default: { adapter: 'drizzle', migrate: true } },
      })
    );

    expect(run(app).names).not.toContain('schema.migrations-pending');

    fs.unlinkSync(production);
    fs.rmSync(folder, { recursive: true });
    fs.writeFileSync(config, original);
  });

  test('refuses to run outside of a project', () => {
    const { status, stderr } = henri(['doctor', '--json'], { cwd: dir });

    expect(status).toBe(3);
    expect(JSON.parse(stderr).error.code).toBe('HENRI_CLI_NOT_A_PROJECT');
  });
});
