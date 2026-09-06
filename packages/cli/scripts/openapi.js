const fs = require('fs');
const path = require('path');

const { CliError } = require('./errors');
const { readConfig, readRoutes, validInstall } = require('./utils');
const { expand } = require('./routing');

/**
 * `henri openapi`: the OpenAPI 3.1 description of what the application
 * exposes, built from `config/routes.js`, `app/models` and the
 * configuration, without booting the server or touching a database.
 *
 * The builder is core's (`@usehenri/core/src/base/openapi.js`), so the
 * document says exactly what the router, the HAL helpers and the guards do.
 * This file is the part that reads an application off the disk: the routes
 * expanded the way `henri routes` expands them, the model files, the actions
 * the controllers actually export, and the policies that exist.
 */

/**
 * Prefer the `@usehenri/core` the project depends on and fall back to the
 * one shipped with this CLI, the way the database commands do
 *
 * @param {string} id The module path inside the package
 * @param {string} cwd The application directory
 * @returns {*} The module
 */
const fromCore = (id, cwd) => {
  try {
    return require(require.resolve(`@usehenri/core/${id}`, { paths: [cwd] }));
  } catch {
    return require(`@usehenri/core/${id}`);
  }
};

/**
 * The `.js` files of a directory, as posix names without the extension
 * (`tasks`, `admin/users`)
 *
 * @param {string} dir The directory
 * @returns {Array<string>} The names, sorted
 */
const listing = (dir) => {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const found = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }

      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith('.js')) {
        found.push(`${prefix}${entry.name.slice(0, -3)}`);
      }
    }
  };

  walk(dir, '');

  return found.sort();
};

/**
 * Action names read from a controller source without loading it, for a file
 * that cannot be required (it reaches for a model global at load time, say)
 *
 * @param {string} source The controller source
 * @returns {Array<string>} The action names
 */
const scanActions = (source) => {
  const names = new Set();
  const pattern =
    /^\s{2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?::\s*(?:async\s*)?(?:\(|function)|\()/gm;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    names.add(match[1]);
  }

  return Array.from(names);
};

/**
 * Which `controller#action` the application actually exports.
 *
 * A route pointing at an action that is not there answers 501 in
 * development and is never registered in production, and the document says
 * so rather than describing an endpoint nobody can call. `null` when
 * `app/controllers` does not exist, which is the honest "unknown".
 *
 * @param {string} cwd The application directory
 * @returns {?object} `{ 'tasks#index': true }`, or null
 */
const actionsOf = (cwd) => {
  const dir = path.join(cwd, 'app', 'controllers');

  if (!fs.existsSync(dir)) {
    return null;
  }

  const actions = {};

  for (const name of listing(dir)) {
    const file = path.join(dir, `${name}.js`);
    let names;

    try {
      delete require.cache[require.resolve(file)];

      const loaded = require(file) || {};

      names = Object.keys(loaded).filter(
        (key) => key !== 'before' && typeof loaded[key] === 'function'
      );
    } catch {
      // A controller that cannot be loaded outside a booted application:
      // read the actions off the source instead of pretending there are none
      names = scanActions(fs.readFileSync(file, 'utf8'));
    }

    for (const action of names) {
      actions[`${name}#${action}`] = true;
    }
  }

  return actions;
};

/**
 * The identity of the application, for `info`
 *
 * @param {string} cwd The application directory
 * @returns {{description: ?string, title: string, version: string}} The info
 */
const identity = (cwd) => {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
    );

    return {
      description: typeof pkg.description === 'string' ? pkg.description : null,
      title: pkg.name || path.basename(cwd),
      version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    };
  } catch {
    return { description: null, title: path.basename(cwd), version: '0.0.0' };
  }
};

/**
 * Builds the description of the application in the current directory
 *
 * @param {string} [cwd=process.cwd()] The application directory
 * @returns {object} The OpenAPI document
 */
const describe = (cwd = process.cwd()) => {
  const { build } = fromCore('src/base/openapi', cwd);
  const { loadModules } = fromCore('src/utils', cwd);

  return build({
    actions: actionsOf(cwd),
    config: readConfig(cwd, undefined),
    info: identity(cwd),
    models: Object.values(loadModules(path.join(cwd, 'app', 'models'))),
    policies: listing(path.join(cwd, 'app', 'policies')),
    routes: expand(readRoutes(cwd)),
  });
};

/**
 * What the document covers, and what it could not
 *
 * @param {object} document The OpenAPI document
 * @returns {string} The summary
 */
const summary = (document) => {
  const { coverage, excluded = [] } = document.info['x-henri'];
  const unknown = [];

  for (const [route, item] of Object.entries(document.paths)) {
    for (const [verb, operation] of Object.entries(item)) {
      const marks = operation['x-henri'] || {};

      if (marks.known !== true) {
        unknown.push(`${verb.toUpperCase()} ${route}  ${operation.summary}`);
      }
    }
  }

  const lines = [
    '',
    `OpenAPI ${document.openapi} for ${document.info.title} ${document.info.version}`,
    '',
    `  ${coverage.operations} operations, ${Object.keys(document.paths).length} paths`,
    `  ${coverage.described} described from the routes, the models and henri's own endpoints`,
    `  ${coverage.unknown} whose answer henri cannot know`,
    '',
  ];

  if (unknown.length > 0) {
    lines.push(
      '  What henri cannot know (the controller writes the body; only the failures henri answers itself are described):'
    );
    lines.push(...unknown.map((line) => `    ${line}`), '');
  }

  for (const entry of excluded) {
    lines.push(`  Left out: ${entry.route} (${entry.reason})`);
  }

  if (excluded.length > 0) {
    lines.push('');
  }

  return lines.join('\n');
};

/**
 * Print the OpenAPI description of the application (JSON on stdout), or
 * write it to a file
 *
 * @param {object} [args] CLI arguments (`--out <file>`, `--summary`)
 * @returns {Promise<void>} Resolves when printed
 * @throws {CliError} USAGE on a bad `--out`, or when the file cannot be written
 */
const main = async (args = {}) => {
  validInstall({ fatal: true });

  const document = describe(process.cwd());

  if (args.summary === true) {
    console.log(summary(document));

    return;
  }

  const body = `${JSON.stringify(document, null, 2)}\n`;

  if (typeof args.out === 'undefined') {
    process.stdout.write(body);

    return;
  }

  if (typeof args.out !== 'string' || args.out.length === 0) {
    throw new CliError('USAGE', '--out needs a file name', {
      hint: 'henri openapi --out openapi.json',
    });
  }

  const target = path.resolve(process.cwd(), args.out);

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  } catch (error) {
    throw new CliError(
      'HENRI_API_DESCRIPTION_UNWRITABLE',
      `unable to write ${args.out}: ${error.message}`,
      {
        cause: error,
        hint: 'Check the path and the permissions of the directory, or print the document to stdout instead: henri openapi > openapi.json',
      }
    );
  }

  console.log(`${path.relative(process.cwd(), target)} written`);
  console.log(summary(document));
};

module.exports = main;
module.exports.actionsOf = actionsOf;
module.exports.describe = describe;
module.exports.summary = summary;
