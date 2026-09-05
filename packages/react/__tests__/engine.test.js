const fs = require('fs');
const os = require('os');
const path = require('path');

const ReactEngine = require('../engine');
const {
  build,
  createNextConfig,
  pagePath,
  selectBundler,
} = require('../engine');
const { createWebpackHook } = require('../engine/nextConfig');

/**
 * A pen recording what the engine says
 *
 * @returns {object} the pen
 */
function fakePen() {
  const calls = { error: [], fatal: [], info: [], warn: [] };
  const record =
    (level) =>
    (...args) =>
      calls[level].push(args.join(' '));

  return {
    calls,
    error: record('error'),
    fatal: record('fatal'),
    info: record('info'),
    warn: record('warn'),
  };
}

/**
 * A henri with only what the engine touches
 *
 * @param {string} cwd the application directory
 * @param {object} [overrides] properties to override
 * @returns {object} the fake henri
 */
function fakeHenri(cwd, overrides = {}) {
  const config = { renderer: 'react' };

  return {
    config: {
      get: (key) => config[key],
      has: (key) => Object.prototype.hasOwnProperty.call(config, key),
    },
    cwd: () => cwd,
    isProduction: false,
    isTest: false,
    pen: fakePen(),
    server: { httpServer: { name: 'http-server' } },
    utils: {
      checkPackages: async () => true,
      resolvePackageJson: (name) => ({ name, version: '0.0.0-test' }),
    },
    ...overrides,
  };
}

/**
 * A `next()` stub recording its options and the calls to its handler
 *
 * @returns {{ next: function, calls: object }} the stub
 */
function fakeNext() {
  const calls = { closed: 0, handled: [], options: null, prepared: 0 };
  const next = (options) => {
    calls.options = options;

    return {
      close: async () => {
        calls.closed += 1;
      },
      getRequestHandler: () => (req, res, parsed) => {
        calls.handled.push({ parsed, req, res });

        return 'handled';
      },
      prepare: async () => {
        calls.prepared += 1;
      },
    };
  };

  return { calls, next };
}

/**
 * A throwaway application directory
 *
 * @param {object} [files] `{ 'relative/path': content }` to create
 * @returns {string} the directory
 */
function makeApp(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-react-engine-'));

  fs.mkdirSync(path.join(dir, 'app/views/pages'), { recursive: true });

  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }

  return dir;
}

