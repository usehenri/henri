/* eslint-disable no-console */
const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const debug = require('debug')('henri:cli:destroy');

const { usage } = require('./help');
const { controllerOf } = require('./routing');
const {
  format,
  insideGit,
  names,
  readRoutes,
  validInstall,
} = require('./utils');

/**
 * Initial function
 *
 * @param {*} args command line arguments
 * @return {Promise<void>} Resolves when done
 */
const main = async (args) => {
  const [cmd, ...targets] = args._;

  if (!cmd) {
    console.log(usage('destroy'));

    return;
  }

  const destroyer = destroyers[cmd];

  if (!destroyer) {
    throw new Error(
      `Unknown target "${cmd}". Available: ${Object.keys(destroyers).join(', ')}`
    );
  }

  if (targets.length === 0) {
    throw new Error(`Missing name: henri destroy ${cmd} <name>`);
  }

  validInstall({ fatal: true });

  const ctx = context(process.cwd());

  if (ctx.git) {
    console.log('> found a git repository; skipping backups');
  } else {
    console.log('> no git repository, deleted files are moved to .backup/');
  }

  await destroyer(targets, ctx);

  if (fs.existsSync(ctx.backupDir)) {
    console.log('> backups are located in', ctx.backupDir);
  }
};

/**
 * Where and how to delete for this run
 *
 * @param {string} cwd Project directory
 * @returns {{cwd: string, git: boolean, backupDir: string}} The context
 */
const context = (cwd) => ({
  backupDir: path.join(cwd, '.backup', Date.now().toString()),
  cwd,
  git: insideGit(cwd),
});

/**
 * Removes the model
 *
 * @param {string[]} [name] Model name
 * @param {object} ctx Context
 * @return {void}
 */
const model = ([name], ctx) => {
  deleteOrBackup(
    'model',
    path.join('app', 'models', `${names(name).doc}.js`),
    ctx
  );
};

/**
 * Removes a controller and its routes
 *
 * @param {string[]} [name] Controller name
 * @param {object} ctx Context
 * @return {Promise<void>} Resolves when done
 */
const controller = async ([name], ctx) => {
  const lower = name.toLowerCase();

  deleteOrBackup(
    'controller',
    path.join('app', 'controllers', `${lower}.js`),
    ctx
  );
  await editRoutes(
    (key, value) => controllerOf(value) === lower,
    ctx,
    `pointing to "${lower}"`
  );
};

/**
 * Removes one key from config/routes.js
 *
 * @param {string[]} parts The key, possibly split by the shell (get /path)
 * @param {object} ctx Context
 * @return {Promise<void>} Resolves when done
 */
const route = async (parts, ctx) => {
  const wanted = parts.join(' ').trim();

  await editRoutes((key) => key === wanted, ctx, `"${wanted}"`);
};

/**
 * Deletes a subfolder in app/views/pages
 *
 * @param {string[]} parts Folder (ex: tasks)
 * @param {object} ctx Context
 * @returns {void}
 */
const view = (parts, ctx) => {
  const target = parts.join('');

  deleteOrBackup('view', path.join('app', 'views', 'pages', target), ctx);
};

/**
 * Removes a worker
 *
 * @param {string[]} [name] Worker name
 * @param {object} ctx Context
 * @return {void}
 */
const worker = ([name], ctx) => {
  deleteOrBackup(
    'worker',
    path.join('app', 'workers', `${name.toLowerCase()}.js`),
    ctx
  );
};

/**
 * Removes a test file
 *
 * @param {string[]} [name] Test name
 * @param {object} ctx Context
 * @return {void}
 */
const test = ([name], ctx) => {
  deleteOrBackup(
    'test',
    path.join('test', `${name.toLowerCase()}.test.js`),
    ctx
  );
};

/**
 * Removes a scaffold: model, controller, routes and views
 *
 * @param {string[]} [name] Model name
 * @param {object} ctx Context
 * @return {Promise<void>} Resolves when done
 */
const scaffold = async ([name], ctx) => {
  const { plural } = names(name);

  model([name], ctx);
  await controller([plural], ctx);
  view([plural], ctx);
};

/**
 * Removes a crud: model, controller and routes
 *
 * @param {string[]} [name] Model name
 * @param {object} ctx Context
 * @return {Promise<void>} Resolves when done
 */
const crud = async ([name], ctx) => {
  const { plural } = names(name);

  model([name], ctx);
  await controller([plural], ctx);
};

/**
 * Remove the routes matching a predicate from config/routes.js
 *
 * @param {function} matches (key, value) => boolean
 * @param {object} ctx Context
 * @param {string} label What was looked for, for the messages
 * @return {Promise<void>} Resolves when written
 */
const editRoutes = async (matches, ctx, label) => {
  const location = path.join(ctx.cwd, 'config', 'routes.js');
  const actual = readRoutes(ctx.cwd);
  const removed = Object.keys(actual).filter((key) =>
    matches(key, actual[key])
  );

  if (removed.length === 0) {
    console.log(`> no route ${label} in config/routes.js`);

    return;
  }

  backup(location, ctx);

  for (const key of removed) {
    console.log(`> removed route "${key}" =>`, actual[key]);
    delete actual[key];
  }

  fs.outputFileSync(
    location,
    await format(`module.exports = ${util.inspect(actual, { depth: 6 })};`)
  );
};

/**
 * Copy a file to the backup directory when the project is not in git
 *
 * @param {string} file Absolute path
 * @param {object} ctx Context
 * @returns {void}
 */
const backup = (file, ctx) => {
  if (ctx.git || !fs.existsSync(file)) {
    return;
  }

  const target = path.join(ctx.backupDir, path.relative(ctx.cwd, file));

  fs.ensureDirSync(path.dirname(target));
  fs.copySync(file, target);
  debug('backed up %s to %s', file, target);
};

/**
 * Deletes or makes a backup of the given file or directory
 *
 * @param {string} type The type (model, controller, etc.)
 * @param {string} relative Path relative to the project
 * @param {object} ctx Context
 * @returns {boolean} True when something was removed
 */
const deleteOrBackup = (type, relative, ctx) => {
  const location = path.join(ctx.cwd, relative);

  if (!fs.existsSync(location)) {
    console.log(`> unable to locate ${type} @ ${relative}`);

    return false;
  }

  if (ctx.git) {
    fs.rmSync(location, { force: true, recursive: true });
    console.log(`> removed ${type} @ ${relative}`);

    return true;
  }

  const target = path.join(ctx.backupDir, relative);

  fs.ensureDirSync(path.dirname(target));
  fs.moveSync(location, target, { overwrite: true });
  console.log(`> backed up ${type} @ ${relative}`);

  return true;
};

const destroyers = {
  controller,
  crud,
  model,
  route,
  scaffold,
  test,
  view,
  worker,
};

module.exports = main;
module.exports.destroyers = destroyers;
