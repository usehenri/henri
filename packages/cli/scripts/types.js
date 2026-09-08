const fs = require('fs');
const path = require('path');

const { CliError } = require('./errors');
const { readConfig, readRoutes, validInstall } = require('./utils');
const { expand } = require('./routing');

/**
 * `henri types`: the models and the path helpers of this application, as
 * TypeScript, written to `.henri/types.d.ts` without booting the server or
 * touching a database.
 *
 * The builder is core's (`@usehenri/core/src/base/types.js`), so the file
 * says exactly what the model files and the routes file say. This is the
 * part that reads an application off the disk -- the routes expanded the
 * way `henri routes` expands them, the model files loaded the way the model
 * module loads them -- and it is the same pair `henri openapi` reads.
 *
 * The development server writes the same file on every boot and every hot
 * reload (`5.router.js`), so this command is for the times there is no
 * server: a checkout, a CI job, an agent that has just edited a model and
 * wants to typecheck before it runs anything.
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
 * What the application declares, and the file that says so
 *
 * A model file that will not load is not a reason to write nothing: it is
 * named in `skipped` and the models around it are described, because an
 * application mid-edit is the normal case rather than the exception.
 *
 * @param {string} [cwd=process.cwd()] The application directory
 * @returns {{description: object, source: string}} the file and what it says
 */
const describe = (cwd = process.cwd()) => {
  const { build } = fromCore('src/base/types', cwd);
  const { loadModules } = fromCore('src/utils', cwd);
  const skipped = [];
  let models = [];
  let routes = [];

  try {
    models = Object.values(loadModules(path.join(cwd, 'app', 'models')));
  } catch (error) {
    skipped.push({ name: 'app/models', why: error.message });
  }

  try {
    routes = expand(readRoutes(cwd));
  } catch (error) {
    // An empty registry means `pathFor()` takes any string again, which is
    // where an application without this file already was
    skipped.push({ name: 'config/routes.js', why: error.message });
  }

  return build({
    config: readConfig(cwd, undefined),
    models,
    routes,
    skipped,
  });
};

/**
 * Writes the file, and says where it went
 *
 * @param {string} cwd The application directory
 * @param {string} source What to write
 * @param {string} file Where to write it, relative to the application
 * @returns {string} The path, relative to the application
 * @throws {CliError} HENRI_CLI_TYPES_UNWRITABLE when it cannot be written
 */
const write = (cwd, source, file) => {
  const target = path.resolve(cwd, file);

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  } catch (error) {
    throw new CliError(
      'HENRI_CLI_TYPES_UNWRITABLE',
      `unable to write ${file}: ${error.message}`,
      {
        cause: error,
        hint: 'Check the permissions of the directory, or print the declarations instead: henri types --stdout',
      }
    );
  }

  return path.relative(cwd, target);
};

/**
 * Describe the application and write the file
 *
 * @param {string} [cwd=process.cwd()] The application directory
 * @returns {{description: object, file: string}} What it read, and where it went
 * @throws {CliError} HENRI_CLI_TYPES_UNWRITABLE when it cannot be written
 */
const generate = (cwd = process.cwd()) => {
  const { FILE } = fromCore('src/base/types', cwd);
  const { description, source } = describe(cwd);

  return { description, file: write(cwd, source, FILE) };
};

/**
 * What the file covers, and what it could not
 *
 * @param {object} description What `describe()` read
 * @param {?string} written Where the file went, when it was written
 * @returns {string} The summary
 */
const summary = (description, written) => {
  const { models, paths, skipped } = description;
  const columns = models.reduce(
    (total, model) => total + model.columns.length,
    0
  );
  const lines = [
    '',
    written ? `${written} written` : 'The declarations of this application',
    '',
    `  ${models.length} model${models.length === 1 ? '' : 's'}, ${columns} column${
      columns === 1 ? '' : 's'
    }`,
    `  ${paths.length} path helper${paths.length === 1 ? '' : 's'}`,
    '',
  ];

  if (skipped.length > 0) {
    lines.push('  What henri could not describe (and left out):');
    lines.push(...skipped.map(({ name, why }) => `    ${name}: ${why}`), '');
  }

  lines.push(
    '  Errors are opt-in: `// @ts-check` at the top of a file, or',
    '  `"checkJs": true` in jsconfig.json for the whole application.',
    ''
  );

  return lines.join('\n');
};

/**
 * Write the declarations of this application into `.henri/types.d.ts`
 *
 * @param {object} [args] CLI arguments (`--stdout`, `--json`)
 * @returns {Promise<void>} Resolves when written
 * @throws {CliError} when the file cannot be written
 */
const main = async (args = {}) => {
  validInstall({ fatal: true });

  const cwd = process.cwd();

  if (args.stdout === true) {
    process.stdout.write(describe(cwd).source);

    return;
  }

  const { description, file: written } = generate(cwd);

  if (args.json === true) {
    console.log(JSON.stringify({ file: written, ...description }, null, 2));

    return;
  }

  console.log(summary(description, written));
};

module.exports = main;
module.exports.describe = describe;
module.exports.generate = generate;
module.exports.summary = summary;
