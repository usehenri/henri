/**
 * Which renderer an application meant to use.
 *
 * `config.renderer` decides, and its default is handlebars. That is right
 * for an application with no view engine and confusing for one that
 * installed `@usehenri/inertia` and wonders why its pages are not the ones
 * being rendered: nothing fails, so nothing says anything.
 */
const fs = require('fs');
const path = require('path');

/** The renderer a package installs, in the order they are suggested */
const PACKAGES = [
  ['@usehenri/inertia', 'inertia'],
  ['@usehenri/react', 'react'],
];

/**
 * The renderer an application installed but never configured.
 *
 * Without `renderer` henri renders Handlebars, which is right for an
 * application that has no engine and confusing for one that installed a
 * renderer and expects its pages to be used: nothing fails, the pages are
 * simply not the ones being rendered. An explicit `"renderer": "template"`
 * is a decision and is left alone; a missing key is the case worth a word.
 *
 * @param {string} dir the application directory
 * @returns {?{package: string, renderer: string}} the suggestion, or null
 */
function suggestedRenderer(dir) {
  let manifest;

  try {
    manifest = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    );
  } catch {
    return null;
  }

  const declared = Object.assign(
    {},
    manifest.dependencies,
    manifest.devDependencies
  );

  for (const [name, renderer] of PACKAGES) {
    if (declared[name]) {
      return { package: name, renderer };
    }
  }

  return null;
}

module.exports = { PACKAGES, suggestedRenderer };
