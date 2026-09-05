 
const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const handlebars = require('handlebars');

const { usage } = require('./help');
const { format, names, readRoutes, validInstall } = require('./utils');

/**
 * The attribute types of the henri model format. Adapters map them to
 * their own types (mongoose: integer -> Number, json -> Mixed, ...).
 */
const TYPES = [
  'string',
  'text',
  'number',
  'integer',
  'float',
  'boolean',
  'date',
  'json',
  'uuid',
];

const VIEWS = ['index', '_form', 'new', 'edit', 'show'];

/**
 * Initial function
 *
 * @param {*} args command line arguments
 * @return {Promise<void>} Resolves when done
 */
const main = async (args) => {
  const [cmd, target, ...rest] = args._;
  const opts = { force: args.force === true };

  if (!cmd) {
    console.log(usage('generate'));

    return;
  }

  const generator = generators[cmd];

  if (!generator) {
    throw new Error(
      `Unknown generator "${cmd}". Available: ${Object.keys(generators).join(', ')}`
    );
  }

  if (!target) {
    throw new Error(`Missing name: henri generate ${cmd} <name>`);
  }

  validInstall({ fatal: true });

  await generator(target, rest, opts);
};

/**
 * Parse `name:type!` attributes into a schema
 *
 * @param {string[]} [attributes=[]] Attributes as typed on the command line
 * @returns {object} The schema ({ name: { type, required } })
 * @throws on an unknown type
 */
const parseAttributes = (attributes = []) => {
  const schema = {};

  for (const attribute of attributes) {
    let [name, rawType = 'string'] = attribute.split(':');
    let required = false;

    if (name.endsWith('!')) {
      required = true;
      name = name.slice(0, -1);
    }

    if (rawType.endsWith('!')) {
      required = true;
      rawType = rawType.slice(0, -1);
    }

    const type = rawType.toLowerCase() || 'string';

    if (!name) {
      throw new Error(`Invalid attribute "${attribute}": expected name:type`);
    }

    if (!TYPES.includes(type)) {
      throw new Error(
        `Unknown type "${type}" for attribute "${name}". Valid types: ${TYPES.join(', ')}`
      );
    }

    schema[name] = required ? { required: true, type } : { type };
  }

  return schema;
};

/**
 * Handle models
 *
 * @param {string} name Model name (singular, ex: Post)
 * @param {string[]} attributes Attributes (name:type!)
 * @param {object} [opts] { force }
 * @return {Promise<boolean>} True when written
 */
const model = async (name, attributes = [], opts = {}) => {
  const { doc } = names(name);
  const schema = parseAttributes(attributes);

  const code = `
// Models are autoloaded from app/models and exposed globally (here: \`${doc}\`).
// Types: ${TYPES.join(', ')}.
// Keys: type, required, default, enum, unique (anything else is handed to
// the adapter as is).
module.exports = {
  options: { timestamps: true },
  schema: ${util.inspect(schema, { depth: 6 })},
  store: 'default', // a store name from config/default.json
};
`;

  return output('model', 'app/models', `${doc}.js`, code, opts);
};

/**
 * Generates a controller and one route per action
 *
 * @param {string} name Controller name (ex: locations)
 * @param {string[]} actions Actions (ex: index show)
 * @param {object} [opts] { force }
 * @return {Promise<boolean>} True when written
 */
const controller = async (name, actions = [], opts = {}) => {
  const lower = name.toLowerCase();
  const methods = actions.map(
    (action) => `
  ${action}: async (req, res) => {
    res.boom.notImplemented('${lower}#${action} is not implemented yet');
  },`
  );
  const code = `module.exports = {${methods.join('\n')}\n};`;

  const written = await output(
    'controller',
    'app/controllers',
    `${lower}.js`,
    code,
    opts
  );

  if (written && actions.length > 0) {
    await addRoutes(
      Object.fromEntries(
        actions.map((action) => [
          `get /${lower}/${action}`,
          `${lower}#${action}`,
        ])
      )
    );
  }

  return written;
};

/**
 * Generates a worker (app/workers) with start and stop
 *
 * @param {string} name Worker name
 * @param {string[]} rest Unused
 * @param {object} [opts] { force }
 * @return {Promise<boolean>} True when written
 */
const worker = async (name, rest = [], opts = {}) => {
  const lower = name.toLowerCase();
  const code = `
// Workers start with the server and stop with it (skip them with
// --skip-workers). Both functions receive the running henri instance.
let timer = null;

module.exports = {
  name: '${lower}',

  start: async (henri) => {
    henri.pen.info('${lower}', 'started');
    // timer = setInterval(() => henri.pen.info('${lower}', 'tick'), 60000);
  },

  stop: async (henri) => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    henri.pen.info('${lower}', 'stopped');
  },
};
`;

  return output('worker', 'app/workers', `${lower}.js`, code, opts);
};

/**
 * Generates a test file using @usehenri/testing
 *
 * @param {string} name Test name (ex: tasks, the path it requests)
 * @param {string[]} rest Unused
 * @param {object} [opts] { force }
 * @return {Promise<boolean>} True when written
 */
