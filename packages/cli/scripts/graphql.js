const path = require('path');

const { CliError } = require('./errors');
const { readConfig, validInstall } = require('./utils');

/**
 * `henri graphql`: the GraphQL definition henri derives from the models,
 * printed without starting the server or touching a database.
 *
 * The derivation is core's (`@usehenri/core/src/base/graphql-schema.js`),
 * the same one the boot builds the served schema from, so what this prints
 * is what an application answers -- not a description of it. There is no
 * `henri generate graphql`, and that is the point: a definition written
 * into a model file is a copy of the schema that stops being true the first
 * time a column changes. This is the read of it, and pasting what it prints
 * into a model is how somebody takes ownership of the definition.
 */

/**
 * Prefer the `@usehenri/core` the project depends on and fall back to the
 * one shipped with this CLI, the way `henri openapi` does
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

/** What each refusal is about, as a sentence */
const WHAT = {
  field: 'not a field',
  filter: 'not an argument',
  input: 'not an input',
};

/** Why henri left something out, as a sentence */
const REASONS = {
  excluded: 'the model listed it in graphql.except',
  'not-queryable': 'encrypted and randomised: henri refuses to query it',
  personal: 'personal: readable on a record, never searchable',
  private: 'personal: { expose: false }, so it never leaves the server',
  reference: 'a reference: matching one is a lookup henri will not make',
  'unknown-model': 'it references a model this application does not have',
  'unknown-type': 'henri has no GraphQL type for it',
  unshaped: 'a json column holds no shape GraphQL could state',
};

/**
 * The descriptions of every model declaring `graphql`
 *
 * @param {string} [cwd=process.cwd()] The application directory
 * @returns {Array<object>} The descriptions
 */
const describe = (cwd = process.cwd()) => {
  const { describe: derive } = fromCore('src/base/graphql-schema', cwd);
  const { loadModules } = fromCore('src/utils', cwd);

  return derive(
    Object.values(loadModules(path.join(cwd, 'app', 'models'))),
    readConfig(cwd, undefined)
  );
};

/**
 * The SDL of every derived model, one block per model
 *
 * @param {Array<object>} descriptions What `describe()` answered
 * @param {function} sdlOf The renderer, from core
 * @returns {string} The SDL
 */
const document = (descriptions, sdlOf) =>
  descriptions
    .filter((description) => description.generate)
    .map((description) => `# ${description.model}\n${sdlOf(description)}`)
    .join('\n');

/**
 * What henri derived, and what it left out of each model
 *
 * @param {Array<object>} descriptions What `describe()` answered
 * @returns {string} The summary
 */
const summary = (descriptions) => {
  const derived = descriptions.filter((entry) => entry.generate);
  const written = descriptions.filter((entry) => !entry.generate);
  const lines = [
    '',
    `GraphQL derived from ${derived.length} model${derived.length === 1 ? '' : 's'}`,
    '',
  ];

  for (const description of derived) {
    const queries = description.queries
      ? [description.queries.one, description.queries.many]
      : [];
    const operations = [...queries, ...Object.values(description.mutations)];

    lines.push(
      `  ${description.name}  ${description.fields.length + 1} fields, ${
        description.filters.length
      } filter${description.filters.length === 1 ? '' : 's'}`
    );
    lines.push(`    ${operations.join(', ') || 'no operation'}`);

    for (const refusal of description.refusals) {
      lines.push(
        `    ${refusal.field}: ${WHAT[refusal.what]} -- ${
          REASONS[refusal.reason] || refusal.reason
        }`
      );
    }

    lines.push('');
  }

  if (written.length > 0) {
    lines.push(
      '  Written by the model itself, and merged as it is:',
      ...written.map((entry) => `    ${entry.model}`),
      ''
    );
  }

  if (derived.length + written.length === 0) {
    lines.push(
      '  No model declares a `graphql` key. `graphql: true` on a model derives',
      '  its type, its queries and its resolvers from the schema it already has.',
      ''
    );
  }

  return lines.join('\n');
};

/**
 * Print the GraphQL definition henri derives from the models
 *
 * @param {object} [args] CLI arguments (`[model]`, `--summary`, `--json`)
 * @returns {Promise<void>} Resolves when printed
 * @throws {CliError} USAGE when the named model declares no `graphql` key
 */
const main = async (args = {}) => {
  validInstall({ fatal: true });

  const cwd = process.cwd();
  const { sdlOf } = fromCore('src/base/graphql-schema', cwd);
  const wanted = args._ && args._[0];
  const all = describe(cwd);
  const descriptions = wanted
    ? all.filter(
        (entry) =>
          entry.model.toLowerCase() === String(wanted).toLowerCase() ||
          entry.identity === String(wanted).toLowerCase()
      )
    : all;

  if (wanted && descriptions.length === 0) {
    throw new CliError(
      'USAGE',
      `No model named "${wanted}" declares a graphql key`,
      {
        hint:
          all.length > 0
            ? `These do: ${all.map((entry) => entry.model).join(', ')}`
            : 'Add `graphql: true` to a model and henri derives its definition from the schema',
      }
    );
  }

  if (args.json === true) {
    process.stdout.write(`${JSON.stringify(descriptions, null, 2)}\n`);

    return;
  }

  if (args.summary === true) {
    console.log(summary(descriptions));

    return;
  }

  const sdl = document(descriptions, sdlOf);

  if (sdl.length === 0) {
    console.log(summary(descriptions));

    return;
  }

  process.stdout.write(sdl);
};

module.exports = main;
module.exports.describe = describe;
module.exports.summary = summary;
