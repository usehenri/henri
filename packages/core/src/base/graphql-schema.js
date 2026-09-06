/**
 * The GraphQL definition of a model, derived from the schema it already
 * declares.
 *
 * A model that wanted GraphQL used to write its types out by hand, in SDL,
 * next to the henri schema that had just said the same thing:
 *
 * ```js
 * schema: { title: { type: 'string', required: true }, year: { type: 'integer' } },
 * graphql: { types: `type Artwork { title: String!, year: Int }`, resolvers: { ... } },
 * ```
 *
 * That is the issue this file closes (#68), and the interesting half of it
 * is *where* the answer goes.
 *
 * ## Derived at boot, not written into the file
 *
 * A generator would write the SDL into the model and hand it over: honest,
 * editable, and wrong the first time somebody adds a column. henri already
 * refuses that trade everywhere the source is a model file --
 * `base/openapi.js` builds the OpenAPI document from the routes and the
 * models rather than shipping a checked-in one, `res.resource()` builds the
 * `_links` from the route table, `base/references.js` decides what a
 * foreign key publishes as. This is the same fact in a fourth format, and a
 * fourth copy of it is a fourth thing to keep in step.
 *
 * The identifier rules are what settle it. A generated
 * `type Artwork { id: ID! }` is a *claim about identifiers*, frozen the day
 * it was written: `config.externalIds` can turn the public identifier off,
 * a field can gain a `personal: { expose: false }` mark, a column can
 * become `encrypted`, a relation can be declared. Every one of those
 * changes what the type must say, and a file written last March says the
 * old thing while the REST answer next to it says the new one. Derived, the
 * two cannot disagree.
 *
 * What a generator would have given -- ownership -- is still there twice
 * over: a model that writes `graphql: { types, resolvers }` is untouched and
 * merged as it always was, and `henri graphql` prints the derived SDL so it
 * can be read, reviewed and pasted into the model by anyone who wants to
 * own it.
 *
 * ## What each henri type becomes
 *
 * | henri                  | GraphQL                                        |
 * | ---------------------- | ---------------------------------------------- |
 * | `string`, `text`       | `String`                                       |
 * | `integer`              | `Int`                                          |
 * | `number`, `float`      | `Float`                                        |
 * | `boolean`              | `Boolean`                                      |
 * | `date`                 | `String` (ISO 8601, what the JSON answer holds) |
 * | `uuid`                 | `String`                                       |
 * | `json`                 | nothing -- see below                           |
 * | `enum: [...]`          | an `enum <Type><Field>`, or `String`           |
 * | a declared foreign key | `ID`, the `externalId` of the row it names     |
 *
 * `required: true` makes the field non-null. A `json` column is left out:
 * it holds whatever the application put in it, GraphQL wants a shape, and
 * henri will not invent one -- add the field and a scalar of your own.
 *
 * **`id` is `ID!` and it is the `externalId`.** The primary key is not a
 * field, it is not an argument, and `Query.<model>(id:)` resolves through
 * `findById()`, which takes the public identifier and nothing else. A
 * generated type that published the primary key would undo
 * `base/references.js` one query at a time.
 *
 * ## What is never generated, and how henri knows
 *
 * Nothing here is a list of field names. Three marks the model already
 * carries answer it:
 *
 * - **`personal: { expose: false }`** -- not a field at all. `res.render()`,
 *   `res.resource()` and `res.collection()` drop those names from every
 *   answer they build, so a GraphQL field for one would be a hole in the
 *   side of the same wall. The user's `password` is covered by this and not
 *   by a special case: `base/privacy.js` marks it `expose: false` on every
 *   application that has a user model.
 * - **`personal: true`** -- a field, never an argument. A value you may read
 *   on a record you are allowed to see is not a value anybody may search by.
 * - **`encrypted`** -- randomised is never an argument: henri refuses that
 *   query with `HENRI_ENCRYPTION_NOT_QUERYABLE`, and a field the framework
 *   refuses to query has no business being a queryable argument.
 *   Deterministic may be one, because the adapter translates an equality
 *   into an `IN` over the envelopes. In practice the rule above catches
 *   almost every encrypted column first (`encrypted` implies `personal`),
 *   so this is what decides the one a model marked `personal: false` --
 *   an application secret rather than somebody's data.
 *
 * ## Queries by default, mutations on request
 *
 * `graphql: true` generates the type, `Query.<model>(id: ID!)` and
 * `Query.<models>(page, perPage, where)`. It generates no mutation:
 * `deleteArtwork` on the open endpoint of an application that never asked
 * for it is a hole, and the safe thing is the default.
 * `graphql: { generate: true, mutations: true }` asks for them.
 *
 * ## How it composes with app/policies
 *
 * Every generated resolver asks a policy, and there is no setting that
 * turns it off:
 *
 * - `Query.<model>(id:)` loads the record and asks `show`. A refusal and a
 *   row that is not there both answer `null` -- the same non-oracle
 *   `findById()` follows.
 * - `Query.<models>` asks `index` without a record, and then asks the policy
 *   what the list *is*: `policy.scope(user)` is the `where` it filters by. A
 *   policy with no `scope` raises `HENRI_API_GRAPHQL_SCOPE_REQUIRED` rather
 *   than quietly meaning everything, which is the answer
 *   `henri.policies.scope()` already gives.
 * - `createX` asks `create`, `updateX` and `deleteX` load the record and ask
 *   `update` / `destroy`.
 *
 * Policies fail closed, so a model with `graphql: true` and no
 * `app/policies/<model>.js` serves an empty page and a null record. That is
 * the intended reading: opting a model into GraphQL is not opting it out of
 * authorization. `henri doctor` reports the pair.
 *
 * @module base/graphql-schema
 */