describe('react engine', () => {
  const dirs = [];
  const app = (files) => {
    const dir = makeApp(files);

    dirs.push(dir);

    return dir;
  };

  afterAll(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  describe('ensureNextConfig', () => {
    test('creates next.config.js and jsconfig.json in an empty app/views', () => {
      const cwd = app();
      const engine = new ReactEngine(fakeHenri(cwd), { next: fakeNext().next });

      expect(engine.ensureNextConfig()).toEqual([
        'next.config.js',
        'jsconfig.json',
      ]);
      expect(
        fs.readFileSync(path.join(cwd, 'app/views/next.config.js'), 'utf8')
      ).toContain("require('@usehenri/react/engine/conf')");
      expect(
        JSON.parse(
          fs.readFileSync(path.join(cwd, 'app/views/jsconfig.json'), 'utf8')
        )
      ).toEqual({ compilerOptions: { baseUrl: '.' } });
    });

    test('skips the files when an alternative exists', () => {
      const cwd = app({
        'app/views/next.config.mjs': 'export default {};\n',
        'app/views/tsconfig.json': '{}\n',
      });
      const engine = new ReactEngine(fakeHenri(cwd), { next: fakeNext().next });

      expect(engine.ensureNextConfig()).toEqual([]);
      expect(fs.existsSync(path.join(cwd, 'app/views/next.config.js'))).toBe(
        false
      );
      expect(fs.existsSync(path.join(cwd, 'app/views/jsconfig.json'))).toBe(
        false
      );
    });

    test('warns without throwing when app/views is missing', () => {
      const cwd = app();

      fs.rmSync(path.join(cwd, 'app/views'), { recursive: true });

      const henri = fakeHenri(cwd);
      const engine = new ReactEngine(henri, { next: fakeNext().next });

      expect(engine.ensureNextConfig()).toEqual([]);
      expect(henri.pen.calls.warn.length).toBe(2);
      expect(henri.pen.calls.warn[0]).toContain('unable to create');
    });
  });

  describe('bundler selection', () => {
    test('is turbopack without config/webpack.js', () => {
      const cwd = app();

      expect(selectBundler(cwd)).toBe('turbopack');
      expect(new ReactEngine(fakeHenri(cwd), {}).bundler).toBe('turbopack');
    });

    test('is webpack when config/webpack.js exports a function', () => {
      const cwd = app({
        'config/webpack.js': 'module.exports = { webpack: (c) => c };\n',
      });

      expect(selectBundler(cwd)).toBe('webpack');
      expect(createNextConfig(cwd).webpack).toEqual(expect.any(Function));
    });

    test('stays turbopack when config/webpack.js exports something else', () => {
      const cwd = app({
        'config/webpack.js': 'module.exports = { webpack: { no: true } };\n',
      });

      expect(selectBundler(cwd)).toBe('turbopack');
    });
  });

  describe('next.js configuration', () => {
    test('applies a config/next.js function or object', () => {
      const asFunction = app({
        'config/next.js':
          'module.exports = { next: (c) => ({ ...c, distDir: "build" }) };\n',
      });
      const asObject = app({
        'config/next.js': 'module.exports = { next: { distDir: "out" } };\n',
      });

      expect(createNextConfig(asFunction).distDir).toBe('build');
      expect(createNextConfig(asObject).distDir).toBe('out');
      expect(createNextConfig(asObject).sassOptions.loadPaths).toEqual([
        path.join(asObject, 'app/views/styles'),
        path.join(asObject, 'app/views'),
        path.join(asObject, 'node_modules'),
      ]);
    });

    test('the webpack hook throws instead of exiting on a broken config', () => {
      const errors = [];
      const original = console.error;

      console.error = (...args) => errors.push(args.join(' '));

      try {
        const valid = { module: { rules: [] }, resolve: {} };
        const passthrough = createWebpackHook((config) => config);
        const broken = createWebpackHook(() => undefined);
        const async = createWebpackHook(async (config) => config);

        expect(passthrough(valid, { webpack: {} })).toBe(valid);
        expect(() => broken(valid, { webpack: {} })).toThrow(
          'must return the configuration'
        );
        expect(() => async(valid, { webpack: {} })).toThrow('synchronous');
        expect(errors.some((line) => line.includes('jquery'))).toBe(true);
      } finally {
        console.error = original;
      }
    });
  });

  describe('init', () => {
    test('fails clearly when app/views/pages is missing', async () => {
      const cwd = app();

      fs.rmSync(path.join(cwd, 'app/views/pages'), { recursive: true });

      const henri = fakeHenri(cwd);
      const engine = new ReactEngine(henri, { next: fakeNext().next });

      await expect(engine.init()).rejects.toThrow('app/views/pages is missing');
      expect(henri.pen.calls.fatal[0]).toContain('app/views/pages is missing');
    });

    test('warns about app/views/app (pages router only)', async () => {
      const cwd = app({
        'app/views/app/page.js': 'export default () => null;',
      });
      const henri = fakeHenri(cwd, { isTest: true });
      const engine = new ReactEngine(henri, { next: fakeNext().next });

      await expect(engine.init()).resolves.toBe(true);
      expect(
        henri.pen.calls.warn.some((line) => line.includes('pages router only'))
      ).toBe(true);
    });
  });

  describe('prepare', () => {
    test('passes the http server to next() and does not touch upgrades', async () => {
      const cwd = app();
      const henri = fakeHenri(cwd);
      const { calls, next } = fakeNext();
      const engine = new ReactEngine(henri, { next });

      await engine.prepare();

      expect(calls.prepared).toBe(1);
      expect(calls.options).toMatchObject({
        customServer: true,
        dev: true,
        dir: path.join(cwd, 'app/views'),
        httpServer: henri.server.httpServer,
        turbopack: true,
      });
      expect(engine.upgrade).toBeUndefined();
      expect(engine.attachUpgrade).toBeUndefined();
    });

    test('reuses a production build and respects distDir', async () => {
      const cwd = app({
        'app/views/build/BUILD_ID': 'abc123\n',
        'config/next.js': 'module.exports = { next: { distDir: "build" } };\n',
      });
      const henri = fakeHenri(cwd, { isProduction: true });
      const spawns = [];
      const engine = new ReactEngine(henri, {
        next: fakeNext().next,
        spawn: (...args) => {
          spawns.push(args);

          return { status: 0 };
        },
      });

      await engine.prepare();

      expect(spawns).toEqual([]);
      expect(henri.pen.calls.info[0]).toContain('reusing production build');
    });

    test('rebuilds in production with FORCE_BUILD', async () => {
      const cwd = app({ 'app/views/.next/BUILD_ID': 'abc123\n' });
      const henri = fakeHenri(cwd, { isProduction: true });
      const spawns = [];
      const engine = new ReactEngine(henri, {
        next: fakeNext().next,
        spawn: (...args) => {
          spawns.push(args);

          return { status: 0 };
        },
      });

      process.env.FORCE_BUILD = 'true';
      try {
        await engine.prepare();
      } finally {
        delete process.env.FORCE_BUILD;
      }

      expect(spawns.length).toBe(1);
      expect(spawns[0][1]).toEqual(
        expect.arrayContaining(['build', path.join(cwd, 'app/views')])
      );
    });
  });

  describe('render and fallback', () => {
    let engine;
    let calls;

    beforeAll(async () => {
      const cwd = app();
      const stub = fakeNext();

      calls = stub.calls;
      engine = new ReactEngine(fakeHenri(cwd), { next: stub.next });
      await engine.prepare();
    });

    test('render maps /index to /, forwards the search and merges req._henri', () => {
      const req = { _henri: { paths: { a: 1 }, user: null }, url: '/?page=2' };
      const res = {};

      expect(
        engine.render(req, res, '/index', { data: { tasks: [] }, user: 'me' })
      ).toBe('handled');

      const [call] = calls.handled;

      expect(call.parsed).toEqual({ pathname: '/', search: '?page=2' });
      expect(req._henri).toEqual({
        data: { tasks: [] },
        paths: { a: 1 },
        user: 'me',
      });
    });

    test('render keeps other routes as they are', () => {
      engine.render({ url: '/tasks/1' }, {}, '/tasks/show', {});

      expect(calls.handled[calls.handled.length - 1].parsed).toEqual({
        pathname: '/tasks/show',
        search: '',
      });
    });

    test('render maps a nested index page to its folder route', () => {
      const last = () =>
        calls.handled[calls.handled.length - 1].parsed.pathname;

      engine.render({ url: '/posts' }, {}, '/posts/index', {});
      expect(last()).toBe('/posts');

      engine.render({ url: '/posts' }, {}, 'posts/index', {});
      expect(last()).toBe('/posts');

      engine.render({ url: '/posts/1' }, {}, 'posts/show', {});
      expect(last()).toBe('/posts/show');

      expect(pagePath('/index')).toBe('/');
      expect(pagePath('/')).toBe('/');
      expect(pagePath('/admin/index/index')).toBe('/admin/index');
    });

    test('fallback passes only GET and HEAD to next.js', () => {
      let middleware = null;
      const router = {
        use: (fn) => {
          middleware = fn;
        },
      };

      engine.fallback(router);

      const before = calls.handled.length;
      let nexts = 0;
      const done = () => {
        nexts += 1;
      };

      middleware({ method: 'GET', url: '/x' }, {}, done);
      middleware({ method: 'HEAD', url: '/x' }, {}, done);
      middleware({ method: 'POST', url: '/x' }, {}, done);
      middleware({ method: 'DELETE', url: '/x' }, {}, done);

      expect(calls.handled.length - before).toBe(2);
      expect(nexts).toBe(2);
    });

    test('close stops the next.js instance once', async () => {
      await engine.close();
      await engine.close();

      expect(calls.closed).toBe(1);
      expect(engine.instance).toBeNull();
    });
  });

  describe('reload', () => {
    test('announces a change to config/next.js', async () => {
      const cwd = app({
        'config/next.js': 'module.exports = { next: {} };\n',
      });
      const henri = fakeHenri(cwd);
      const engine = new ReactEngine(henri, { next: fakeNext().next });

      await engine.reload();
      expect(henri.pen.calls.warn).toEqual([]);

      const file = path.join(cwd, 'config/next.js');
      const future = new Date(Date.now() + 5000);

      fs.utimesSync(file, future, future);
      await engine.reload();

      expect(henri.pen.calls.warn.length).toBe(1);
      expect(henri.pen.calls.warn[0]).toContain('config/next.js');
      expect(henri.pen.calls.warn[0]).toContain('restart');
    });
  });

  describe('build()', () => {
    test('runs next build without a henri and resolves the build', async () => {
      const cwd = app();
      const pen = fakePen();
      const spawns = [];
      const spawn = (...args) => {
        spawns.push(args);
        fs.mkdirSync(path.join(cwd, 'app/views/.next'), { recursive: true });
        fs.writeFileSync(path.join(cwd, 'app/views/.next/BUILD_ID'), 'xyz\n');

        return { status: 0 };
      };

      const result = await build({ cwd, pen, spawn });

      expect(result).toEqual({
        buildId: 'xyz',
        bundler: 'turbopack',
        dir: path.join(cwd, 'app/views'),
        distDir: path.join(cwd, 'app/views/.next'),
      });
      expect(spawns[0][0]).toBe(process.execPath);
      expect(spawns[0][1].slice(1)).toEqual([
        'build',
        path.join(cwd, 'app/views'),
        '--turbopack',
      ]);
      expect(spawns[0][2]).toMatchObject({
        cwd,
        env: { NODE_ENV: 'production' },
      });
      expect(fs.existsSync(path.join(cwd, 'app/views/next.config.js'))).toBe(
        true
      );
    });

    test('throws on a non-zero status', async () => {
      const cwd = app();
      const pen = fakePen();

      await expect(
        build({ cwd, pen, spawn: () => ({ status: 1 }) })
      ).rejects.toThrow('next build exited with status 1');
      expect(pen.calls.error[0]).toContain('unable to generate');
    });

    test('throws when app/views/pages is missing', async () => {
      const cwd = app();

      fs.rmSync(path.join(cwd, 'app/views/pages'), { recursive: true });

      await expect(
        build({ cwd, pen: fakePen(), spawn: () => ({ status: 0 }) })
      ).rejects.toThrow('app/views/pages is missing');
    });

    test('skips other renderers', async () => {
      const cwd = app();
      const pen = fakePen();

      await expect(
        build({ config: { renderer: 'template' }, cwd, pen, spawn: () => 1 })
      ).resolves.toBeNull();
      expect(pen.calls.warn[0]).toContain('template');
    });
  });
});
