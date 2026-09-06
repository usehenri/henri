const spawn = require('cross-spawn');
const path = require('path');
const fs = require('fs');

const { cwd, resolvePackageJson, validInstall } = require('./utils');

const PACKAGES = [
  '@usehenri/core',
  '@usehenri/disk',
  '@usehenri/mongoose',
  '@usehenri/mysql',
  '@usehenri/postgresql',
  '@usehenri/mssql',
  '@usehenri/react',
  '@usehenri/inertia',
  '@usehenri/graphql',
  '@usehenri/jobs',
  '@usehenri/webhooks',
  '@usehenri/uploads',
  '@usehenri/redis',
  '@usehenri/testing',
  '@usehenri/mcp',
  'next',
  'react',
  'react-dom',
  'vite',
  'vitest',
  'eslint',
];

const FOLDERS = {
  controllers: 'app/controllers',
  helpers: 'app/helpers',
  jobs: 'app/jobs',
  models: 'app/models',
  modules: 'app/modules',
  views: 'app/views/pages',
  workers: 'app/workers',
};

/**
 * Print the versions and the content of the application
 *
 * @param {object} [args] CLI arguments (--json prints the data as JSON)
 * @return {Promise<void>} Resolves when printed
 */
const main = async (args = {}) => {
  const data = await getData();

  if (args.json) {
    console.log(JSON.stringify(data, null, 2));

    return;
  }

  const show = (value) => (value === null ? 'Not installed' : value);
  const list = (value) => (value === null ? 'unreachable' : value.join(', '));

  line('About your henri setup:', true);
  line(`henri version:         ${data.henri}`);
  line(`Node version:          ${data.node}`);
  line(`pnpm version:          ${show(data.packageManagers.pnpm)}`);
  line(`yarn version:          ${show(data.packageManagers.yarn)}`);
  line(`npm version:           ${show(data.packageManagers.npm)}`);
  line(`henri project:         ${data.project ? 'yes' : 'no'}`, true);

  for (const name of PACKAGES) {
    line(`${`${name}:`.padEnd(23)}${show(data.packages[name])}`);
  }

  line('');
  for (const name of Object.keys(FOLDERS)) {
    line(`${`${name}:`.padEnd(23)}${list(data.app[name])}`);
  }
};

/**
 * Gets the data concurrently
 *
 * @returns {Promise<object>} The collected information
 */
const getData = async () => {
  const [pnpm, yarn, npm] = await Promise.all([
    run('pnpm -v'),
    run('yarn -v'),
    run('npm -v'),
  ]);
  const app = {};

  for (const [name, folder] of Object.entries(FOLDERS)) {
    app[name] = ls(folder);
  }

  return {
    app,
    cwd,
    henri: require('../package.json').version,
    node: process.version,
    packageManagers: { npm, pnpm, yarn },
    packages: Object.fromEntries(
      PACKAGES.map((name) => [name, installed(name)])
    ),
    project: validInstall({ fatal: false }),
  };
};

/**
 * Pads line of text
 *
 * @param {*} text The text
 * @param {number} pad Amount to pad
 * @return {void}
 */
const line = (text, pad) => {
  pad && console.log(' ');
  console.log(` ${text}`);
  pad && console.log(' ');
};

/**
 * Runs the command and returns its output
 *
 * @param {*} cmd Command to run
 * @returns {Promise<string|null>} Output or null when not installed
 */
const run = (cmd) => {
  return new Promise((resolve) => {
    let data = '';
    const args = cmd.split(' ');
    const program = args.shift();
    const output = spawn(program, args);

    output.stdout.on('data', (out) => (data += out));
    output.on('close', () => resolve((data && data.toString().trim()) || null));
    output.on('error', () => resolve(null));
  });
};

/**
 * Lists the folder content (file names without the extension)
 *
 * @param {*} folder Folder
 * @returns {Array<string>|null} The entries, null when unreachable
 */
const ls = (folder) => {
  try {
    return fs
      .readdirSync(path.resolve(cwd, folder))
      .filter((val) => val[0] !== '.')
      .map((val) => val.replace(/\.jsx?$/, ''));
  } catch {
    return null;
  }
};

/**
 * Version of a package installed in the current project
 *
 * @param {string} name Package name
 * @returns {string|null} Package version or null when not installed
 */
const installed = (name) => {
  const pkg = resolvePackageJson(name, cwd);

  return (pkg && pkg.version) || null;
};

module.exports = main;
module.exports.getData = getData;
