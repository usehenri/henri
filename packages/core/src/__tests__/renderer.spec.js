const fs = require('fs');
const os = require('os');
const path = require('path');

const View = require('../3.view');
const { PACKAGES, suggestedRenderer } = require('../base/renderer');

/**
 * An application directory with a package.json of the given dependencies
 *
 * @param {object} manifest what package.json holds ({} for none)
 * @returns {string} the directory
 */
const application = (manifest) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-renderer-'));

  manifest &&
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify(manifest, null, 2)
    );

  return dir;
};

describe('the renderer an application installed', () => {
  test('names the package and the value to configure', () => {
    expect(
      suggestedRenderer(
        application({ dependencies: { '@usehenri/inertia': '^1.1.0' } })
      )
    ).toEqual({ package: '@usehenri/inertia', renderer: 'inertia' });

    expect(
      suggestedRenderer(
        application({ devDependencies: { '@usehenri/react': '^1.1.0' } })
      )
    ).toEqual({ package: '@usehenri/react', renderer: 'react' });
  });

  test('suggests nothing when there is nothing to suggest', () => {
    expect(
      suggestedRenderer(application({ dependencies: { next: '^16' } }))
    ).toBeNull();
    // No package.json at all, and a directory that does not exist
    expect(suggestedRenderer(application(null))).toBeNull();
    expect(suggestedRenderer('/nowhere/at/all')).toBeNull();
  });

  test('every suggestion names a renderer the view module accepts', () => {
    const view = fs.readFileSync(
      path.join(__dirname, '..', '3.view.js'),
      'utf8'
    );

    for (const [, renderer] of PACKAGES) {
      expect(view).toContain(`${renderer}: '${renderer}'`);
    }
  });
});

describe('a renderer that cannot carry a nonce', () => {
  /**
   * A view module with a configuration and an application directory
   *
   * @param {object} settings the configuration
   * @returns {View} the module, ready to init()
   */
  const viewModule = (settings) => {
    const dir = application({});
    const module = new View();

    module.henri = {
      config: {
        get: (key, safe) => {
          const value = key
            .split('.')
            .reduce((node, part) => (node || {})[part], settings);

          if (typeof value === 'undefined') {
            if (safe) {
              return false;
            }
            throw new Error(`Config key ${key} does not exist`);
          }

          return value;
        },
        has: (key) =>
          typeof key
            .split('.')
            .reduce((node, part) => (node || {})[part], settings) !==
          'undefined',
      },
      cwd: () => dir,
      isDev: true,
      isProduction: false,
      isTest: true,
      pen: {
        fatal: (name, summary, full, obj, code) =>
          Object.assign(new Error(summary), { code }),
        info: () => {},
        warn: () => {},
      },
    };

    return module;
  };

  // A nonce that is named by the header and never written into the document
  // reads as protection and refuses every inline script instead
  test('fails the boot rather than serving a policy it cannot honour', async () => {
    const module = viewModule({
      csp: { nonce: true },
      experimental: { vue: true },
      renderer: 'vue',
    });

    await expect(module.init()).rejects.toMatchObject({
      code: 'HENRI_VIEW_NONCE_UNSUPPORTED',
    });
  });

  test('boots when the renderer says it carries one', async () => {
    const module = viewModule({ csp: { nonce: true }, renderer: 'template' });

    await expect(module.init()).resolves.toBe('view');
    expect(module.engine.supportsNonce).toBe(true);
  });

  test('says nothing when no nonce was asked for', async () => {
    const module = viewModule({ experimental: { vue: true }, renderer: 'vue' });

    module.henri.utils = { checkPackages: async () => true };

    // The engine is built and reached its own init(), which wants nuxt --
    // not the question here. What matters is that the gate let it through
    const failure = await module.init().catch((error) => error);

    expect(failure.code).toBeUndefined();
    expect(module.engine.supportsNonce).toBeUndefined();
  });
});
