const View = require('../3.view');
const { assetOrigin, assetPrefix, normalize } = require('../base/assets');
const { SCHEMA } = require('../base/config-schema');
const { validate } = require('../base/config-validate');

/** The pattern the schema validates `assets.prefix` with */
const PATTERN = SCHEMA.assets.keys.prefix.pattern;

/**
 * Henri's config module, over a plain object
 *
 * @param {object} values the configuration
 * @returns {object} something with has() and get()
 */
const configModule = (values) => ({
  get: (key) => values[key],
  has: (key) => Object.prototype.hasOwnProperty.call(values, key),
});

/**
 * A View with a renderer and a pen that records
 *
 * @param {string} renderer the renderer name
 * @param {boolean} [isProduction=true] production or not
 * @returns {{view: View, logs: Array}} the module and what it said
 */
const view = (renderer, isProduction = true) => {
  const logs = [];
  const module = new View();

  module.renderer = renderer;
  module.henri = { isProduction };

  return {
    logs,
    pen: {
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
    },
    view: module,
  };
};

describe('the asset prefix', () => {
  describe('normalize', () => {
    test('takes the trailing slashes off, and only those', () => {
      expect(normalize('https://cdn.example.com/')).toBe(
        'https://cdn.example.com'
      );
      expect(normalize('https://cdn.example.com///')).toBe(
        'https://cdn.example.com'
      );
      expect(normalize('https://cdn.example.com/build/')).toBe(
        'https://cdn.example.com/build'
      );
      expect(normalize('  /assets/  ')).toBe('/assets');
    });

    test('a run of slashes is walked, not matched', () => {
      // `/\/+$/` is quadratic on this, which is why base/assets.js walks
      const long = `https://cdn.example.com${'/'.repeat(50000)}`;
      const started = Date.now();

      expect(normalize(long)).toBe('https://cdn.example.com');
      expect(Date.now() - started).toBeLessThan(1000);
    });

    test('anything that is not a string has no prefix', () => {
      for (const value of [null, undefined, 42, {}, ['/assets'], true]) {
        expect(normalize(value)).toBe('');
      }
    });
  });

  describe('assetPrefix', () => {
    test('reads henri config module and a plain config file alike', () => {
      const values = { assets: { prefix: 'https://cdn.example.com/' } };

      expect(assetPrefix(configModule(values))).toBe('https://cdn.example.com');
      expect(assetPrefix(values)).toBe('https://cdn.example.com');
    });

    test('an application that named none has none', () => {
      expect(assetPrefix(null)).toBe('');
      expect(assetPrefix({})).toBe('');
      expect(assetPrefix({ assets: {} })).toBe('');
      expect(assetPrefix({ assets: false })).toBe('');
      expect(assetPrefix(configModule({}))).toBe('');
    });
  });

  describe('assetOrigin', () => {
    test('an absolute url moves the assets, a path does not', () => {
      expect(assetOrigin('https://cdn.example.com/build')).toBe(
        'https://cdn.example.com'
      );
      expect(assetOrigin('http://cdn.example.com:8080')).toBe(
        'http://cdn.example.com:8080'
      );
      expect(assetOrigin('/assets')).toBeNull();
      expect(assetOrigin('')).toBeNull();
    });

    test('a value no boot would have accepted answers nothing', () => {
      expect(assetOrigin('not a url')).toBeNull();
    });
  });

  describe('the schema', () => {
    test('accepts a path and an absolute http url', () => {
      for (const prefix of [
        '/assets',
        '/',
        'https://cdn.example.com',
        'https://cdn.example.com/',
        'http://localhost:8080/build',
      ]) {
        expect(PATTERN.test(prefix)).toBe(true);
        expect(validate({ assets: { prefix } }).errors).toEqual([]);
      }
    });

    test('refuses a link rather than a prefix', () => {
      for (const prefix of [
        'https://user:pass@cdn.example.com',
        'https://cdn.example.com/?v=2',
        'https://cdn.example.com/#top',
        '//cdn.example.com',
        'ftp://cdn.example.com',
        'cdn.example.com',
        'assets',
      ]) {
        expect(PATTERN.test(prefix)).toBe(false);
      }

      const { errors } = validate(
        { assets: { prefix: 'cdn.example.com' } },
        { source: () => 'config/production.json' }
      );

      expect(errors).toHaveLength(1);
      expect(errors[0].key).toBe('assets.prefix');
      expect(errors[0].hint).toContain('policy');
    });
  });

  describe('the boot line', () => {
    test('says where the assets come from, and that the policy allows it', () => {
      const { logs, pen, view: module } = view('inertia');

      expect(
        module.assets(
          configModule({ assets: { prefix: 'https://cdn.x/' } }),
          pen
        )
      ).toBe('https://cdn.x');
      expect(logs[0][0]).toBe('info');
      expect(logs[0].join(' ')).toContain('assets from https://cdn.x');
      expect(logs[0].join(' ')).toContain('content security policy');
    });

    test('outside production it says the prefix waits for a build', () => {
      const { logs, pen, view: module } = view('inertia', false);

      module.assets(configModule({ assets: { prefix: '/assets' } }), pen);

      expect(logs[0].join(' ')).toContain('production builds only');
      // A path is this origin: there is nothing for the policy to name
      expect(logs[0].join(' ')).not.toContain('content security policy');
    });

    test('a renderer with no build is told the key does nothing', () => {
      const { logs, pen, view: module } = view('template');

      module.assets(configModule({ assets: { prefix: 'https://cdn.x' } }), pen);

      expect(logs[0][0]).toBe('warn');
      expect(logs[0].join(' ')).toContain('has no build');
    });

    test('an application without one says nothing at all', () => {
      const { logs, pen, view: module } = view('inertia');

      expect(module.assets(configModule({}), pen)).toBe('');
      expect(logs).toEqual([]);
    });
  });
});
