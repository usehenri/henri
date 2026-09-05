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

    const { status, stdout } = henri(['new', 'taken', '--skip-install'], {
      cwd: dir,
    });

    expect(status).toBe(1);
    expect(stdout).toContain('not empty');
    expect(fs.existsSync(path.join(dir, 'taken', 'package.json'))).toBe(false);
  });

  test('prints the usage without a folder', () => {
    const { status, stdout } = henri(['new'], { cwd: dir });

    expect(status).toBe(1);
    expect(stdout).toContain('$ henri new <folder>');
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

    const { status, stdout } = henri(['init', '--skip-install', '--no-git'], {
      cwd: app,
    });

    expect(status).toBe(1);
    expect(stdout).toContain("already have an 'app' folder");
  });
});
