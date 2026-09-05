const fs = require('fs');
const path = require('path');

const { ENGINES } = require('../scripts/build');
const { cleanup, exists, henri, read, scaffold } = require('./helpers');

/**
 * Install a fake view engine in the app: its build() records its arguments
 * in build.json instead of building anything
 *
 * @param {string} app Application directory
 * @param {string} name Engine module (ex: @usehenri/react/engine)
 * @param {string} shape 'function' (module.exports.build) or 'static' (class)
 * @returns {void}
 */
const fakeEngine = (app, name, shape) => {
  const dir = path.join(app, 'node_modules', name);
  const record = `
const fs = require('fs');
const path = require('path');
const build = async ({ cwd, config }) => {
  fs.writeFileSync(
    path.join(cwd, 'build.json'),
    JSON.stringify({ config, cwd, env: process.env.NODE_ENV, name: '${name}' })
  );
  return { built: true };
};
`;
  const code =
    shape === 'static'
      ? `${record}\nclass Engine { static build(opts) { return build(opts); } }\nmodule.exports = Engine;\n`
      : `${record}\nmodule.exports = { build };\n`;

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.js'), code);
};

/**
 * Set the renderer of the app
 *
 * @param {string} app Application directory
 * @param {string} renderer Renderer name
 * @returns {void}
 */
const setRenderer = (app, renderer) => {
  const file = path.join(app, 'config', 'default.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));

  fs.writeFileSync(file, JSON.stringify({ ...config, renderer }, null, 2));
};

describe('henri build', () => {
  let dir;
  let app;

  beforeAll(() => {
    ({ app, dir } = scaffold());
  });

  afterAll(() => {
    cleanup(dir);
  });

  beforeEach(() => {
    fs.rmSync(path.join(app, 'build.json'), { force: true });
  });

  test('knows the engines that need a build', () => {
    expect(ENGINES).toEqual({
      inertia: '@usehenri/inertia/engine',
      react: '@usehenri/react/engine',
    });
  });

  test('fails clearly when the react engine is not installed', () => {
    // A clean environment: the test runner's own NODE_OPTIONS/NODE_PATH
    // would let the child resolve the workspace's @usehenri/react
    const { status, stderr } = henri(['build'], {
      cwd: app,
      env: { HOME: process.env.HOME, PATH: process.env.PATH },
    });

    expect(status).toBe(1);
    expect(stderr).toContain(
      '@usehenri/react is not installed in this project'
    );
  });

  test('calls the react engine build without booting henri', () => {
    fakeEngine(app, '@usehenri/react/engine', 'function');

    const { status, stderr } = henri(['build'], { cwd: app });

    expect(stderr).toBe('');
    expect(status).toBe(0);

    const call = JSON.parse(read(app, 'build.json'));

    expect(call.name).toBe('@usehenri/react/engine');
    expect(fs.realpathSync(call.cwd)).toBe(fs.realpathSync(app));
    expect(call.config.renderer).toBe('react');
    expect(call.env).toBe('production');
  });

  test('calls the inertia engine static build', () => {
    setRenderer(app, 'inertia');
    fakeEngine(app, '@usehenri/inertia/engine', 'static');

    const { status, stderr } = henri(['build'], { cwd: app });

    expect(stderr).toBe('');
    expect(status).toBe(0);

    const call = JSON.parse(read(app, 'build.json'));

    expect(call.name).toBe('@usehenri/inertia/engine');
    expect(call.config.renderer).toBe('inertia');
  });

  test('has nothing to do for the template renderer', () => {
    setRenderer(app, 'template');

    const { status, stdout } = henri(['build'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain('"template" renderer needs no build');
    expect(exists(app, 'build.json')).toBe(false);
  });

  test('reads config/production.json first', () => {
    setRenderer(app, 'template');
    fs.writeFileSync(
      path.join(app, 'config', 'production.json'),
      JSON.stringify({ renderer: 'inertia' })
    );

    const { status } = henri(['build'], { cwd: app });

    expect(status).toBe(0);
    expect(JSON.parse(read(app, 'build.json')).config).toEqual({
      renderer: 'inertia',
    });
  });
});
