const fs = require('fs');
const path = require('path');
const Engine = require('../engine');
const { VIEW_FILES } = require('../engine/files');
const { cleanup, fakeHenri, fakeReq, fakeRes } = require('./helpers');

const SHELL = `<!doctype html>
<html>
  <head>
    <!--head-->
    <title>shell</title>
  </head>
  <body>
    <!--body-->
  </body>
</html>
`;

const MANIFEST = {
  '_vendor-abc.js': { file: 'assets/vendor-abc.js' },
  'main.jsx': {
    css: ['assets/main-abc.css'],
    file: 'assets/main-abc.js',
    imports: ['_vendor-abc.js'],
    isEntry: true,
  },
};

const OPTS = {
  data: { tasks: [{ name: 'write tests' }] },
  errors: undefined,
  localUrl: 'http://localhost:3000/',
  paths: { index_tasks_path: { method: 'get', route: '/tasks' } },
  query: { page: '2' },
  user: { email: 'felix@example.com' },
};

/**
 * An engine ready to render html without vite: a shell, a manifest and a
 * fake server renderer
 *
 * @param {object} [overrides] henri overrides
 * @returns {{ engine: Engine, henri: object }} the engine and its henri
 */
function ready(overrides = {}) {
  const henri = fakeHenri(overrides);
  const engine = new Engine(henri);

  engine.template = SHELL;
  engine.manifest = MANIFEST;
  engine.version = 'v1';
  engine.ssr = async (page) => ({
    body: `<script data-page="app" type="application/json">{}</script><div data-server-rendered="true" id="app">rendered ${page.component}</div>`,
    head: ['<title data-inertia="">rendered title</title>'],
  });

  return { engine, henri };
}

