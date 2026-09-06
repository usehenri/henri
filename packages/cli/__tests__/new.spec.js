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
      'app/views/pages/index.jsx',
      'app/views/index.html',
      'app/views/main.jsx',
      'app/views/ssr.jsx',
      'app/views/vite.config.mjs',
      'app/views/jsconfig.json',
      'app/views/styles/index.css',
      'eslint.config.js',
      'Dockerfile',
      '.dockerignore',
    ]) {
      expect(exists(app, file)).toBe(true);
    }

    // The old Tasks model is gone, the sample resource is a scaffold
    expect(exists(app, 'app/models/Tasks.js')).toBe(false);
    // Nothing from the next.js template
    expect(exists(app, 'app/views/next.config.js')).toBe(false);
    expect(exists(app, 'app/views/pages/_app.js')).toBe(false);
  });

  test('writes a Dockerfile that installs, builds and runs as node', () => {
    const file = read(app, 'Dockerfile');
    const pm = detectPackageManager(app);

    // The install is production only, so henri has to be a dependency
    expect(JSON.parse(read(app, 'package.json')).dependencies.henri).toMatch(
      /^\^\d/u
    );

    expect(file).toContain(`FROM \${NODE_IMAGE} AS build`);
    expect(file).toContain(
      { npm: 'npm ci --omit=dev', pnpm: 'pnpm install --prod' }[pm] ||
        'yarn install --production'
    );
    expect(file).toContain('node_modules/.bin/henri build');
    expect(file).toContain('USER node');
    // Readiness, not liveness: an unreachable database is not a restart
    expect(file).toContain('/readyz');
    expect(file).not.toContain('/livez');
    // The default store is a sqlite file: it deploys, but the file is
    // inside the container unless a volume is mounted over it
    expect(file).toContain('Mount a volume over it');
    // Its driver ships the compiled addon in its own tarball, so the image
    // needs no C++ toolchain at all
    expect(file).not.toContain('compiles on install');
    expect(file).not.toContain('python3 make g++');

    const ignored = read(app, '.dockerignore');

    for (const entry of ['node_modules', '.env', '.henri', '.git']) {
      expect(ignored).toContain(entry);
    }
  });

  test('the Dockerfile of a zero-config app says it is not one', () => {
    const { app: zero, dir: elsewhere } = scaffold([
      '--no-git',
      '--adapter',
      'disk',
    ]);

    try {
      const file = read(zero, 'Dockerfile');

      // The zero-config store cannot be what an image runs on
      expect(file).toContain('point the application at a real database');
      // And it compiles nothing
      expect(file).not.toContain('python3 make g++');
    } finally {
      cleanup(elsewhere);
    }
  });

  test('always writes pnpm-workspace.yaml (npm and yarn ignore it)', () => {
    expect(exists(app, 'pnpm-workspace.yaml')).toBe(true);
    expect(read(app, 'pnpm-workspace.yaml')).toContain('allowBuilds:');
  });

  test('says which package manager it picked', () => {
    expect(result.stdout).toContain(`- Using ${detectPackageManager(app)} (`);
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
    expect(readme).toContain('Inertia (React) pages');
    expect(readme).toContain('`.jsx` pages');
    expect(readme).toContain('henri destroy scaffold Task');
  });

  test('keeps the secret out of the committed config', () => {
    const config = JSON.parse(read(app, 'config/default.json'));
    const ignored = read(app, '.gitignore');

    expect(config).toEqual({
      baseRole: 'guest',
      renderer: 'inertia',
      stores: {
        default: {
          adapter: 'drizzle',
          dialect: 'sqlite',
          url: 'file:.henri/app.db',
        },
      },
      user: 'user',
    });
    expect(config.secret).toBeUndefined();
    expect(config.log).toBeUndefined();

    expect(read(app, '.env')).toMatch(/^HENRI_SECRET=[0-9a-f]{128}$/m);

    expect(ignored).toMatch(/^\.env$/m);
    expect(ignored).toMatch(/^\/config\/local\.json$/m);
    expect(ignored).not.toContain('/config/*.json');
  });

  test('scaffolds the sample Task resource as Inertia pages', () => {
    for (const file of [
      'app/models/Task.js',
      'app/controllers/tasks.js',
      'app/views/pages/tasks/index.jsx',
      'app/views/pages/tasks/new.jsx',
      'app/views/pages/tasks/edit.jsx',
      'app/views/pages/tasks/show.jsx',
      'app/views/pages/tasks/_form.jsx',
      'test/tasks.test.js',
    ]) {
      expect(exists(app, file)).toBe(true);
    }

    // No .js page next to them: the renderer picks one extension
    expect(exists(app, 'app/views/pages/tasks/index.js')).toBe(false);

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

    expect(read(app, 'app/controllers/main.js')).toContain('Task.find()');
  });

  test('the sample pages read the controller data through useHenri', () => {
    const index = read(app, 'app/views/pages/tasks/index.jsx');

    expect(index).toContain("from '@usehenri/inertia'");
    expect(index).toContain('const { data, getRoute } = useHenri();');
    expect(index).toContain('const tasks = data.tasks || [];');
    // An Inertia visit, not a fetch(): the controller redirects afterwards
    expect(index).toContain(
      "router.delete(getRoute('destroy_tasks_path', id))"
    );
    expect(index).not.toContain('withHenri');
    expect(index).not.toContain("from 'next/link'");
  });

  test('the sample form shows the errors the controller renders with', () => {
    const form = read(app, 'app/views/pages/tasks/_form.jsx');
    const controller = read(app, 'app/controllers/tasks.js');

    expect(form).toContain("import { Form } from '@usehenri/inertia';");
    expect(form).toContain('{({ errors, processing }) => (');
    expect(form).toContain('<p className={message}>{errors.name}</p>');

    // A failed write renders the page again with res.inertia.errors(), and
    // still answers a 422 to an API client
    expect(controller).toContain('res.inertia.errors(errors)');
    expect(controller).toContain("invalid(res, error, '/tasks/new')");
    expect(controller).toContain(
      "invalid(res, error, '/tasks/edit', { task: req.task })"
    );
    expect(controller).toContain('res.boom.badData(error.message, { errors })');
  });

  test('writes a test that checks the page and the HAL answers', () => {
    const test = read(app, 'test/tasks.test.js');

    expect(test).toContain(
      "const { request, setup } = require('@usehenri/testing');"
    );
    expect(test).toContain("set('X-Inertia', 'true')");
    expect(test).toContain("expect(response.body.component).toBe('tasks');");
    expect(test).toContain(
      "expect(response.body._links.self.href).toBe('/tasks')"
    );
  });

  test('writes the files coding agents read', () => {
    const agents = read(app, 'AGENTS.md');

    expect(result.stdout).toContain('AGENTS.md');
    expect(agents.startsWith('# app: conventions for coding agents')).toBe(
      true
    );
    expect(agents).toContain('renderer `inertia`');
    expect(agents).toContain('Inertia pages (`.jsx`)');
    expect(agents).toContain('@usehenri/inertia');
    expect(agents).not.toContain('next.js pages');
    expect(agents).not.toContain('{{');
    // A budget, not a target: AGENTS.md is read on every task, so it stays
    // short. Compress before raising it again. It went from 170 to 185 for
    // the policies section: an agent that does not know app/policies exists
    // writes the ownership `if` in the controller, which is the mistake the
    // feature is there to stop.
    expect(agents.split('\n').length).toBeLessThan(185);
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

    expect(pkg.dependencies['@inertiajs/react']).toMatch(/^\^3\./);
    expect(pkg.dependencies.vite).toMatch(/^\^8\./);
    expect(pkg.dependencies['@vitejs/plugin-react']).toMatch(/^\^6\./);
    expect(pkg.dependencies.react).toMatch(/^\^19\./);
    expect(pkg.dependencies['react-dom']).toMatch(/^\^19\./);
    expect(pkg.dependencies.next).toBeUndefined();
    expect(pkg.devDependencies.eslint).toMatch(/^\^9\./);
  });

  test('wires tailwind css through the vite plugin', () => {
    const pkg = JSON.parse(read(app, 'package.json'));

    expect(pkg.dependencies.tailwindcss).toMatch(/^\^4\./);
    expect(pkg.dependencies['@tailwindcss/vite']).toMatch(/^\^4\./);
    expect(pkg.dependencies['@tailwindcss/postcss']).toBeUndefined();

    expect(read(app, 'app/views/vite.config.mjs')).toContain(
      "import tailwindcss from '@tailwindcss/vite'"
    );

    const css = read(app, 'app/views/styles/index.css');

    expect(css).toContain("@import 'tailwindcss'");
    expect(css).toContain("@source '../pages/**/*.{js,jsx}'");

    // The stylesheet is loaded once, from the browser entry
    expect(read(app, 'app/views/main.jsx')).toContain(
      "import './styles/index.css'"
    );
    expect(exists(app, 'app/views/styles/index.scss')).toBe(false);
  });

  test('styles the sample pages, dark mode included', () => {
    for (const page of [
      'app/views/pages/index.jsx',
      'app/views/pages/tasks/index.jsx',
      'app/views/pages/tasks/_form.jsx',
    ]) {
      expect(read(app, page)).toMatch(/className=.*dark:|dark:[a-z]/);
    }
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

  test('--pm forces the package manager and says so', () => {
    const { status, stdout } = henri(
      ['new', 'forced', '--skip-install', '--no-git', '--pm', 'npm'],
      { cwd: dir }
    );
    const app = path.join(dir, 'forced');

    expect(status).toBe(0);
    expect(stdout).toContain('- Using npm (--pm)');
    expect(stdout).toContain('npm install && henri server');
    expect(read(app, 'README.md')).toContain('npm install');
    // The workspace file is inert for npm, and there for a later pnpm install
    expect(exists(app, 'pnpm-workspace.yaml')).toBe(true);
  });

  test('rejects an unknown package manager', () => {
    const { status, stderr } = henri(
      ['new', 'bun', '--skip-install', '--no-git', '--pm', 'bun'],
      { cwd: dir }
    );

    expect(status).toBe(2);
    expect(stderr).toContain("Unknown package manager 'bun'");
    expect(stderr).toContain('pnpm, yarn, npm');
  });

  test('prints the usage without a folder', () => {
    const { status, stdout, stderr } = henri(['new'], { cwd: dir });

    expect(status).toBe(2);
    expect(stdout).toContain('$ henri new <folder>');
    expect(stderr).toContain('Missing folder');
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

// The Next.js engine is frozen, not removed: `--renderer react` keeps
// scaffolding a working application, with the same resource in `.js` pages.
describe('henri new --renderer react', () => {
  let dir;
  let app;

  beforeAll(() => {
    ({ app, dir } = scaffold(['--no-git', '--renderer', 'react']));
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('scaffolds the next.js structure', () => {
    for (const file of [
      'app/views/pages/index.js',
      'app/views/pages/_app.js',
      'app/views/next.config.js',
      'app/views/postcss.config.mjs',
      'app/views/jsconfig.json',
      'vitest.config.js',
    ]) {
      expect(exists(app, file)).toBe(true);
    }

    // Nothing from the inertia template
    for (const file of [
      'app/views/main.jsx',
      'app/views/ssr.jsx',
      'app/views/vite.config.mjs',
    ]) {
      expect(exists(app, file)).toBe(false);
    }

    expect(JSON.parse(read(app, 'config/default.json')).renderer).toBe('react');
  });

  test('scaffolds the same Task resource as next.js pages', () => {
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

    expect(exists(app, 'app/views/pages/tasks/index.jsx')).toBe(false);

    expect(routesOf(app)).toEqual({
      'get /': 'main#home',
      'resources tasks': 'tasks',
    });

    const index = read(app, 'app/views/pages/tasks/index.js');

    expect(index).toContain("import withHenri from '@usehenri/react';");
    expect(index).toContain("fetch(pathFor('destroy_tasks_path'");
    expect(index).not.toContain('@usehenri/inertia');
  });

  test('answers a failed write with a 422 the forms read', () => {
    const controller = read(app, 'app/controllers/tasks.js');

    expect(controller).toContain('return invalid(res, error);');
    expect(controller).toContain('res.boom.badData(error.message, { errors })');
    expect(controller).not.toContain('res.inertia');
    expect(read(app, 'app/views/pages/tasks/_form.js')).toContain(
      "from '@usehenri/react/forms'"
    );
  });

  test('writes a HAL test, without the Inertia page object', () => {
    const test = read(app, 'test/tasks.test.js');

    expect(test).toContain(
      "expect(response.body._links.self.href).toBe('/tasks')"
    );
    expect(test).not.toContain('X-Inertia');
  });

  test('describes react in AGENTS.md and the README', () => {
    const agents = read(app, 'AGENTS.md');

    expect(agents).toContain('renderer `react`');
    expect(agents).toContain('next.js pages (`.js`)');
    expect(agents).toContain('@usehenri/react');
    expect(agents).not.toContain('Inertia');
    expect(agents).not.toContain('{{');
    expect(agents.split('\n').length).toBeLessThan(185);
    expect(exists(app, '.mcp.json')).toBe(true);

    const readme = read(app, 'README.md');

    expect(readme).toContain('React pages rendered by next.js');
    expect(readme).toContain('`.js` pages');
  });

  test('pins the next.js dependencies and wires tailwind through postcss', () => {
    const pkg = JSON.parse(read(app, 'package.json'));

    expect(pkg.dependencies.next).toMatch(/^\^16\./);
    expect(pkg.dependencies.react).toMatch(/^\^19\./);
    expect(pkg.dependencies['react-dom']).toMatch(/^\^19\./);
    expect(pkg.dependencies['@inertiajs/react']).toBeUndefined();
    expect(pkg.devDependencies.eslint).toMatch(/^\^9\./);

    expect(pkg.dependencies.tailwindcss).toMatch(/^\^4\./);
    expect(pkg.dependencies['@tailwindcss/postcss']).toMatch(/^\^4\./);
    expect(pkg.dependencies['@tailwindcss/vite']).toBeUndefined();

    expect(read(app, 'app/views/postcss.config.mjs')).toContain(
      "'@tailwindcss/postcss': {}"
    );

    const css = read(app, 'app/views/styles/index.css');

    expect(css).toContain("@import 'tailwindcss'");
    expect(css).toContain("@source '../pages/**/*.{js,jsx}'");

    // The stylesheet is loaded once, from _app (next.js global styles rule)
    expect(read(app, 'app/views/pages/_app.js')).toContain(
      "import '../styles/index.css'"
    );
    expect(exists(app, 'app/views/styles/index.scss')).toBe(false);
  });

  test('styles the sample pages, dark mode included', () => {
    for (const page of [
      'app/views/pages/index.js',
      'app/views/pages/tasks/index.js',
      'app/views/pages/tasks/_form.js',
    ]) {
      expect(read(app, page)).toMatch(/className=.*dark:|dark:[a-z]/);
    }
  });

  test('rejects an unknown renderer with the usage exit code', () => {
    const { status, stderr } = henri(
      ['new', 'bad', '--skip-install', '--no-git', '--renderer', 'nope'],
      { cwd: dir }
    );

    expect(status).toBe(2);
    expect(stderr).toContain("Unknown renderer 'nope'");
  });
});