const { fail } = require('./errors');
const { resolversOf } = require('./graphql-resolvers');
const { GENERATED, columnsOf, referenceOf, settingsOf } = require('./openapi');
const { isPlainObject, mapOf } = require('./privacy');
const { pluralize } = require('./routes');

/** The henri schema types and the GraphQL type each one becomes */
const TYPES = Object.freeze({
  boolean: 'Boolean',
  date: 'String',
  float: 'Float',
  integer: 'Int',
  number: 'Float',
  string: 'String',
  text: 'String',
  uuid: 'String',
});

/** What GraphQL accepts as a name, for a type, a field or an enum value */
const NAME = /^[_A-Za-z][_0-9A-Za-z]*$/u;

/** Enum values GraphQL reserves: they are literals, not names */
const RESERVED_VALUES = new Set(['false', 'null', 'true']);

/** The keys a `graphql` block may hold */
const KEYS = [
  'except',
  'filters',
  'generate',
  'mutations',
  'name',
  'queries',
  'resolvers',
  'types',
];

/** The mutations that can be generated */
const MUTATIONS = ['create', 'update', 'destroy'];

/** The verb each generated mutation is named with */
const VERBS = Object.freeze({
  create: 'create',
  destroy: 'delete',
  update: 'update',
});

/** Columns the framework writes: never an argument, never in an input */
const NOT_WRITABLE = new Set([...GENERATED, 'password', 'roles']);

/**
 * A failure of the `graphql` key of a model
 *
 * @param {string} model the global id of the model
 * @param {string} message what is wrong
 * @param {string} [hint] what to do about it
 * @returns {Error} the error, to throw
 */
function invalid(model, message, hint) {
  const error = fail(
    'HENRI_API_GRAPHQL_INVALID_DECLARATION',
    `${model}: ${message}`
  );

  if (hint) {
    error.hint = hint;
  }

  return error;
}

/**
 * The first letter of a name, lowercased (`Artwork` -> `artwork`)
 *
 * @param {string} word the name
 * @returns {string} the field name
 */
function lowerFirst(word) {
  return word.charAt(0).toLowerCase() + word.slice(1);
}

/**
 * The first letter of a name, uppercased (`title` -> `Title`)
 *
 * @param {string} word the name
 * @returns {string} the name
 */
