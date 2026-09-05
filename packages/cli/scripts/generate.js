/* eslint-disable no-console */
const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const handlebars = require('handlebars');

const { cwd, format, version } = require('./utils');

/**
 * Initial function
 *
 * @param {*} args command line arguments
 * @return {Promise<void>} Resolves when done
 */
const main = async (args) => {
  const cmd = args._.shift();

  switch (cmd) {
    case 'model':
      await model(args._);
      break;
    case 'controller':
      await controller(args._);
      break;
    case 'scaffold':
      await scaffold(args._);
      break;
    case 'crud':
      await buildCrud(args._);
      break;
    default:
      help();
  }
};

/**
 * Handle models
 *
 * @param {*} [file] File and args
 * @return {Promise<void>} Resolves when written
 */
const model = async ([file, ...args]) => {
  const name = capitalize(file);

  let code = `module.exports = `;
  const base = {
    options: {
      timestamps: true,
    },
    schema: {},
  };

  args.forEach((val) => {
    const parts = val.split(':');
    let required = false;

    if (parts[1] && parts[1].endsWith('!')) {
      required = true;
      parts[1] = parts[1].slice(0, -1);
    }

    base.schema[parts[0]] = { type: parts[1] || 'string' };

    if (required) {
      base.schema[parts[0]].required = true;
    }
  });
  code += util.inspect(base, { depth: 6 });
  await output('model', 'models', name, code);
};

/**
 * Generates controller files
 *
 * @param {*} [file] File
 * @param {*} inner Inner of the controller function
 * @return {Promise<void>} Resolves when written
 */
const controller = async ([file, ...args], inner) => {
  let code = 'const { pen } = henri; module.exports = {';

  args.forEach((val) => {
    const fback = `res.status(501).send('controller ${file}#${val} not ready')`;

    code += `${val}: async (req,res) => { ${inner || fback} },`;
  });
  code += '};';

  await output('controller', 'controllers', file, code);
};

/**
 * Scaffold builder
 *
 * @param {*} [file] File
 * @return {Promise<void>} Resolves when done
 */
const scaffold = async ([file, ...args]) => {
  await model([file, ...args]);
  await resources(file);
  await routes(`resources ${file.toLowerCase()}`, {
    controller: file.toLowerCase(),
    scope: '_scaffold',
  });
  await views(file, args);
};

/**
 * Build the crud
 *
 * @param {*} [file] file
 * @return {Promise<void>} Resolves when done
 */
const buildCrud = async ([file, ...args]) => {
  await model([capitalize(file), ...args]);
  await crud(file);
  await routes(`crud ${file.toLowerCase()}`, {
    controller: file.toLowerCase(),
    scope: '_crud',
  });
};

/**
 * Build resources
 *
 * @param {*} file file
 * @return {Promise<void>} Resolves when written
 */
const resources = async (file) => {
   
  const generator = require('./generate/controllers');
  const doc = capitalize(file);
  const lower = file.toLowerCase();
  let code = generator.header();

  code += generator.index(lower, doc);
  code += generator.newC(lower, doc);
  code += generator.create(lower, doc);
  code += generator.show(lower, doc);
  code += generator.edit(lower, doc);
  code += generator.update(lower, doc);
  code += generator.destroy(lower, doc);

  await output('controller', 'controllers', file, code);
};

/**
 * Create CRUD
 *
 * @param {*} file file
 * @return {Promise<void>} Resolves when written
 */
const crud = async (file) => {
   
  const generator = require('./generate/controllers');
  const doc = capitalize(file);
  const lower = file.toLowerCase();

  let code = generator.header();

  code += generator.index(lower, doc);
  code += generator.create(lower, doc);
  code += generator.update(lower, doc);
  code += generator.destroy(lower, doc);

  await output('controller', 'controllers', file, code);
};

/**
 * Handle views processing
 *
 * @param {*} file File
 * @param {*} args Arguments
 *
 * @returns {Promise<void>} Resolves when written
 */
const views = async (file, args) => {
  const doc = capitalize(file);
  const lower = file.toLowerCase();
  const keys = extractKeys(args);

  for (const view of ['index', '_form', 'new', 'edit', 'show']) {
    await compileView({ doc, keys, lower, view });
  }
};

/**
 * Extract Keys from semi-colon
 *
 * @param {*} [args=[]] arguments
 * @return {Array<string>} Results
 */
const extractKeys = (args = []) => args.map((val) => val.split(':')[0]);

/**
 * CompileView
 *
 * @param {*} {
 *   doc,
 *   lower,
 *   keys = [],
 *   view = 'index',
 *   renderer = 'react',
 * }
 * @return {Promise<void>} Resolves when written
 */
const compileView = async ({
  doc,
  lower,
  keys = [],
  view = 'index',
  renderer = 'react',
}) => {
  const data = fs.readFileSync(
    path.join(__dirname, `./generate/${renderer}-${view}.hbs`),
    'utf8'
  );
  const template = handlebars.compile(data.toString());

  await output(
    'view',
    `views/pages/_scaffold/${lower}`,
    view,
    template({ doc, keys, lower })
  );
};

/**
 * Generates routes
 *
 * @param {*} key The route key
 * @param {*} opts Options
 * @return {Promise<void>} Resolves when written
 */
const routes = async (key, opts) => {
  let code = `module.exports = `;
  const location = path.join(cwd, 'config', 'routes.js');
   
  const actual = require(location);

  actual[key] = opts;
  code += util.inspect(actual);
  fs.outputFileSync(location, await format(code));
  console.log(`> added route "${key}" @ ${location}`);
};

/**
 * Outputs data into a file
 *
 * @param {*} type Type of output
 * @param {*} dir Target directory
 * @param {*} file Target file
 * @param {*} code The code that should be written in the file
 * @return {Promise<void>} Resolves when written
 */
const output = async (type, dir, file, code) => {
  const location = path.join(cwd, 'app', dir, `${file}.js`);

  fs.outputFileSync(location, await format(code));
  console.log(`> created ${type} "${file}" @ ${location}`);
};

/**
 * Capitalize a word
 *
 * @param {string} word Word that needs to be capitalized
 * @returns {string} Capitalized word
 */
const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);

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
      $ henri generate <command> <target> [options]

    Available commands
      model, controller, crud, scaffold

    Examples

      $ henri generate model User name:string birthday:date
        --> Creates a model with these attributes

      $ henri generate controller locations index show gps
        --> Creates a controller and routes to those actions

      $ henri g scaffold HighScore game:string score:integer
        --> Create a model, a controller with resources actions
            and the matching resources routes
  `
  );
  process.exit(0);
};

module.exports = main;