describe('inertia engine', () => {
  const dirs = [];

  afterAll(() => {
    dirs.forEach(cleanup);
  });

  describe('component names', () => {
    test('maps the route passed to res.render()', () => {
      expect(Engine.componentName('/')).toBe('index');
      expect(Engine.componentName('/index')).toBe('index');
      expect(Engine.componentName('/tasks/index')).toBe('tasks/index');
      expect(Engine.componentName('tasks')).toBe('tasks');
      expect(Engine.componentName('/tasks/')).toBe('tasks');
      expect(Engine.componentName()).toBe('index');
    });
  });

  describe('stylesheets of the entry', () => {
    test('reads the relative css imports of the browser entry', () => {
      const { engine, henri } = ready();

      dirs.push(henri.cwd());
      fs.mkdirSync(path.join(engine.dir, 'styles'), { recursive: true });
      fs.writeFileSync(
        path.join(engine.dir, 'main.jsx'),
        [
          "import { createInertiaApp } from '@inertiajs/react';",
          "import './styles/index.css';",
          "import './styles/print.scss';",
          // Not relative: vite resolves it, we cannot turn it into a url
          "import 'some-package/dist/x.css';",
          "import { resolvePage } from '@usehenri/inertia';",
        ].join('\n')
      );

      expect(engine.entryStylesheets()).toEqual([
        '/styles/index.css',
        '/styles/print.scss',
      ]);
    });

    test('is empty when the entry imports none, or cannot be read', () => {
      const { engine, henri } = ready();

      dirs.push(henri.cwd());
      fs.mkdirSync(engine.dir, { recursive: true });
      fs.writeFileSync(path.join(engine.dir, 'main.jsx'), 'const a = 1;\n');

      expect(engine.entryStylesheets()).toEqual([]);

      fs.rmSync(path.join(engine.dir, 'main.jsx'));
      expect(engine.entryStylesheets()).toEqual([]);
    });
  });

  describe('page object', () => {
    test('has the Inertia shape and the henri props contract', () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const page = engine.page(fakeReq('/tasks?page=2'), '/tasks/index', OPTS);

      expect(Object.keys(page)).toEqual([
        'component',
        'props',
        'url',
        'version',
      ]);
      expect(page.component).toBe('tasks/index');
      expect(page.url).toBe('/tasks?page=2');
      expect(page.version).toBe('v1');
      expect(Object.keys(page.props).sort()).toEqual([
        'csrf',
        'data',
        'errors',
        'flash',
        'graphql',
        'localUrl',
        'paths',
        'query',
        'user',
      ]);
      expect(page.props.data).toEqual(OPTS.data);
      expect(page.props.errors).toEqual({});
      expect(page.props.paths).toEqual(OPTS.paths);
      expect(page.props.user).toEqual(OPTS.user);
      expect(page.props.csrf).toBeNull();
      expect(page.props.graphql).toBeNull();
    });

    test('uses the csrf token and graphql options when available', () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const req = fakeReq('/', { csrfToken: () => 'token' });
      const page = engine.page(req, '/', {
        graphql: { endpoint: '/_henri/graph', query: false },
      });

      expect(page.props.csrf).toBe('token');
      expect(page.props.graphql).toEqual({
        endpoint: '/_henri/graph',
        query: false,
      });
      expect(page.props.data).toEqual({});
    });

    test('reads the csrf token from henri (string) or the view options', () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      // Core's csrf middleware: req.csrfToken is a string
      expect(
        engine.page(fakeReq('/', { csrfToken: 'from-middleware' }), '/').props
          .csrf
      ).toBe('from-middleware');
      // Core's router: req._henri.csrf
      expect(
        engine.page(
          fakeReq('/', {
            _henri: { csrf: 'from-router' },
            csrfToken: 'from-middleware',
          }),
          '/'
        ).props.csrf
      ).toBe('from-router');
      // The view options win
      expect(
        engine.page(fakeReq('/', { _henri: { csrf: 'from-router' } }), '/', {
          csrf: 'from-opts',
        }).props.csrf
      ).toBe('from-opts');
      expect(engine.page(fakeReq('/'), '/').props.csrf).toBeNull();
    });

    test('hands the csrf token to the Inertia client as a cookie', async () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const withToken = fakeRes();

      await engine.render(
        fakeReq('/', {
          csrfToken: () => 'token',
          headers: { 'x-inertia': 'true', 'x-inertia-version': 'v1' },
        }),
        withToken,
        '/',
        OPTS
      );

      expect(withToken.cookies['XSRF-TOKEN']).toEqual({
        options: { path: '/', sameSite: 'lax', secure: false },
        value: 'token',
      });
      expect(withToken.body.props.csrf).toBe('token');

      const without = fakeRes();

      await engine.render(fakeReq('/'), without, '/', OPTS);

      expect(without.cookies).toEqual({});
    });

    test('prefers the errors set with res.inertia.errors()', () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const req = fakeReq('/', { inertia: { errors: { name: 'required' } } });
      const page = engine.page(req, '/', { errors: [{ message: 'gql' }] });

      expect(page.props.errors).toEqual({ name: 'required' });
      expect(
        engine.page(fakeReq('/'), '/', { errors: [{ message: 'gql' }] }).props
          .errors
      ).toEqual([{ message: 'gql' }]);
    });
  });

  describe('render() for the Inertia client', () => {
    test('answers with the page object as JSON', async () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const res = fakeRes();

      await engine.render(
        fakeReq('/tasks', {
          headers: { 'x-inertia': 'true', 'x-inertia-version': 'v1' },
        }),
        res,
        '/tasks/index',
        OPTS
      );

      expect(res.calls).toEqual([['json']]);
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-inertia']).toBe('true');
      expect(res.headers.vary).toBe('X-Inertia');
      // Overrides the text/html set by henri's res.format()
      expect(res.headers['content-type']).toBe(
        'application/json; charset=utf-8'
      );
      expect(res.body.component).toBe('tasks/index');
      expect(res.body.props.data).toEqual(OPTS.data);
      expect(res.body.props.paths).toEqual(OPTS.paths);
      expect(res.body.props.user).toEqual(OPTS.user);
    });

    test('appends to an existing Vary header once', async () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const res = fakeRes();

      res.setHeader('Vary', 'Accept');
      await engine.render(
        fakeReq('/', {
          headers: { 'x-inertia': 'true', 'x-inertia-version': 'v1' },
        }),
        res,
        '/',
        OPTS
      );
      await engine.render(
        fakeReq('/', {
          headers: { 'x-inertia': 'true', 'x-inertia-version': 'v1' },
        }),
        res,
        '/',
        OPTS
      );

      expect(res.headers.vary).toBe('Accept, X-Inertia');
    });

    test('asks for a full visit (409) when the asset version changed', async () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const res = fakeRes();

      await engine.render(
        fakeReq('/tasks?page=2', {
          headers: { 'x-inertia': 'true', 'x-inertia-version': 'old' },
        }),
        res,
        '/tasks/index',
        OPTS
      );

      expect(res.statusCode).toBe(409);
      expect(res.headers['x-inertia-location']).toBe(
        'http://localhost:3000/tasks?page=2'
      );
      expect(res.headers['x-inertia-version']).toBe('v1');
      expect(res.calls).toEqual([['end']]);
      expect(res.body).toBeNull();
    });

    test('ignores the version on non-GET requests', async () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const res = fakeRes();

      await engine.render(
        fakeReq('/tasks', {
          headers: { 'x-inertia': 'true', 'x-inertia-version': 'old' },
          method: 'POST',
        }),
        res,
        '/tasks/index',
        OPTS
      );

      expect(res.statusCode).toBe(200);
      expect(res.calls).toEqual([['json']]);
    });

    test('filters the props of a partial reload', async () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const only = fakeRes();

      await engine.render(
        fakeReq('/tasks', {
          headers: {
            'x-inertia': 'true',
            'x-inertia-partial-component': 'tasks/index',
            'x-inertia-partial-data': 'data, user',
            'x-inertia-version': 'v1',
          },
        }),
        only,
        '/tasks/index',
        OPTS
      );

      expect(Object.keys(only.body.props).sort()).toEqual(['data', 'user']);

      const except = fakeRes();

      await engine.render(
        fakeReq('/tasks', {
          headers: {
            'x-inertia': 'true',
            'x-inertia-partial-component': 'tasks/index',
            'x-inertia-partial-except': 'data',
            'x-inertia-version': 'v1',
          },
        }),
        except,
        '/tasks/index',
        OPTS
      );

      expect(except.body.props.data).toBeUndefined();
      expect(except.body.props.user).toEqual(OPTS.user);

      const other = fakeRes();

      await engine.render(
        fakeReq('/tasks', {
          headers: {
            'x-inertia': 'true',
            'x-inertia-partial-component': 'somewhere/else',
            'x-inertia-partial-data': 'data',
            'x-inertia-version': 'v1',
          },
        }),
        other,
        '/tasks/index',
        OPTS
      );

      expect(Object.keys(other.body.props)).toHaveLength(9);
    });
  });

  describe('render() as html', () => {
    test('injects the server rendered page and the built assets in the shell', async () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const res = fakeRes();

      await engine.render(fakeReq('/tasks'), res, '/tasks/index', OPTS);

      expect(res.calls).toEqual([['send']]);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers.vary).toBe('X-Inertia');
      expect(res.headers['x-inertia']).toBeUndefined();
      expect(res.body).toContain('rendered tasks/index');
      expect(res.body).toContain(
        '<title data-inertia="">rendered title</title>'
      );
      expect(res.body).toContain('<title>shell</title>');
      expect(res.body).toContain(
        '<link rel="stylesheet" href="/assets/main-abc.css">'
      );
      expect(res.body).toContain(
        '<script type="module" src="/assets/main-abc.js"></script>'
      );
      expect(res.body).toContain(
        '<link rel="modulepreload" href="/assets/vendor-abc.js">'
      );
      expect(res.body).not.toContain('<!--head-->');
      expect(res.body).not.toContain('<!--body-->');
    });

    test('nonces the whole document, and says so to vite', async () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);
      expect(engine.supportsNonce).toBe(true);

      const res = fakeRes();

      await engine.render(
        fakeReq('/tasks'),
        res,
        '/tasks/index',
        Object.assign({ nonce: 'AbC-_123' }, OPTS)
      );

      // The runtime seam: vite's client reads this for the styles it injects
      // in development and the chunks __vitePreload loads in production
      expect(res.body).toContain(
        '<meta property="csp-nonce" nonce="AbC-_123">'
      );
      expect(res.body).toContain(
        '<link rel="stylesheet" href="/assets/main-abc.css" nonce="AbC-_123">'
      );
      expect(res.body).toContain(
        '<script type="module" src="/assets/main-abc.js" nonce="AbC-_123">'
      );
      expect(res.body).toContain(
        '<link rel="modulepreload" href="/assets/vendor-abc.js" nonce="AbC-_123">'
      );
      // The page object the server bundle embedded is a script too
      expect(res.body).toContain(
        '<script data-page="app" type="application/json" nonce="AbC-_123">'
      );
    });

    test('takes the nonce from res.locals when the view options have none', async () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const res = fakeRes();

      res.locals.cspNonce = 'FromTheHeaderXXXXXXXXX';
      await engine.render(fakeReq('/tasks'), res, '/tasks/index', OPTS);

      expect(res.body).toContain('nonce="FromTheHeaderXXXXXXXXX"');
    });

    // The document carries the nonce, the page object never does: an Inertia
    // visit swaps props into a document whose policy is the one it loaded
    // with, so a nonce in those props names nothing
    test('keeps the nonce out of the page object', async () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);
      engine.ssr = null;

      const res = fakeRes();

      await engine.render(
        fakeReq('/tasks', {
          headers: { 'x-inertia': 'true', 'x-inertia-version': 'v1' },
        }),
        res,
        '/tasks/index',
        Object.assign({ nonce: 'AbC-_123' }, OPTS)
      );

      expect(res.calls).toEqual([['json']]);
      expect(JSON.stringify(res.body)).not.toContain('AbC-_123');
      expect(res.body.props).not.toHaveProperty('nonce');
    });

    test('embeds the page object for the browser when ssr is off', async () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);
      engine.ssr = null;

      const res = fakeRes();

      await engine.render(fakeReq('/tasks'), res, '/tasks/index', {
        data: { html: '</script><b>' },
      });

      expect(res.body).toContain(
        '<script data-page="app" type="application/json">'
      );
      expect(res.body).toContain('<div id="app"></div>');
      expect(res.body).not.toContain('data-server-rendered');
      expect(res.body).not.toContain('</script><b>');
      expect(res.body).toContain('\\u003c\\/script>');

      const json =
        /<script data-page="app" type="application\/json">(.*?)<\/script>/.exec(
          res.body
        );
      const page = JSON.parse(json[1]);

      expect(page.component).toBe('tasks/index');
      expect(page.props.data).toEqual({ html: '</script><b>' });
      expect(page.version).toBe('v1');
    });

    test('reads the ssr option from the configuration', () => {
      const henri = fakeHenri({
        settings: { inertia: { id: 'root', ssr: false }, renderer: 'inertia' },
      });

      dirs.push(henri.dir);

      const engine = new Engine(henri);

      expect(engine.options.ssr).toBe(false);
      expect(engine.options.id).toBe('root');
      expect(engine.options.entry).toBe('main.jsx');
    });

    test('shows the error in development when the server render fails', async () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);
      engine.ssr = async () => {
        throw new Error('boom in a page');
      };

      const res = fakeRes();

      await engine.render(fakeReq('/'), res, '/', OPTS);

      expect(res.statusCode).toBe(500);
      expect(res.body).toContain('boom in a page');
      expect(henri.logs.some((log) => log[0] === 'error')).toBe(true);
    });

    test('falls back to the browser render in production', async () => {
      const { engine, henri } = ready({ isDev: false, isProduction: true });

      dirs.push(henri.dir);
      engine.ssr = async () => {
        throw new Error('boom in a page');
      };

      const res = fakeRes();

      await engine.render(fakeReq('/'), res, '/', OPTS);

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<div id="app"></div>');
      expect(res.body).not.toContain('boom in a page');
    });

    test('hides the details in production when the shell is broken', async () => {
      const { engine, henri } = ready({ isDev: false, isProduction: true });

      dirs.push(henri.dir);
      engine.manifest = {};

      const res = fakeRes();

      await engine.render(fakeReq('/'), res, '/', OPTS);

      expect(res.statusCode).toBe(500);
      expect(res.body).toBe('Internal Server Error');
    });
  });

  describe('fallback()', () => {
    /**
     * A router capturing the handler registered with use()
     *
     * @returns {object} the router
     */
    const router = () => ({
      handler: null,
      use(handler) {
        this.handler = handler;
      },
    });

    test('hands GET and HEAD to vite in development, anything else to henri', async () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const calls = [];

      engine.vite = { middlewares: (req, res, next) => calls.push('vite') };

      const app = router();

      engine.fallback(app);

      app.handler(fakeReq('/main.jsx'), fakeRes(), () => calls.push('next'));
      app.handler(fakeReq('/main.jsx', { method: 'HEAD' }), fakeRes(), () =>
        calls.push('next')
      );
      app.handler(fakeReq('/tasks', { method: 'POST' }), fakeRes(), () =>
        calls.push('next')
      );

      expect(calls).toEqual(['vite', 'vite', 'next']);
    });

    test('serves the built assets in production', () => {
      const { engine, henri } = ready({ isDev: false, isProduction: true });

      dirs.push(henri.dir);

      const app = router();

      engine.fallback(app);

      expect(engine.serve.dir).toBe(
        path.join(henri.dir, 'app', 'views', 'dist', 'client')
      );

      const calls = [];

      app.handler(fakeReq('/assets/main.js'), fakeRes(), () =>
        calls.push('next')
      );

      expect(calls).toEqual(['next']);
    });

    test('lets everything through when nothing is ready', () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const app = router();
      const calls = [];

      engine.fallback(app);
      app.handler(fakeReq('/'), fakeRes(), () => calls.push('next'));

      expect(calls).toEqual(['next']);
    });
  });

  describe('init()', () => {
    test('checks the peer packages and registers the middleware once', async () => {
      const henri = fakeHenri();

      dirs.push(henri.dir);

      const engine = new Engine(henri);

      await engine.init();
      await engine.init();

      expect(henri.checked).toEqual(['react', 'react-dom', 'vite']);
      expect(henri._middlewares.map((entry) => entry.name)).toEqual([
        'inertia',
      ]);
      // Test mode: no files written
      expect(fs.existsSync(path.join(henri.dir, 'app', 'views'))).toBe(false);
    });

    test('fails loudly when @inertiajs/react (ESM only) is not installed', async () => {
      const henri = fakeHenri();

      dirs.push(henri.dir);
      fs.rmSync(path.join(henri.dir, 'node_modules'), { recursive: true });

      await expect(new Engine(henri).init()).rejects.toThrow(
        /'@inertiajs\/react' and '@vitejs\/plugin-react'/
      );
      expect(
        henri.logs.some(
          (log) => log[0] === 'error' && /cannot start/.test(log[2])
        )
      ).toBe(true);
      // Registered before the checks: core may ignore the rejection
      expect(henri._middlewares.map((entry) => entry.name)).toEqual([
        'inertia',
      ]);
    });

    test('finds packages the way node does, without require.resolve', () => {
      const henri = fakeHenri();

      dirs.push(henri.dir);

      const nested = path.join(henri.dir, 'app', 'views');

      fs.mkdirSync(nested, { recursive: true });

      expect(Engine.findPackage('@inertiajs/react', nested)).toBe(
        path.join(
          henri.dir,
          'node_modules',
          '@inertiajs',
          'react',
          'package.json'
        )
      );
      expect(Engine.findPackage('nope', henri.dir)).toBeNull();

      // Falls back to the file on disk when henri's resolver cannot see it
      henri.utils.resolvePackageJson = () => {
        throw new Error('ERR_PACKAGE_PATH_NOT_EXPORTED');
      };
      expect(new Engine(henri).packageVersion('@inertiajs/react')).toBe(
        '3.7.0'
      );
      expect(new Engine(henri).packageVersion('nope')).toBe('?');
    });

    test('warns when the renderer name is unexpected', async () => {
      const henri = fakeHenri({ settings: { renderer: 'vite' } });

      dirs.push(henri.dir);

      await new Engine(henri).init();

      expect(
        henri.logs.some(
          (log) => log[0] === 'warn' && /renderer 'vite'/.test(log[2])
        )
      ).toBe(true);
    });
  });

  describe('generated files', () => {
    test('creates the view files once and respects alternatives', () => {
      const henri = fakeHenri();

      dirs.push(henri.dir);

      const engine = new Engine(henri);
      const views = path.join(henri.dir, 'app', 'views');

      fs.mkdirSync(views, { recursive: true });
      fs.writeFileSync(path.join(views, 'vite.config.js'), '// mine');

      const created = engine.ensureViewFiles();

      expect(created).toEqual(['index.html', 'main.jsx', 'ssr.jsx']);
      expect(fs.existsSync(path.join(views, 'vite.config.mjs'))).toBe(false);
      expect(fs.readFileSync(path.join(views, 'index.html'), 'utf8')).toContain(
        '<!--body-->'
      );
      expect(fs.readFileSync(path.join(views, 'main.jsx'), 'utf8')).toContain(
        "import.meta.glob('./pages/**/*.jsx')"
      );
      expect(fs.readFileSync(path.join(views, 'ssr.jsx'), 'utf8')).toContain(
        'export function render(page)'
      );
      expect(engine.ensureViewFiles()).toEqual([]);
    });

    test('ships every file the engine needs', () => {
      expect(VIEW_FILES.map((file) => file.name)).toEqual([
        'index.html',
        'main.jsx',
        'ssr.jsx',
        'vite.config.mjs',
      ]);
    });
  });

  describe('middleware', () => {
    test('exposes req.inertia and res.inertia', () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const req = fakeReq('/tasks', { method: 'POST' });
      const res = fakeRes();
      let called = false;

      engine.middleware(req, res, () => {
        called = true;
      });

      expect(called).toBe(true);
      expect(req.inertia).toEqual({ errors: null, request: false });
      expect(res.inertia.errors({ name: 'required' })).toBe(res);
      expect(req.inertia.errors).toEqual({ name: 'required' });

      res.inertia.location('https://example.com');
      expect(res.calls).toEqual([['redirect', 'https://example.com']]);
    });

    test('redirects with 303 after PUT/PATCH/DELETE from the Inertia client', () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const del = fakeReq('/tasks/1', {
        headers: { 'x-inertia': 'true' },
        method: 'DELETE',
      });
      const res = fakeRes();

      engine.middleware(del, res, () => {});
      res.redirect('/tasks');
      res.redirect(301, '/elsewhere');

      expect(res.calls).toEqual([
        ['redirect', 303, '/tasks'],
        ['redirect', 301, '/elsewhere'],
      ]);

      const post = fakeReq('/tasks', {
        headers: { 'x-inertia': 'true' },
        method: 'POST',
      });
      const plain = fakeRes();

      engine.middleware(post, plain, () => {});
      plain.redirect('/tasks');

      expect(plain.calls).toEqual([['redirect', '/tasks']]);
    });

    test('answers external locations with 409 for the Inertia client', () => {
      const { engine, henri } = ready();

      dirs.push(henri.dir);

      const req = fakeReq('/', { headers: { 'x-inertia': 'true' } });
      const res = fakeRes();

      engine.middleware(req, res, () => {});
      res.inertia.location('https://example.com');

      expect(req.inertia.request).toBe(true);
      expect(res.statusCode).toBe(409);
      expect(res.headers['x-inertia-location']).toBe('https://example.com');
      expect(res.calls).toEqual([['end']]);
    });
  });

  describe('build helpers', () => {
    test('finds the server bundle whatever its extension', () => {
      const henri = fakeHenri();

      dirs.push(henri.dir);

      const views = path.join(henri.dir, 'app', 'views');

      expect(Engine.ssrBundle(views, 'ssr.jsx')).toBeNull();

      fs.mkdirSync(path.join(views, 'dist', 'ssr'), { recursive: true });
      fs.writeFileSync(path.join(views, 'dist', 'ssr', 'ssr.js'), '');
      expect(Engine.ssrBundle(views, 'ssr.jsx')).toBe(
        path.join(views, 'dist', 'ssr', 'ssr.js')
      );

      fs.writeFileSync(path.join(views, 'dist', 'ssr', 'ssr.mjs'), '');
      expect(Engine.ssrBundle(views, 'ssr.jsx')).toBe(
        path.join(views, 'dist', 'ssr', 'ssr.mjs')
      );
    });

    test('exposes a static build()', () => {
      expect(typeof Engine.build).toBe('function');
      expect(Engine.DEFAULTS.ssr).toBe(true);
    });
  });
});
