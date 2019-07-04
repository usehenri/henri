/* eslint-disable no-console, no-unused-vars */
const fs = require('fs-extra');
const path = require('path');
const rimraf = require('rimraf');
const prettier = require('prettier');
const util = require('util');
const debug = require('debug')('henri:cli:destroy');

const { cwd, version } = require('./utils');

const result = {
  fail: [],
  success: [],
};

const TIMESTAMP = Date.now().toString();
const GIT_PRESENT = fs.existsSync(path.join(cwd, '.git'));
const BACKUP_BASE_DIR = path.join(cwd, '.backup', TIMESTAMP);

/**
 * Initial function
 *
 * @param {*} args command line arguments
 * @return {void}
 */
const main = args => {
  const cmd = args._.shift();

  if (GIT_PRESENT) {
    console.log('> found a .git directory; skipping backups');
  } else {
    console.log(
      '> i do not see a .git directory, will use a .backup directory'
    );
  }

  try {
    debug(`parsing command ${cmd}`);
    switch (cmd) {
      case 'model':
        deleteModel(args._);
        break;
      case 'controller':
        deleteController(args._);
        break;
      case 'route':
        deleteRoute(args._);
        break;
      case 'view':
        deleteView(args._.join(''));
        break;
      case 'scaffold':
        deleteScaffold(args._);
        break;
      case 'crud':
        deleteCrud(args._);
        break;
      default:
        help();
    }

    if (fs.existsSync(BACKUP_BASE_DIR)) {
      console.log('> backups are located in', BACKUP_BASE_DIR);
    }
  } catch (error) {
    console.log('> global error while running destroy, run with DEBUG');
    debug('global', error);
  }
};

/**
 * Removes the model
 *
 * @param {*} [filename] File and args
 * @return {void}
 */
const deleteModel = ([filename, ...args]) => {
  deleteOrBackup(
    'models',
    `${filename}.js`,
    path.join(cwd, 'app', 'models', `${filename}.js`)
  );
};

/**
 * Removes a controller
 *
 * @param {*} [filename] File and args
 * @return {void}
 */
const deleteController = ([filename, ...args]) => {
  deleteOrBackup(
    'controllers',
    `${filename}.js`,
    path.join(cwd, 'app', 'controllers', `${filename}.js`)
  );
};

/**
 * Removes a route
 *
 * @param {string} [keyName] get /path or resources path or...
 * @return {void}
 */
const deleteRoute = (keyName = null) => {
  if (!keyName) {
    console.log('> the route is undefined');
    debug(`got route ${keyName}`);

    return;
  }

  try {
    let code = `module.exports = `;
    const location = path.join(cwd, 'config', 'routes.js');
    // eslint-disable-next-line
    const actual = require(location);

    let key = (Array.isArray(keyName) && keyName.join(' ')) || keyName;

    if (typeof actual[key] !== 'undefined') {
      console.log(`> removed routing key "${key}" =>`, actual[key]);
      delete actual[key];
    } else {
      console.log('> routing key', key, 'does not exist');
      debug('actual', actual);
      debug('key', key);
      debug('keyName:', keyName);

      return;
    }

    code += util.inspect(actual);

    if (!GIT_PRESENT) {
      fs.copyFileSync(
        path.join(cwd, 'config', 'routes.js'),
        path.join(BACKUP_BASE_DIR, 'routes.js')
      );
      debug('copied file to ', path.join(BACKUP_BASE_DIR, 'routes.js'));
    }

    fs.outputFileSync(
      location,
      prettier.format(code, {
        parser: 'babel',
        singleQuote: true,
        trailingComma: 'es5',
      })
    );
  } catch (error) {
    console.log('> unable to edit routes, run with DEBUG');
    debug(error);
  }
};

/**
 * Deletes a subfolder in app/views/pages
 *
 * @param {string} target Folder
 * @returns {void}
 */
const deleteView = target => {
  const targetBackupDir = path.join(cwd, '.backup', TIMESTAMP, 'views', target);
  const sourceViewDir = path.join(cwd, 'app', 'views', 'pages', target);

  try {
    if (!fs.existsSync(sourceViewDir)) {
      throw new Error('view folder not found in', sourceViewDir);
    }

    if (GIT_PRESENT) {
      rimraf.sync(sourceViewDir);
    } else {
      fs.moveSync(sourceViewDir, targetBackupDir);
    }
    console.log('> removed "view" @', target);
  } catch (error) {
    console.log(
      '> unable to delete',
      target,
      'in the views/pages folder, run with DEBUG'
    );
    debug(error);
  }
};

/**
 * Removes a scaffold
 *
 * @param {*} [filename] File and args
 * @return {void}
 */
const deleteScaffold = ([filename, ...args]) => {
  const target = filename.toLowerCase();

  deleteModel([capitalize(target)]);
  deleteController([target]);
  deleteRoute(`resources ${target}`);
  deleteView(`_scaffold/${target}`);
};

/**
 * Removes a crud
 *
 * @param {*} [filename] File and args
 * @return {void}
 */
const deleteCrud = ([filename, ...args]) => {
  const target = filename.toLowerCase();

  deleteModel([capitalize(target)]);
  deleteController([target]);
  deleteRoute(`crud ${target}`);
};

/**
 * Deletes or makes a backup of the given file
 *
 * @param {string} type The type (model, controller, etc.)
 * @param {string} fileName The target file name
 * @param {string} filePath The target full path
 * @returns {void}
 */
const deleteOrBackup = (type, fileName, filePath) => {
  if (GIT_PRESENT) {
    if (fs.existsSync(filePath)) {
      rimraf.sync(filePath);
      result.success.push(filePath);
      console.log(`> removed "${type}" @ ${filePath}`);
    } else {
      console.log(`> unable to locate "${type}" @ ${filePath}`);
      result.fail.push(filePath);
    }

    return;
  }

  try {
    const targetDir = path.join(cwd, '.backup', TIMESTAMP, type);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File ${filePath} does not exist...`);
    }

    fs.ensureDirSync(targetDir);

    fs.moveSync(filePath, path.join(targetDir, fileName));

    console.log(`> backed up "${type}" @ ${filePath}`);
    result.success.push(filePath);
  } catch (err) {
    console.log(`> unable to backup "${type}" @ ${filePath}, run with DEBUG`);

    debug(err);
  }
};

/**
 * Returns help
 *
 * @returns {void}
 */
const help = () => {
  console.log(
    `
    henri (${version})

    Usage
      $ henri destroy <command> <target>

    Available commands
      model, controller, crud, scaffold

    Examples

      $ henri destroy model User
        --> Deletes the User model

      $ henri destroy controller locations
        --> Deletes a controller and routes
      
      $ henri d scaffold HighScore
        --> Deletes a model, a controller with resources actions
            and the matching resources routes
  `
  );
  process.exit(0);
};

/**
 * Capitalize a word
 *
 * @param {string} word Word that needs to be capitalized
 * @returns {string} Capitalized word
 */
const capitalize = word => word.charAt(0).toUpperCase() + word.slice(1);

module.exports = main;
