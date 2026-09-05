const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const supertest = require('supertest');

const TemplateEngine = require('../engines/template');

const DEMO = path.resolve(__dirname, '../../../demo');

/**
 * A minimal henri for the template engine
 *
 * @param {string} cwd the application directory
 * @param {object} [options={}] { isProduction }
 * @returns {object} a henri look-alike, with the pen output recorded
 */
const fakeHenri = (cwd, { isProduction = false } = {}) => {
  const logs = [];

  return {
    cwd: () => cwd,
    isDev: !isProduction,
    isProduction,
    isTest: false,
    logs,
    pen: {
      error: (...args) => logs.push(['error', ...args]),
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
    },
    server: { express },
  };
};

/**
 * An express app rendering every GET through the engine
 *
 * @param {TemplateEngine} engine the engine
 * @param {function} [opts=() => ({})] view options for a request
 * @returns {import('supertest').Agent} a supertest agent
 */
const agent = (engine, opts = () => ({})) => {
  const app = express();

  app.get('/render/{*splat}', (req, res) =>
    engine.render(req, res, req.path.replace(/^\/render/, ''), opts(req))
  );

  const router = express.Router();

  engine.fallback(router);
  app.use(router);
  app.use((req, res) => res.status(404).type('txt').send('unclaimed'));

  return supertest(app);
};

describe('template engine', () => {
  describe('page resolution (demo app)', () => {
    let engine;

    beforeAll(() => {
      engine = new TemplateEngine(fakeHenri(DEMO));
    });

    const pages = path.join(DEMO, 'app', 'views', 'pages');

    test.each([
      ['/', 'index.hbs'],
      ['/index', 'index.hbs'],
      ['/cd', 'cd.hbs'],
      ['/artwork', 'artwork/index.html'],
      ['/artwork/', 'artwork/index.html'],
      ['/artwork/index', 'artwork/index.html'],
      ['/artwork?page=2', 'artwork/index.html'],
    ])('%s resolves to pages/%s', (route, expected) => {
      expect(engine.resolvePage(route)).toBe(path.join(pages, expected));
    });

    test.each([
      '/art',
      '/artwor',
      '/artwork/index/extra',
      '/nope',
      '/index.vue',
      '/../../package.json',
      '/%2e%2e/%2e%2e/package.json',
      '/artwork/%00',
    ])('%s does not resolve', (route) => {
      expect(engine.resolvePage(route)).toBeNull();
    });
  });

  describe('rendering (demo app)', () => {
    let engine;
    let request;

    beforeAll(async () => {
      engine = new TemplateEngine(fakeHenri(DEMO));
      await engine.init();
      request = agent(engine, () => ({
        data: { artwork: [{ title: 'Nighthawks', year: 1942 }] },
        user: { email: 'ed@hopper.art' },
      }));
    });

    test('/art is a 404, not the artwork page', async () => {
      const json = await request
        .get('/render/art')
        .set('Accept', 'application/json');

      expect(json.status).toBe(404);
      expect(json.body).toMatchObject({ error: 'Not Found', statusCode: 404 });
      expect(json.body.message).toMatch(/\/art /);

      const html = await request.get('/render/art').set('Accept', 'text/html');

      expect(html.status).toBe(404);
      expect(html.text).toMatch(/<h1>404 Not Found<\/h1>/);
    });

    test('/artwork renders artwork/index.html with the data', async () => {
      const res = await request.get('/render/artwork');

      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<h1>Artworks<\/h1>/);
      expect(res.text).toMatch(/Nighthawks \(1942\)/);
    });

    test('the fallback serves pages and passes unknown routes on', async () => {
      const found = await request.get('/artwork');

      expect(found.status).toBe(200);
      expect(found.text).toMatch(/<h1>Artworks<\/h1>/);

      const unknown = await request.get('/art');

      expect(unknown.status).toBe(404);
      expect(unknown.text).toBe('unclaimed');
    });

    test('registers the demo partials', () => {
      expect(engine.partials).toEqual(
        expect.arrayContaining(['form/index', 'menu/left', 'somePartials'])
      );
    });
  });

  describe('runtime errors, partials and cache (temporary app)', () => {
    let cwd;
    let henri;
    let engine;
    let request;

    const write = (file, content) => {
      const target = path.join(cwd, 'app', 'views', file);

      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);

      // Make sure the mtime moves even on coarse filesystems
      const future = new Date(Date.now() + 5000);

      fs.utimesSync(target, future, future);
    };

    beforeAll(async () => {
      cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-views-'));
      write('pages/boom.hbs', '<p>{{explode "now"}}</p>');
      write(
        'pages/hello.hbs',
        '<p>{{> greeting}} {{name}} ({{@user.email}})</p>'
      );
      write('partials/greeting.hbs', 'Hello');
      write('partials/broken.hbs', '{{#if broken}}never closed');

      henri = fakeHenri(cwd);
      engine = new TemplateEngine(henri);
      await engine.init();
      request = agent(engine, () => ({
        data: { name: 'world' },
        user: { email: 'me@example.com' },
      }));
    });

    afterAll(() => {
      fs.rmSync(cwd, { force: true, recursive: true });
    });

    test('a template runtime error is a 500 with the stack logged', async () => {
      const json = await request
        .get('/render/boom')
        .set('Accept', 'application/json');

      expect(json.status).toBe(500);
      expect(json.body).toMatchObject({
        error: 'Internal Server Error',
        statusCode: 500,
      });
      expect(json.body.message).toMatch(/Missing helper: "explode"/);
      expect(json.body.data.stack).toMatch(/Missing helper/);

      const html = await request.get('/render/boom').set('Accept', 'text/html');

      expect(html.status).toBe(500);
      expect(html.text).toMatch(/<h1>500 Internal Server Error<\/h1>/);
      expect(html.text).toMatch(/Missing helper/);

      const logged = henri.logs.filter(
        ([level, name]) => level === 'error' && name === 'template'
      );

      expect(logged.some(([, , message]) => /\/boom/.test(message))).toBe(true);
      expect(
        logged.some(([, , message]) => /Missing helper/.test(message))
      ).toBe(true);
    });

    test('in production the 500 hides the error', async () => {
      const prod = new TemplateEngine(fakeHenri(cwd, { isProduction: true }));
      const res = await agent(prod)
        .get('/render/boom')
        .set('Accept', 'application/json');

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Internal Server Error');
      expect(res.body.data).toBeUndefined();
    });

    test('partials render and the other options are data variables', async () => {
      const res = await request.get('/render/hello');

      expect(res.status).toBe(200);
      expect(res.text).toBe('<p>Hello world (me@example.com)</p>');
    });

    test('a broken partial is reported and skipped', () => {
      expect(engine.partials).toEqual(['greeting']);
      expect(
        henri.logs.some(
          ([level, name, what]) =>
            level === 'error' && name === 'template' && /broken\.hbs/.test(what)
        )
      ).toBe(true);
    });

    test('reload re-registers the partials and drops the cache', async () => {
      write('partials/greeting.hbs', 'Bonjour');
      write('partials/extra.hbs', 'extra');

      await engine.reload();

      expect(engine.partials).toEqual(['extra', 'greeting']);
      expect(engine.cache.size).toBeGreaterThan(0);

      const res = await request.get('/render/hello');

      expect(res.text).toBe('<p>Bonjour world (me@example.com)</p>');
    });

    test('a changed page is recompiled', async () => {
      write('pages/hello.hbs', '<b>{{name}}</b>');

      const res = await request.get('/render/hello');

      expect(res.text).toBe('<b>world</b>');
    });
  });
});
