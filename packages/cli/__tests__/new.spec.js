const fs = require('fs');
const path = require('path');

const { version } = require('../package.json');
const { detectPackageManager } = require('../scripts/utils');
const {
  cleanup,
  exists,
  henri,
  read,
  routesOf,
  scaffold,
  tmpdir,
} = require('./helpers');

describe('henri new', () => {
  let dir;
  let app;
  let result;

  beforeAll(() => {
    ({ app, dir, result } = scaffold([]));
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('scaffolds the app structure', () => {
    for (const file of [
      'package.json',
      'README.md',
      '.env',
      '.gitignore',
      'config/default.json',
      'config/routes.js',
      'app/controllers/main.js',
      'app/views/pages/index.js',
      'app/views/pages/_app.js',
      'app/views/next.config.js',
      'app/views/jsconfig.json',
      'eslint.config.js',
    ]) {
      expect(exists(app, file)).toBe(true);
    }

    // The old Tasks model is gone, the sample resource is a scaffold
    expect(exists(app, 'app/models/Tasks.js')).toBe(false);
  });

  test('writes pnpm-workspace.yaml only for pnpm', () => {
    expect(exists(app, 'pnpm-workspace.yaml')).toBe(
      detectPackageManager(app) === 'pnpm'
    );
  });

  test('initializes a git repository', () => {
    expect(fs.existsSync(path.join(app, '.git'))).toBe(true);
    expect(result.stdout).toContain('Initialized a git repository');
  });

  test('writes a README for the app', () => {
    const readme = read(app, 'README.md');

    expect(readme.startsWith('# app\n')).toBe(true);
    expect(readme).toContain('henri server');
    expect(readme).toContain('HENRI_SECRET');
  });

  test('keeps the secret out of the committed config', () => {
    const config = JSON.parse(read(app, 'config/default.json'));
    const ignored = read(app, '.gitignore');

    expect(config).toEqual({
      baseRole: 'guest',
      renderer: 'react',
      stores: { default: { adapter: 'disk' } },
      user: 'user',
    });
    expect(config.secret).toBeUndefined();
    expect(config.log).toBeUndefined();

    expect(read(app, '.env')).toMatch(/^HENRI_SECRET=[0-9a-f]{128}$/m);

    expect(ignored).toMatch(/^\.env$/m);
    expect(ignored).toMatch(/^\/config\/local\.json$/m);
    expect(ignored).not.toContain('/config/*.json');
  });

  test('scaffolds the sample Task resource', () => {
    for (const file of [
      'app/models/Task.js',
      'app/controllers/tasks.js',
      'app/views/pages/tasks/index.js',
      'app/views/pages/tasks/new.js',
      'app/views/pages/tasks/edit.js',
      'app/views/pages/tasks/show.js',
      'app/views/pages/tasks/_form.js',
      'test/tasks.test.js',
    ]) {
      expect(exists(app, file)).toBe(true);
    }

    const model = require(path.join(app, 'app/models/Task.js'));

    expect(model.schema.name).toEqual({ required: true, type: 'string' });
    expect(model.schema.category.enum).toEqual([
      'urgent',
      'high',
      'medium',
      'low',
    ]);
    expect(model.schema.done).toEqual({ default: false, type: 'boolean' });

    expect(routesOf(app)).toEqual({
      'get /': 'main#home',
      'resources tasks': 'tasks',
    });

    expect(read(app, 'test/tasks.test.js')).toContain(
      "const { request, setup } = require('@usehenri/testing');"
    );
    expect(read(app, 'app/controllers/main.js')).toContain('Task.find()');
  });

  test('writes the files coding agents read', () => {
    const agents = read(app, 'AGENTS.md');

    expect(result.stdout).toContain('AGENTS.md');
    expect(agents.startsWith('# app: conventions for coding agents')).toBe(
      true
    );
    expect(agents).toContain('renderer `react`');
    expect(agents).toContain('next.js pages');
    expect(agents).not.toContain('Inertia');
    expect(agents).not.toContain('{{');
    expect(agents.split('\n').length).toBeLessThan(150);
    expect(agents).toContain('henri generate scaffold');
    expect(agents).toContain('req.permit');
    expect(agents).toContain('HENRI_SECRET');
    expect(agents).toContain('## Do not');

    expect(read(app, 'CLAUDE.md')).toContain('AGENTS.md');
    expect(JSON.parse(read(app, '.mcp.json'))).toEqual({
      mcpServers: { henri: { args: ['mcp'], command: 'henri' } },
    });
    expect(
      JSON.parse(read(app, 'package.json')).devDependencies
    ).toHaveProperty('@usehenri/mcp');
  });

  test('depends on the @usehenri packages at the cli version', () => {
    const pkg = JSON.parse(read(app, 'package.json'));
    const internal = Object.entries({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    }).filter(([name]) => name.startsWith('@usehenri/'));

    expect(internal.length).toBeGreaterThan(0);
    for (const [, range] of internal) {
      expect(range).toBe(`^${version}`);
    }
    expect(pkg.devDependencies['@usehenri/testing']).toBe(`^${version}`);
    expect(pkg.henri).toBe(version);
    expect(pkg.name).toBe('app');
  });

  test('pins the versions of the view dependencies', () => {
    const pkg = JSON.parse(read(app, 'package.json'));

    expect(pkg.dependencies.next).toMatch(/^\^16\./);
    expect(pkg.dependencies.react).toMatch(/^\^19\./);
    expect(pkg.dependencies['react-dom']).toMatch(/^\^19\./);
    expect(pkg.devDependencies.eslint).toMatch(/^\^9\./);
  });
});

describe('henri new options', () => {
  let dir;

  beforeAll(() => {
    dir = tmpdir('henri-new-opts-');
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('--no-git skips git init', () => {
    const { status, stdout } = henri(
      ['new', 'nogit', '--skip-install', '--no-git'],
      { cwd: dir }
    );

    expect(status).toBe(0);
    expect(stdout).not.toContain('git repository');
    expect(fs.existsSync(path.join(dir, 'nogit', '.git'))).toBe(false);
  });

  test('refuses a non-empty folder without --force', () => {
    fs.mkdirSync(path.join(dir, 'taken'));
    fs.writeFileSync(path.join(dir, 'taken', 'notes.txt'), 'hi');

    const { status, stderr } = henri(['new', 'taken', '--skip-install'], {
      cwd: dir,
    });

    expect(status).toBe(1);
    expect(stderr).toContain('not empty');
    expect(stderr).toContain('--force');
    expect(fs.existsSync(path.join(dir, 'taken', 'package.json'))).toBe(false);
  });

  test('prints the usage without a folder', () => {
    const { status, stdout, stderr } = henri(['new'], { cwd: dir });

    expect(status).toBe(2);
    expect(stdout).toContain('$ henri new <folder>');
    expect(stderr).toContain('Missing folder');
  });

  test('keeps the sample of the inertia template and describes inertia in AGENTS.md', () => {
    const { status, stdout } = henri(
      ['new', 'inertia', '--skip-install', '--no-git', '--renderer', 'inertia'],
      { cwd: dir }
    );
    const app = path.join(dir, 'inertia');

    expect(status).toBe(0);
    expect(stdout).not.toContain('Scaffolding the sample Task resource');
    // The template's own sample, nothing scaffolded next to it
    expect(fs.readdirSync(path.join(app, 'app/models'))).toHaveLength(1);
    expect(exists(app, 'app/views/pages/tasks/index.js')).toBe(false);
    expect(exists(app, 'app/views/pages/tasks/index.jsx')).toBe(true);
    expect(routesOf(app)['resources tasks']).toBeUndefined();
    expect(JSON.parse(read(app, 'config/default.json')).renderer).toBe(
      'inertia'
    );

    const agents = read(app, 'AGENTS.md');

    expect(agents).toContain('renderer `inertia`');
    expect(agents).toContain('@usehenri/inertia');
    expect(agents).not.toContain('next.js pages');
    expect(agents).not.toContain('{{');
    expect(exists(app, '.mcp.json')).toBe(true);
  });

  test('rejects an unknown renderer', () => {
    const { status, stderr } = henri(
      ['new', 'vue', '--skip-install', '--no-git', '--renderer', 'vue'],
      { cwd: dir }
    );

    expect(status).toBe(2);
    expect(stderr).toContain("Unknown renderer 'vue'");
    expect(stderr).toContain('inertia, react');
  });
});

describe('henri init', () => {
  let dir;

  beforeAll(() => {
    dir = tmpdir('henri-init-');
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('names the project after the folder and keeps an existing README', () => {
    const app = path.join(dir, 'My Shop');

    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'README.md'), '# old');

    const { status, stdout } = henri(['init', '--skip-install', '--no-git'], {
      cwd: app,
    });

    expect(status).toBe(0);
    expect(stdout).toContain('Adding new readme');
    expect(JSON.parse(read(app, 'package.json')).name).toBe('my-shop');
    expect(read(app, 'README.md').startsWith('# my-shop')).toBe(true);
    expect(read(app, 'README.old.md')).toBe('# old');
  });

  test('refuses to overwrite an app folder without --force', () => {
    const app = path.join(dir, 'existing');

    fs.mkdirSync(path.join(app, 'app'), { recursive: true });

    const { status, stderr } = henri(['init', '--skip-install', '--no-git'], {
      cwd: app,
    });

    expect(status).toBe(1);
    expect(stderr).toContain("already have an 'app' folder");
  });
});

describe('henri new --renderer inertia', () => {
  let dir;
  let app;

  beforeAll(() => {
    ({ app, dir } = scaffold(['--no-git', '--renderer', 'inertia']));
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('keeps the sample of the inertia template only', () => {
    expect(JSON.parse(read(app, 'config/default.json')).renderer).toBe(
      'inertia'
    );

    for (const file of [
      'app/models/Tasks.js',
      'app/controllers/tasks.js',
      'app/views/pages/tasks/index.jsx',
      'app/views/vite.config.mjs',
    ]) {
      expect(exists(app, file)).toBe(true);
    }

    // Nothing from the react scaffold generator
    for (const file of [
      'app/models/Task.js',
      'app/views/pages/tasks/index.js',
      'app/views/pages/tasks/_form.js',
      'test/tasks.test.js',
      'vitest.config.js',
    ]) {
      expect(exists(app, file)).toBe(false);
    }

    expect(routesOf(app)).toEqual({
      'delete /tasks/:id': 'tasks#destroy',
      'get /': 'main#home',
      'get /tasks': 'tasks#index',
      'post /tasks': 'tasks#create',
    });
  });

  test('writes a README that matches the template', () => {
    const readme = read(app, 'README.md');

    expect(readme).toContain('app/views/pages/tasks/index.jsx');
    expect(readme).toContain('Inertia (React) pages');
    expect(readme).not.toContain('destroy scaffold Task');
  });

  test('rejects an unknown renderer with a positive exit code', () => {
    const { status, stdout } = henri(
      ['new', 'bad', '--skip-install', '--no-git', '--renderer', 'nope'],
      { cwd: dir }
    );

    expect(status).toBe(1);
    expect(stdout).toContain("Unknown renderer 'nope'");
  });
});
