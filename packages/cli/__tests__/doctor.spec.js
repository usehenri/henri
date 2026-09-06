const fs = require('fs');
const path = require('path');

const {
  check,
  definesAction,
  ignores,
  looksPlural,
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
        renderer: 'react',
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
      code: 'CHECKS_FAILED',
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
    const show = path.join(app, 'app/views/pages/tasks/show.js');
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
        message: expect.stringContaining('app/views/pages/tasks/show.js'),
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

  test('refuses to run outside of a project', () => {
    const { status, stderr } = henri(['doctor', '--json'], { cwd: dir });

    expect(status).toBe(3);
    expect(JSON.parse(stderr).error.code).toBe('NOT_A_PROJECT');
  });
});