function upperFirst(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The `encrypted` mark of a field, as the model file wrote it. The adapters
 * validate the shape at boot; what is needed here is only the scheme.
 *
 * @param {*} definition a field definition
 * @returns {?{deterministic: boolean}} the mark, or null
 */
function encryptionOf(definition) {
  if (!isPlainObject(definition)) {
    return null;
  }

  const mark = definition.encrypted;

  if (mark === false || mark === null || typeof mark === 'undefined') {
    return null;
  }

  return { deterministic: isPlainObject(mark) && mark.deterministic === true };
}

/**
 * The `graphql` key of a model, normalized.
 *
 * `true` asks henri to generate everything safe; an object without
 * `generate` is what the model wrote by hand and is left exactly as it was.
 *
 * @param {object} model a model file
 * @returns {object} `{ except, filters, generate, mutations, name, queries, resolvers, types }`
 * @throws HENRI_API_GRAPHQL_INVALID_DECLARATION on anything henri cannot read
 */
function declarationOf(model) {
  const id = String(model.globalId || model.identity || 'model');
  const raw = model.graphql;
  const written = raw === true ? { generate: true } : raw;

  if (!isPlainObject(written)) {
    throw invalid(
      id,
      "'graphql' must be true or an object ({ generate, types, resolvers })",
      'graphql: true derives the types and the resolvers from the schema; an object writes them by hand'
    );
  }

  const unknown = Object.keys(written).filter((key) => !KEYS.includes(key));

  if (unknown.length > 0) {
    throw invalid(
      id,
      `'graphql' has no option named ${unknown.sort().join(', ')}`,
      `The keys are: ${KEYS.join(', ')}`
    );
  }

  const generate = written.generate === true;
  const name = typeof written.name === 'string' ? written.name : id;

  if (!generate && typeof written.types !== 'string') {
    throw invalid(
      id,
      "'graphql' asks for nothing: it neither generates a definition nor writes one",
      'graphql: true derives the types and the resolvers from the schema; `graphql: { types: `type ...` }` writes them by hand'
    );
  }

  if (generate && !NAME.test(name)) {
    throw invalid(
      id,
      `'${name}' is not a GraphQL type name`,
      "Name the type yourself: graphql: { generate: true, name: 'Artwork' }"
    );
  }

  for (const key of ['filters', 'queries']) {
    if (
      typeof written[key] !== 'undefined' &&
      typeof written[key] !== 'boolean'
    ) {
      throw invalid(id, `'graphql.${key}' must be true or false`);
    }
  }

  if (
    typeof written.types !== 'undefined' &&
    typeof written.types !== 'string'
  ) {
    throw invalid(id, "'graphql.types' must be a string of SDL");
  }

  if (
    typeof written.resolvers !== 'undefined' &&
    !isPlainObject(written.resolvers)
  ) {
    throw invalid(id, "'graphql.resolvers' must be an object of resolvers");
  }

  return {
    except: exceptOf(id, written.except),
    filters: written.filters !== false,
    generate,
    mutations: mutationsOf(id, written.mutations),
    name,
    queries: written.queries !== false,
    resolvers: isPlainObject(written.resolvers) ? written.resolvers : null,
    types: typeof written.types === 'string' ? written.types : null,
  };
}

/**
 * The fields a model asked henri to leave out
 *
 * @param {string} id the global id of the model
 * @param {*} value what `graphql.except` holds
 * @returns {Array<string>} the field names
 * @throws HENRI_API_GRAPHQL_INVALID_DECLARATION when it is not a list of names
 */
function exceptOf(id, value) {
  if (typeof value === 'undefined' || value === null) {
    return [];
  }

  const list = [].concat(value);

  if (list.some((entry) => typeof entry !== 'string')) {
    throw invalid(
      id,
      "'graphql.except' must be a field name or a list of them"
    );
  }

  return list;
}

/**
 * The mutations a model asked for
 *
 * @param {string} id the global id of the model
 * @param {*} value what `graphql.mutations` holds
 * @returns {Array<string>} the mutations, in the order henri writes them
 * @throws HENRI_API_GRAPHQL_INVALID_DECLARATION on an unknown mutation
 */
function mutationsOf(id, value) {
  if (typeof value === 'undefined' || value === false || value === null) {
    return [];
  }

  if (value === true) {
    return MUTATIONS.slice();
  }

  const list = [].concat(value);
  const unknown = list.filter((entry) => !MUTATIONS.includes(entry));

  if (unknown.length > 0) {
    throw invalid(
      id,
      `'graphql.mutations' has no mutation named ${unknown.join(', ')}`,
      `The mutations are: ${MUTATIONS.join(', ')}`
    );
  }

  return MUTATIONS.filter((entry) => list.includes(entry));
}

/**
 * The GraphQL type of one column, and the enum it needs when it has one
 *
 * @param {string} type the name of the GraphQL type this model becomes
 * @param {string} field the field name
 * @param {*} definition the field definition
 * @returns {?{type: string, enum: ?object, reason: ?string}} the type
 */
function typeOf(type, field, definition) {
  const reference = referenceOf(definition);

  if (reference) {
    return { enum: null, reason: null, type: 'ID' };
  }

  const written = isPlainObject(definition) ? definition : { type: definition };
  const values = Array.isArray(written.enum) ? written.enum : null;

  if (values && values.length > 0) {
    const nameable = values.every(
      (value) =>
        typeof value === 'string' &&
        NAME.test(value) &&
        !RESERVED_VALUES.has(value)
    );

    if (nameable) {
      return {
        enum: { name: `${type}${upperFirst(field)}`, values: values.slice() },
        reason: null,
        type: `${type}${upperFirst(field)}`,
      };
    }
  }

  const known = TYPES[String(written.type)];

  if (!known) {
    return {
      enum: null,
      reason: String(written.type) === 'json' ? 'unshaped' : 'unknown-type',
      type: null,
    };
  }

  return { enum: null, reason: null, type: known };
}

/**
 * The description of one model: its fields, its arguments and everything
 * henri left out, with the reason it left it out.
 *
 * @param {object} model a model file
 * @param {object} context `{ settings, hidden, personal }`
 * @returns {object} the description
 */
function describeModel(model, context) {
  const { hidden, personal, settings } = context;
  const declaration = declarationOf(model);
  const id = String(model.globalId || model.identity);
  const description = {
    declaration,
    enums: [],
    fields: [],
    filters: [],
    generate: declaration.generate,
    identity: String(model.identity || id.toLowerCase()),
    input: [],
    model: id,
    mutations: {},
    name: declaration.name,
    queries: null,
    references: {},
    refusals: [],
  };

  if (!declaration.generate) {
    return description;
  }

  const columns = columnsOf(model, settings);
  const isUser =
    String(model.identity || '').toLowerCase() ===
    String(settings.user.model || '').toLowerCase();

  /**
   * Records a field henri left somewhere out, and why
   *
   * @param {string} field the field name
   * @param {string} what where it was left out of (`field`, `filter`, `input`)
   * @param {string} reason why
   * @returns {void}
   */
  const refuse = (field, what, reason) => {
    description.refusals.push({ field, reason, what });
  };

  for (const field of Object.keys(columns).sort()) {
    const definition = columns[field];

    // `externalId` is the record's identifier and it is published as `id`;
    // the primary key is neither
    if (field === 'externalId' || field === 'id') {
      continue;
    }

    if (declaration.except.includes(field)) {
      refuse(field, 'field', 'excluded');
      continue;
    }

    // A name marked `expose: false` anywhere is stripped from every answer
    // henri builds, at every depth (`henri.privacy.strip`). A field for one
    // would answer null forever at best, and leak at worst
    if (hidden.has(field)) {
      refuse(field, 'field', 'private');
      continue;
    }

    const reference = referenceOf(definition);
    const encrypted = encryptionOf(definition);
    const shape =
      isUser && field === 'roles'
        ? { enum: null, reason: null, type: '[String!]' }
        : typeOf(declaration.name, field, definition);

    if (!shape.type) {
      refuse(field, 'field', shape.reason);
      continue;
    }

    if (shape.enum) {
      description.enums.push(shape.enum);
    }

    if (reference) {
      description.references[field] = reference;
    }

    description.fields.push({
      date: !reference && String((definition || {}).type) === 'date',
      name: field,
      reference: reference || null,
      required: Boolean(definition && definition.required === true),
      type: shape.type,
    });

    if (!declaration.filters) {
      continue;
    }

    if (NOT_WRITABLE.has(field)) {
      // A column henri writes itself is never an argument, and saying so
      // once in the guide is better than saying it per model
      continue;
    }

    if (reference) {
      // Its public value is another row's externalId; matching it means a
      // lookup henri would have to make per key. Write the resolver
      refuse(field, 'filter', 'reference');
    } else if (personal.has(field)) {
      refuse(field, 'filter', 'personal');
    } else if (encrypted && !encrypted.deterministic) {
      refuse(field, 'filter', 'not-queryable');
    } else {
      description.filters.push({ name: field, type: shape.type });
    }
  }

  for (const field of declaration.mutations.length > 0
    ? description.fields
    : []) {
    if (NOT_WRITABLE.has(field.name)) {
      continue;
    }

    if (field.reference && !context.known.has(field.reference)) {
      refuse(field.name, 'input', 'unknown-model');
      continue;
    }

    description.input.push({
      name: field.name,
      reference: field.reference,
      type: field.type,
    });
  }

  if (declaration.queries) {
    description.queries = {
      many: pluralize(lowerFirst(declaration.name)),
      one: lowerFirst(declaration.name),
      page: `${declaration.name}Page`,
    };
  }

  for (const mutation of declaration.mutations) {
    description.mutations[mutation] =
      `${VERBS[mutation]}${upperFirst(declaration.name)}`;
  }

  return description;
}

/**
 * What henri would generate for every model that asks for it.
 *
 * Pure: the model files and a configuration, nothing booted. `henri graphql`
 * and `henri doctor` read an application with it, and `3.model.js` builds
 * the boot's schema from the same answer.
 *
 * @param {Array<object>} models the model files
 * @param {*} [config] henri's config module, or the plain object a command read
 * @returns {Array<object>} one description per model declaring `graphql`
 * @throws HENRI_API_GRAPHQL_INVALID_DECLARATION on a `graphql` key henri cannot read
 */
function describe(models, config = {}) {
  const settings = settingsOf(config);
  const files = (Array.isArray(models) ? models : []).filter(Boolean);
  const user = files.find(
    (model) =>
      String(model.identity || '').toLowerCase() ===
      String(settings.user.model || '').toLowerCase()
  );
  const privacy = mapOf(files, {
    settings: settings.privacy,
    subject: user ? user.globalId : null,
  });
  const context = {
    hidden: new Set(privacy.private),
    // Which models exist: a reference naming one henri never loaded cannot
    // be resolved from an externalId, so it is not an input field
    known: new Set(files.map((model) => String(model.globalId))),
    personal: new Set(privacy.keys),
    settings,
  };

  return files
    .filter((model) => Boolean(model.graphql))
    .map((model) => describeModel(model, context));
}

/**
 * One SDL field, with its `!` when the model requires it
 *
 * @param {object} field a described field
 * @returns {string} the line
 */
function fieldLine(field) {
  return `  ${field.name}: ${field.type}${field.required ? '!' : ''}`;
}

/**
 * The SDL of one description: the type, its enums, its page, its input
 * types and the operations. An empty string when the model writes its own.
 *
 * @param {object} description what `describe()` answered for one model
 * @returns {string} the SDL
 */
function sdlOf(description) {
  if (!description.generate) {
    return '';
  }

  const { filters, input, mutations, name, queries } = description;
  const blocks = [];

  for (const entry of description.enums) {
    blocks.push(
      `enum ${entry.name} {\n${entry.values.map((value) => `  ${value}`).join('\n')}\n}`
    );
  }

  blocks.push(
    `type ${name} {\n  id: ID!\n${description.fields.map(fieldLine).join('\n')}\n}`
  );

  if (queries) {
    blocks.push(
      `type ${queries.page} {\n  records: [${name}!]!\n  page: Int!\n  perPage: Int!\n  total: Int!\n  pages: Int!\n}`
    );
  }

  if (queries && filters.length > 0) {
    blocks.push(
      `input ${name}Filter {\n${filters
        .map((filter) => `  ${filter.name}: ${filter.type}`)
        .join('\n')}\n}`
    );
  }

  const writes = Object.keys(mutations).length > 0;

  if (writes && input.length > 0) {
    blocks.push(
      `input ${name}Input {\n${input
        .map((field) => `  ${field.name}: ${field.type}`)
        .join('\n')}\n}`
    );
  }

  if (queries) {
    const where = filters.length > 0 ? `, where: ${name}Filter` : '';

    blocks.push(
      `type Query {\n  ${queries.one}(id: ID!): ${name}\n  ${queries.many}(page: Int, perPage: Int${where}): ${queries.page}!\n}`
    );
  }

  if (writes) {
    const takes = input.length > 0 ? `input: ${name}Input!` : '';
    const lines = [];

    if (mutations.create) {
      lines.push(`  ${mutations.create}(${takes}): ${name}`);
    }

    if (mutations.update) {
      lines.push(
        `  ${mutations.update}(id: ID!${takes ? `, ${takes}` : ''}): ${name}`
      );
    }

    if (mutations.destroy) {
      lines.push(`  ${mutations.destroy}(id: ID!): ${name}`);
    }

    blocks.push(`type Mutation {\n${lines.join('\n')}\n}`);
  }

  return `${blocks.join('\n\n')}\n`;
}

/**
 * Two resolver maps, merged one level deep. What the model wrote by hand
 * wins: a generated resolver is a starting point, never something an
 * application cannot replace.
 *
 * @param {?object} generated what henri derived
 * @param {?object} written what the model declared
 * @returns {?object} the resolvers, or null when there are none
 */
function mergeResolvers(generated, written) {
  if (!generated) {
    return written || null;
  }

  if (!written) {
    return generated;
  }

  const merged = { ...generated };

  for (const type of Object.keys(written)) {
    merged[type] = isPlainObject(merged[type])
      ? { ...merged[type], ...written[type] }
      : written[type];
  }

  return merged;
}

/**
 * The `{ types, resolvers }` of every model that asks for GraphQL, ready
 * for `henri.graphql.extract()`.
 *
 * A model that wrote its own gets exactly what it wrote; one that asked
 * henri to generate gets the derived definition, with anything it also
 * wrote merged on top of it.
 *
 * @param {object} henri the henri instance
 * @param {Array<object>} models the model files
 * @returns {Array<{description: object, globalId: string, graphql: object}>} the blocks
 * @throws HENRI_API_GRAPHQL_INVALID_DECLARATION on a `graphql` key henri cannot read
 */
function blocksOf(henri, models) {
  const settings = settingsOf(henri.config);

  return describe(models, henri.config).map((description) => {
    const { declaration } = description;
    const derived = description.generate;
    const types = [derived ? sdlOf(description) : null, declaration.types]
      .filter(Boolean)
      .join('\n');

    return {
      description,
      globalId: description.model,
      graphql: {
        // `{}` rather than null: `Graphql#extract` reads `typeof resolvers
        // === 'object'`, which null satisfies and mergeResolvers does not
        resolvers:
          mergeResolvers(
            derived ? resolversOf(henri, description, settings) : null,
            declaration.resolvers
          ) || {},
        types: types.length > 0 ? types : null,
      },
    };
  });
}

module.exports = {
  KEYS,
  MUTATIONS,
  NAME,
  TYPES,
  blocksOf,
  declarationOf,
  describe,
  encryptionOf,
  invalid,
  lowerFirst,
  mergeResolvers,
  sdlOf,
  upperFirst,
};
