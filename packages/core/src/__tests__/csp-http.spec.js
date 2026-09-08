// The Content Security Policy of a real answer, on a booted application.
//
// `api-base.spec.js` proves the composition function by function; this is the
// part a unit test cannot see -- that the header a browser actually receives
// is the composed one, with every pass applied in the right order and none of
// them undone by helmet's own serialization (the policy is joined once at
// boot and cut around the nonce, so a mistake there is invisible to anything
// that only calls `cspDirectives`).
//
// The configuration is supplied through the environment, the way
// `tenancy-http.spec.js` does, and it is deliberately the awkward one: an
// asset prefix on another origin, a nonce, an override that replaces
// `script-src` in helmet's *other* spelling, and a `csp.add` on top of it. All
// four meet in one directive, and what comes out is the whole contract:
//
//   config.helmet replaced -> config.csp.add added -> the nonce, last
const supertest = require('supertest');

const Henri = require('../henri');

const ORIGIN = 'https://cdn.example.com';

describe('the content security policy of a real answer', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  const kept = {};
  let henri;
  let app;
  let said;

  /** The env keys this file writes, so afterAll puts them back */
  const keys = [
    'HENRI_CONFIG_JSON__assets',
    'HENRI_CONFIG_JSON__csp',
    'HENRI_CONFIG_JSON__helmet',
  ];

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';

    for (const key of keys) {
      kept[key] = process.env[key];
    }

    process.env.HENRI_CONFIG_JSON__assets = JSON.stringify({ prefix: ORIGIN });
    process.env.HENRI_CONFIG_JSON__csp = JSON.stringify({
      add: {
        'frame-src': ['https://youtube.com'],
        'script-src': ['https://plausible.io'],
      },
      nonce: true,
    });
    // Helmet's other spelling on purpose: it used to fail the boot with
    // `duplicate directive "script-src"`, naming a directive nobody wrote
    process.env.HENRI_CONFIG_JSON__helmet = JSON.stringify({
      contentSecurityPolicy: {
        directives: { scriptSrc: ["'self'", 'https://analytics.example'] },
      },
    });

    henri = new Henri();

    said = [];

    // Both, because the two halves of "nothing is silent" are a warning
    // (what the override took out) and an `info` that no longer claims the
    // policy names the asset origin
    for (const level of ['info', 'warn']) {
      const wrote = henri.pen[level].bind(henri.pen);

      henri.pen[level] = (...args) => {
        said.push(args.join(' '));

        return wrote(...args);
      };
    }

    henri.addMiddleware('csp-probe', (router) => {
      router.get('/_csp', (req, res) =>
        res.json({
          mirrored: req.headers['content-security-policy'] || null,
          nonce: res.locals.cspNonce || null,
        })
      );
    });

    await henri.init();
    global.henri = henri;
    app = henri.server.app;
  });

  afterAll(async () => {
    await henri.stop();
    delete global.henri;

    if (typeof skipWorkers === 'undefined') {
      delete process.env.SKIP_WORKERS;
    } else {
      process.env.SKIP_WORKERS = skipWorkers;
    }

    for (const key of keys) {
      if (typeof kept[key] === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = kept[key];
      }
    }
  });

  /**
   * One directive of the header of a real answer
   *
   * @param {object} headers the response headers
   * @param {string} name the directive
   * @returns {?string} the directive, whitespace trimmed
   */
  const directive = (headers, name) =>
    (headers['content-security-policy'] || '')
      .split(';')
      .map((one) => one.trim())
      .find((one) => one === name || one.startsWith(`${name} `)) || null;

  test('replaces, then adds, then names the nonce -- in that order', async () => {
    const res = await supertest(app).get('/_csp').expect(200);

    expect(res.body.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(directive(res.headers, 'script-src')).toBe(
      `script-src 'self' https://analytics.example https://plausible.io 'nonce-${res.body.nonce}'`
    );
    // The header the renderer reads back is the one that was sent
    expect(res.body.mirrored).toBe(res.headers['content-security-policy']);
  });

  test('a fresh nonce per answer, and the rest of the header cached', async () => {
    const first = await supertest(app).get('/_csp');
    const second = await supertest(app).get('/_csp');

    expect(first.body.nonce).not.toBe(second.body.nonce);
    expect(
      first.headers['content-security-policy'].replace(first.body.nonce, '')
    ).toBe(
      second.headers['content-security-policy'].replace(second.body.nonce, '')
    );
  });

  test('csp.add reaches a directive henri never set, through default-src', async () => {
    const res = await supertest(app).get('/_csp');

    expect(directive(res.headers, 'frame-src')).toBe(
      "frame-src 'self' https://youtube.com"
    );
  });

  test('the directives the override did not name keep the asset origin', async () => {
    const res = await supertest(app).get('/_csp');

    for (const name of ['style-src', 'font-src', 'img-src', 'connect-src']) {
      expect(directive(res.headers, name)).toContain(ORIGIN);
    }
  });

  // The concrete harm of the replacement, and the whole reason csp.add
  // exists: `script-src` was the one directive the override named, so it is
  // the one that no longer names the origin the build writes its urls with
  test('and the one it did name lost it, out loud', async () => {
    const res = await supertest(app).get('/_csp');

    expect(directive(res.headers, 'script-src')).not.toContain(ORIGIN);

    const warned = said.filter((line) =>
      line.includes('content security policy directive')
    );

    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(`script-src no longer names ${ORIGIN}`);
    expect(warned[0]).toContain('config.assets.prefix');
    expect(warned[0]).toContain('config.csp.add');
  });

  test('the boot line does not claim a policy that no longer names it', () => {
    const claimed = said.filter((line) =>
      line.includes('is named in the content security policy')
    );

    expect(claimed).toEqual([]);
  });
});
