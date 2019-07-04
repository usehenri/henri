/* eslint-disable no-console */
const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const prettier = require('prettier');
const handlebars = require('handlebars');

const { cwd, version } = require('./utils');

/**
 * Initial function
 *
 * @param {*} args command line arguments
 * @return {void}
 */
const main = args => {
  const cmd = args._.shift();

  switch (cmd) {
    case 'model':
      model(args._);
      break;
    case 'controller':
      controller(args._);
      break;
    case 'scaffold':
      scaffold(args._);
      break;
    case 'crud':
      buildCrud(args._);
      break;
    default:
      help();
  }
};

/**
 * Handle models
 *
 * @param {*} [file] File and args
 * @return {void}
 */
const model = ([file, ...args]) => {
  let code = `module.exports = `;
  const base = {
    options: {
      timestamps: true,
    },
    schema: {},
  };

  if (args.length > 0) {
    args.map(val => {
      const parts = val.split(':');

      base.schema[parts[0]] = { type: parts[1] || 'string' };
    });
  }
  code += util.inspect(base, { depth: 6 });
  output('model', 'models', file, code);
};

/**
 * Generates controller files
 *
 * @param {*} [file] File
 * @param {*} inner Inner of the controller function
 * @return {void}
 */
const controller = ([file, ...args], inner) => {
  let code = 'const { log } = henri; module.exports = {';

  if (args.length > 0) {
    args.map(val => {
      const fback = `res.status(501).send('controller ${file}#${val} not ready')`;

      code += `${val}: async (req,res) => { ${inner || fback} },`;
    });
  }
  code += '};';

  output('controller', 'controllers', file, code);
};

/**
 * Scaffold builder
 *
 * @param {*} [file] File
 * @return {void}
 */
const scaffold = ([file, ...args]) => {
  model([capitalize(file), ...args]);
  resources(file);
  routes(`resources ${file.toLowerCase()}`, {
    controller: file.toLowerCase(),
    scope: '_scaffold',
  });
  views(file, args);
};

/**
 * Build the crud
 *
 * @param {*} [file] file
 * @return {void}
 */
const buildCrud = ([file, ...args]) => {
  model([capitalize(file), ...args]);
  crud(file);
  routes(`crud ${file.toLowerCase()}`, {
    controller: file.toLowerCase(),
    scope: '_crud',
  });
};

/**
 * Build resources
 *
 * @param {*} file file
 * @return {void}
 */
const resources = file => {
  // eslint-disable-next-line
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

  output('controller', 'controllers', file, code);
};

/**
 * Create CRUD
 *
 * @param {*} file file
 * @return {void}
 */
const crud = file => {
  // eslint-disable-next-line
  const generator = require('./generate/controllers');
  const doc = capitalize(file);
  const lower = file.toLowerCase();

  let code = generator.header();

  code += generator.index(lower, doc);
  code += generator.create(lower, doc);
  code += generator.update(lower, doc);
  code += generator.destroy(lower, doc);

  output('controller', 'controllers', file, code);
};

/**
 * Handle views processing
 *
 * @param {*} file File
 * @param {*} args Arguments
 *
 * @returns {void}
 */
const views = (file, args) => {
  const doc = capitalize(file);
  const lower = file.toLowerCase();
  const keys = extractKeys(args);

  compileView({ doc, keys, lower, view: 'index' });
  compileView({ doc, keys, lower, view: '_form' });
  compileView({ doc, keys, lower, view: 'new' });
  compileView({ doc, keys, lower, view: 'edit' });
  compileView({ doc, keys, lower, view: 'show' });
};

/**
 * Extract Keys from semi-colon
 *
 * @param {*} [args=[]] arguments
 * @return {Array<string>} Results
 */
const extractKeys = (args = []) => args.map(val => val.split(':')[0]);

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
 * @return {void}
 */
const compileView = ({
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

  output(
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
 * @return {void}
 */
const routes = (key, opts) => {
  let code = `module.exports = `;
  const location = path.join(cwd, 'config', 'routes.js');
  // eslint-disable-next-line
  const actual = require(location);

  actual[key] = opts;
  code += util.inspect(actual);
  fs.outputFileSync(
    location,
    prettier.format(code, {
      parser: 'babel',
      singleQuote: true,
      trailingComma: 'es5',
    })
  );
  console.log(`> added route "${key}" @ ${location}`);
};

/**
 * Outputs data into a file
 *
 * @param {*} type Type of output
 * @param {*} dir Target directory
 * @param {*} file Target file
 * @param {*} code The code that should be written in the file
 * @return {void}
 */
const output = (type, dir, file, code) => {
  const location = path.join(cwd, 'app', dir, `${file}.js`);

  fs.outputFileSync(
    path.join(cwd, 'app', dir, `${file}.js`),
    prettier.format(code, {
      parser: 'babel',
      singleQuote: true,
      trailingComma: 'es5',
    })
  );
  console.log(`> created ${type} "${file}" @ ${location}`);
};

/**
 * Capitalize a word
 *
 * @param {string} word Word that needs to be capitalized
 * @returns {string} Capitalized word
 */
const capitalize = word => word.charAt(0).toUpperCase() + word.slice(1);

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