const test = async (name, rest = [], opts = {}) => {
  const lower = name.toLowerCase();
  const code = `
// Runs with \`henri test\`: setup() boots henri under NODE_ENV=test and
// request() is a supertest agent bound to the running server.
const { request, setup } = require('@usehenri/testing');

describe('${lower}', () => {
  beforeAll(() => setup());

  test('GET /${lower} answers', async () => {
    const response = await request()
      .get('/${lower}')
      .set('Accept', 'application/json');

    expect(response.status).toBe(200);
  });
});
`;

  return output('test', 'test', `${lower}.test.js`, code, opts);
};

/**
 * Scaffold builder: model, resources controller, routes and views
 *
 * @param {string} name Model name (singular, ex: Post)
 * @param {string[]} attributes Attributes (name:type!)
 * @param {object} [opts] { force }
 * @return {Promise<void>} Resolves when done
 */
const scaffold = async (name, attributes = [], opts = {}) => {
  await model(name, attributes, opts);
  await resources(name, attributes, opts);
};

/**
 * The resources of a scaffold without the model: controller, routes, views
 *
 * @param {string} name Model name (singular, ex: Post)
 * @param {string[]} attributes Attributes (name:type!)
 * @param {object} [opts] { force }
 * @return {Promise<void>} Resolves when done
 */
const resources = async (name, attributes = [], opts = {}) => {
  const resource = { ...names(name), keys: extractKeys(attributes) };
  const generator = require('./generate/controllers');

  await output(
    'controller',
    'app/controllers',
    `${resource.plural}.js`,
    generator.resources(resource),
    opts
  );
  await addRoutes({ [`resources ${resource.plural}`]: resource.plural });
  await views(resource, opts);
};

/**
 * Build the crud: model, json controller and routes
 *
 * @param {string} name Model name (singular, ex: Post)
 * @param {string[]} attributes Attributes (name:type!)
 * @param {object} [opts] { force }
 * @return {Promise<void>} Resolves when done
 */
const crud = async (name, attributes = [], opts = {}) => {
  const resource = { ...names(name), keys: extractKeys(attributes) };
  const generator = require('./generate/controllers');

  await model(name, attributes, opts);
  await output(
    'controller',
    'app/controllers',
    `${resource.plural}.js`,
    generator.crud(resource),
    opts
  );
  await addRoutes({ [`crud ${resource.plural}`]: resource.plural });
};

/**
 * Handle views processing
 *
 * @param {object} resource { doc, lower, plural, keys }
 * @param {object} [opts] { force }
 * @returns {Promise<void>} Resolves when written
 */
const views = async (resource, opts = {}) => {
  for (const view of VIEWS) {
    await compileView({ ...resource, view }, opts);
  }
};

/**
 * Extract the attribute names from name:type arguments
 *
 * @param {string[]} [args=[]] arguments
 * @return {Array<string>} Results
 */
const extractKeys = (args = []) =>
  args.map((val) => val.split(':')[0].replace(/!$/, ''));

/**
 * Compile one view template into app/views/pages/<plural>/<view>.js
 *
 * @param {object} resource { doc, lower, plural, keys, view, renderer }
 * @param {object} [opts] { force }
 * @return {Promise<boolean>} True when written
 */
const compileView = async (
  { doc, lower, plural, keys = [], view = 'index', renderer = 'react' },
  opts = {}
) => {
  const data = fs.readFileSync(
    path.join(__dirname, `./generate/${renderer}-${view}.hbs`),
    'utf8'
  );
  const template = handlebars.compile(data.toString());

  return output(
    'view',
    `app/views/pages/${plural}`,
    `${view}.js`,
    template({ doc, keys, lower, plural }),
    opts
  );
};

/**
 * Add routes to config/routes.js (existing keys are overwritten)
 *
 * @param {object} entries { 'verb /path': 'controller#action', ... }
 * @return {Promise<void>} Resolves when written
 */
const addRoutes = async (entries) => {
  const location = path.join(process.cwd(), 'config', 'routes.js');
  const actual = Object.assign(readRoutes(process.cwd()), entries);

  fs.outputFileSync(
    location,
    await format(`module.exports = ${util.inspect(actual, { depth: 6 })};`)
  );

  for (const key of Object.keys(entries)) {
    console.log(`> added route "${key}" @ config/routes.js`);
  }
};

/**
 * Outputs code into a file, unless it exists (see --force)
 *
 * @param {string} type Type of output (model, controller, ...)
 * @param {string} dir Target directory, relative to the project
 * @param {string} file Target file name
 * @param {string} code The code that should be written in the file
 * @param {object} [opts] { force }
 * @return {Promise<boolean>} True when the file was written
 */
const output = async (type, dir, file, code, { force = false } = {}) => {
  const relative = path.join(dir, file);
  const location = path.join(process.cwd(), relative);

  if (fs.existsSync(location) && !force) {
    console.log(
      `> skipped ${type} "${file}": ${relative} exists (use --force to overwrite)`
    );

    return false;
  }

  fs.outputFileSync(location, await format(code));
  console.log(`> created ${type} "${file}" @ ${relative}`);

  return true;
};

const generators = { controller, crud, model, scaffold, test, worker };

module.exports = main;
module.exports.TYPES = TYPES;
module.exports.generators = generators;
module.exports.parseAttributes = parseAttributes;
module.exports.resources = resources;
