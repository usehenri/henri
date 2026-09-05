/**
 * Builds the fixture application under __tests__/fixture with Vite's
 * programmatic API (through the engine) and renders it, in production and
 * development modes. Runs in a child process: vite and the server bundle are
 * ESM, see fixture/harness.js.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const fixture = path.join(__dirname, 'fixture');
const harness = path.join(fixture, 'harness.js');
const dist = path.join(fixture, 'app', 'views', 'dist');
const TIMEOUT = 180000;

/**
 * Run the harness in a mode and parse its report
 *
 * @param {string} mode build, production or development
 * @returns {object} the report
 */
function run(mode) {
  const result = spawnSync(process.execPath, [harness, mode], {
    cwd: fixture,
    encoding: 'utf8',
    timeout: TIMEOUT,
  });

  if (result.status !== 0) {
    throw new Error(
      `harness ${mode} failed (${result.status}): ${result.stderr}\n${result.stdout}`
    );
  }

  // The report is the last line (vite may log before it)
  const lines = result.stdout.trim().split('\n');

  return JSON.parse(lines[lines.length - 1]);
}

describe('inertia ssr (fixture application)', () => {
  test(
    'builds the client and server bundles',
    () => {
      fs.rmSync(dist, { force: true, recursive: true });

      const { build } = run('build');

      expect(fs.existsSync(build.client)).toBe(true);
      expect(build.ssr).toMatch(/dist[\\/]ssr[\\/]ssr\.mjs$/);
      expect(fs.existsSync(build.ssr)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(build.client, 'utf8'));

      expect(manifest['main.jsx'].isEntry).toBe(true);
      expect(manifest['main.jsx'].dynamicImports).toEqual(
        expect.arrayContaining(['pages/index.jsx', 'pages/tasks/index.jsx'])
      );
      expect(typeof build.duration).toBe('number');
    },
    TIMEOUT
  );

  test(
    'renders / with the production build',
    () => {
      const out = run('production');

      expect(out.middlewares).toEqual(['inertia']);
      expect(out.version).toMatch(/^[a-f0-9]{32}$/);

      expect(out.html.status).toBe(200);
      expect(out.html.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(out.html.body).toContain('<h1>hello from the fixture</h1>');
      expect(out.html.body).toContain('<p class="user">felix@example.com</p>');
      expect(out.html.body).toContain('<a href="/tasks">tasks</a>');
      expect(out.html.body).toContain(
        '<title data-inertia="">fixture home</title>'
      );
      expect(out.html.body).toContain(
        '<script data-page="app" type="application/json">'
      );
      expect(out.html.body).toContain(
        '<div data-server-rendered="true" id="app">'
      );
      expect(out.html.body).toMatch(
        /<script type="module" src="\/assets\/main-[\w-]+\.js"><\/script>/
      );
      expect(out.html.body).not.toContain('/@vite/client');

      expect(out.json.status).toBe(200);
      expect(out.json.headers['x-inertia']).toBe('true');
      expect(out.json.body.component).toBe('tasks/index');
      expect(out.json.body.props.data.tasks).toEqual([{ name: 'write tests' }]);
      expect(out.json.body.props.paths.index_tasks_path.route).toBe('/tasks');
      expect(out.json.body.version).toBe(out.version);

      // Rendering '/tasks' finds pages/tasks/index.jsx
      expect(out.tasks.status).toBe(200);
      expect(out.tasks.body).toContain('<li>ship inertia</li>');
    },
    TIMEOUT
  );

  test(
    'renders / through the vite dev server',
    () => {
      const out = run('development');

      expect(out.html.status).toBe(200);
      expect(out.html.body).toContain(
        '<script type="module" src="/@vite/client">'
      );
      expect(out.html.body).toContain('<script type="module" src="/main.jsx">');
      expect(out.html.body).toContain('<h1>hello from the fixture</h1>');
      expect(out.html.body).toContain(
        '<div data-server-rendered="true" id="app">'
      );
      expect(out.json.body.component).toBe('tasks/index');
      expect(out.tasks.body).toContain('<li>ship inertia</li>');
    },
    TIMEOUT
  );
});
