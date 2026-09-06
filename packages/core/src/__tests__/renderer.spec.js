const fs = require('fs');
const os = require('os');
const path = require('path');

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
