/* eslint-disable no-console */
const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const prettier = require('prettier');
const handlebars = require('handlebars');

const { cwd, version } = require('./utils');

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

const model = ([file, ...args]) => {
  let code = `module.exports = `;
  const base = {
    schema: {},
    options: {
      timestamps: true,
    },
  };
  if (args.length > 0) {
    args.map(v => {
      const parts = v.split(':');
      base.schema[parts[0]] = { type: parts[1] || 'string' };
    });
  }
  code += util.inspect(base, { depth: 6 });
  output('model', 'models', file, code);
};

const controller = ([file, ...args], inner) => {
  let code = 'const { log } = henri; module.exports = {';

  if (args.length > 0) {
    args.map(v => {
      const fback = `res.status(501).send('controller ${file}#${v} not ready')`;
      code += `${v}: async (req,res) => { ${inner || fback} },`;
    });
  }
  code += '};';

  output('controller', 'controllers', file, code);
};

const scaffold = ([file, ...args]) => {
  model([capitalize(file), ...args]);
  resources(file);
  routes(`resources ${file.toLowerCase()}`, {
    controller: file.toLowerCase(),
    scope: '_scaffold',
  });
  views(file, args);
};

const buildCrud = ([file, ...args]) => {
  model([capitalize(file), ...args]);
  crud(file);
  routes(`crud ${file.toLowerCase()}`, {
    controller: file.toLowerCase(),
    scope: '_crud',
  });
};

const resources = file => {
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

const crud = file => {
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

const views = (file, args) => {
  const doc = capitalize(file);
  const lower = file.toLowerCase();
  const keys = extractKeys(args);

  compileView({ keys, lower, doc, view: 'index' });
  compileView({ keys, lower, doc, view: '_form' });
  compileView({ keys, lower, doc, view: 'new' });
  compileView({ keys, lower, doc, view: 'edit' });
  compileView({ keys, lower, doc, view: 'show' });
};

const extractKeys = (args = []) => args.map(v => v.split(':')[0]);

const compileView = ({
  lower,
  doc,
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
    template({ lower, doc, keys })
  );
};

const routes = (key, opts) => {
  let code = `module.exports = `;
  const location = path.join(cwd, 'app', 'routes.js');
  const actual = require(location);
  actual[key] = opts;
  code += util.inspect(actual);
  fs.outputFileSync(
    location,
    prettier.format(code, {
      singleQuote: true,
      trailingComma: 'es5',
    })
  );
  console.log(`> added route "${key}" @ ${location}`);
};

const output = (type, dir, file, code) => {
  const location = path.join(cwd, 'app', dir, `${file}.js`);
  fs.outputFileSync(
    path.join(cwd, 'app', dir, `${file}.js`),
    prettier.format(code, {
      singleQuote: true,
      trailingComma: 'es5',
    })
  );
  console.log(`> created ${type} "${file}" @ ${location}`);
};

const capitalize = word => word.charAt(0).toUpperCase() + word.slice(1);

const help = args => {
  console.log(
    `
    henri (${version})

    Usage
      $ henri generate <command> <target> [options]

    Available commands
      model, controller, scaffold

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
