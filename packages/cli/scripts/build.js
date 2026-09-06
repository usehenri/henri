const path = require('path');
const { spawnSync } = require('child_process');

const { CliError } = require('./errors');
const { readConfig, resolveFrom, validInstall } = require('./utils');

/**
 * The view engines that need a production build, by renderer. Each module
 * exports `build({ cwd, config })`, which builds without booting henri.
 */
const ENGINES = {
  inertia: '@usehenri/inertia/engine',
  react: '@usehenri/react/engine',
};

/**
 * Build the production views without booting henri (no database needed)
 *
 * @returns {Promise<void>} Resolves when the build is done
 * @throws when the build fails
 */
const main = async () => {
  validInstall({ fatal: true });

  process.env.NODE_ENV = 'production';
  process.env.FORCE_BUILD = 'true';

  const cwd = process.cwd();
  const config = readConfig(cwd, 'production');
  const renderer = String(config.renderer || 'template').toLowerCase();
  const name = ENGINES[renderer];

  if (!name) {
    console.log(`> the "${renderer}" renderer needs no build`);

    return;
  }

  let engine;

  try {
    engine = require(resolveFrom(name, cwd));
  } catch (error) {
    throw new CliError(
      'HENRI_CLI_NOT_INSTALLED',
      `${name.replace(/\/engine$/, '')} is not installed in this project (${error.message})`,
      { cause: error }
    );
  }

  if (typeof engine.build === 'function') {
    await engine.build({ config, cwd });

    return;
  }

  if (renderer === 'react') {
    // Older @usehenri/react: run `next build` on app/views ourselves
    await legacyBuild(cwd);

    return;
  }

  throw new CliError(
    'HENRI_VIEW_NO_BUILD',
    `${name} does not export a build() function`
  );
};

/**
 * Run `next build app/views` the way the react engine does
 *
 * @param {string} cwd Project directory
 * @returns {Promise<void>} Resolves when built
 * @throws when next exits with an error
 */
const legacyBuild = async (cwd) => {
  const { loadUserHooks } = require(
    resolveFrom('@usehenri/react/engine/hooks', cwd)
  );
  const bundler = loadUserHooks(cwd).webpack ? 'webpack' : 'turbopack';
  const dir = path.join(cwd, 'app', 'views');

  console.log(`> building next.js pages for production (${bundler})`);

  const result = spawnSync(
    process.execPath,
    [resolveFrom('next/dist/bin/next', cwd), 'build', dir, `--${bundler}`],
    {
      cwd,
      env: Object.assign({}, process.env, { NODE_ENV: 'production' }),
      stdio: 'inherit',
    }
  );

  if (result.status !== 0) {
    throw new CliError(
      'HENRI_VIEW_BUILD_FAILED',
      `next build exited with status ${result.status}`
    );
  }
};

module.exports = main;
module.exports.ENGINES = ENGINES;
