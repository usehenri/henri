/* eslint-disable no-console */
const spawn = require('cross-spawn');
const fs = require('fs-extra');
const path = require('path');
const { detectPackageManager, version } = require('./utils');

const cwd = process.cwd();

/**
 * Checks if a file exists
 *
 * @param {string} file A file to check in cwd
 * @returns {boolean} result
 */
const check = (file) => fs.existsSync(path.join(cwd, file));

/**
 * Initialize a new install
 *
 * @param {any} args CLI arguments
 * @param {any} name Project name, when called from `new`
 * @returns {void} Nothing
 */
const main = (args, name) => {
  // Check the force flag
  const force = args.force === true || args.f === true;
  const skipInstall = args['skip-install'] === true;

  console.log('');

  if (check('app') && !force) {
    console.log(
      `
      It looks like you already have an 'app' folder. Use --force or -f to
      copy the new structure...
    `
    );
    process.exit(-1);
  }

  createReadme();

  copyTemplate();

  buildPackage(name);

  generateConfig();

  const pm = skipInstall ? null : installPackages();

  console.log(`
    Your new project is ready to run!

    You can start coding right away with:

    # cd ${name || '.'}${skipInstall ? ` && ${detectPackageManager()} install` : ''} && henri server
  `);

  pm && console.log(`    (dependencies were installed with ${pm})\n`);
};

/**
 * Creates or completes the package.json file.
 * Runs after the template copy so template dependencies are merged with
 * anything that already existed in the folder.
 *
 * @param {string} [name] Project name
 * @returns {void}
 */
const buildPackage = (name) => {
  let existing = {};

  const templatePkg = fs.readJsonSync(
    path.resolve(__dirname, '../template/default/package.json')
  );

  try {
    existing = fs.readJsonSync(path.join(cwd, 'package.old.json'));
  } catch {
    // Nothing existed before the template copy
  }

  console.log(' - Building new package file...');

  // The template's @usehenri/* ranges are placeholders: a generated app
  // depends on the same version as the CLI that created it.
  const withCliVersion = (deps = {}) =>
    Object.fromEntries(
      Object.entries(deps).map(([dep, range]) => [
        dep,
        dep.startsWith('@usehenri/') ? `^${version}` : range,
      ])
    );

  const pkg = {
    ...templatePkg,
    ...existing,
    dependencies: {
      ...withCliVersion(templatePkg.dependencies),
      ...(existing.dependencies || {}),
    },
    devDependencies: {
      ...templatePkg.devDependencies,
      ...(existing.devDependencies || {}),
    },
    henri: version,
    name: existing.name || slug(name) || templatePkg.name,
    scripts: {
      ...templatePkg.scripts,
      ...(existing.scripts || {}),
    },
  };

  fs.writeJsonSync(path.join(cwd, 'package.json'), pkg, { spaces: 2 });
  fs.removeSync(path.join(cwd, 'package.old.json'));
};

/**
 * Creates a readme
 * @returns {void}
 */
const createReadme = () => {
  console.log(' - Adding new readme file...');

  if (check('README.md')) {
    fs.renameSync(path.join(cwd, 'README.md'), path.join(cwd, 'README.old.md'));
  }
};

/**
 * Copies the template from @usehenri/cli/template
 * @returns {void}
 */
const copyTemplate = () => {
  console.log(' - Copying new directory structure...');

  const templatePath = path.resolve(__dirname, '../template/default/');

  // Keep an existing package.json aside so buildPackage can merge it
  if (check('package.json')) {
    fs.moveSync(
      path.join(cwd, 'package.json'),
      path.join(cwd, 'package.old.json'),
      { overwrite: true }
    );
  }

  fs.copySync(templatePath, cwd, {
    filter: (src) => path.basename(src) !== '.gitignore',
  });
  fs.moveSync(path.resolve(cwd, 'gitignore'), path.resolve(cwd, '.gitignore'), {
    overwrite: true,
  });
};

/**
 * Generate boilerplate henri configuration
 * @returns {void}
 */
const generateConfig = () => {
  console.log(' - Generating a new default.json config file...');

  const buf = require('crypto').randomBytes(64);
  const configuration = {
    baseRole: 'guest',
    log: 'main.log',
    renderer: 'react',
    secret: `${buf.toString('hex')}`,
    stores: {
      default: {
        adapter: 'disk',
      },
    },
    user: 'user',
  };

  fs.writeJsonSync(path.join(cwd, 'config', 'default.json'), configuration, {
    spaces: 2,
  });
};

/**
 * Installs packages with pnpm, yarn or npm (whichever is available)
 * @returns {string} The package manager used
 */
const installPackages = () => {
  const pm = detectPackageManager(cwd);

  console.log(` - Installing packages using ${pm}...`);

  const result = spawn.sync(pm, ['install'], { stdio: 'inherit' });

  if (result.status !== 0) {
    console.log(
      `
      ${pm} install failed. Fix the error above then run "${pm} install" again.
    `
    );
  }

  return pm;
};

/**
 * Turns a folder name into a package name
 *
 * @param {string} [name] Folder name
 * @returns {string|null} A safe package name
 */
const slug = (name) =>
  name
    ? path
        .basename(name)
        .toLowerCase()
        .replace(/[^a-z0-9-_.]+/g, '-')
        .replace(/^[-_.]+|[-_.]+$/g, '') || null
    : null;

module.exports = main;
