const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const prettier = require('prettier');

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
      // scaffold(args._);
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

const output = (type, dir, file, code) => {
  const location = path.join(cwd, 'app', dir, `${file}.js`);
  fs.outputFileSync(
    path.join(cwd, 'app', dir, `${file}.js`),
    prettier.format(code)
  );
  console.log(`> created ${type} "${file}" @ ${location}`);
};

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
