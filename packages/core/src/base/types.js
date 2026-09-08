/**
 * The declarations of what an application already declared: its models and
 * its path helpers, written as TypeScript an editor and a coding agent can
 * check.
 *
 * henri is JavaScript and stays JavaScript. Nothing here compiles, nothing
 * here runs, and no application gains a build step: this writes one
 * `.d.ts` file into `.henri/`, next to the `globals.json` the linter
 * already reads, and an editor picks it up through the `jsconfig.json`
 * `henri new` writes. It is generated the way that file is -- on every
 * development boot and every hot reload -- so it exists without anybody
 * being told to run a command, and it is gitignored, so it never reaches a
 * diff.
 *
 * ## What it is for
 *
 * A person who renames a column finds out at runtime. An agent that renames
 * a column finds out never: it writes `article.titel`, the page renders
 * `undefined`, and nothing anywhere says so. The same goes for
 * `status === 'published'` on a column whose enum says `live`, and for
 * `pathFor('taks_path')`, which answers `undefined` and links nowhere.
 *
 * Each of those is a compile error once the model file and the routes file
 * are types, and an agent that can typecheck can correct itself. That is
 * the whole argument, and it is why this reads the *declarations* rather
 * than the database: a model file is already a schema, and
 * `config/routes.js` already names every helper.
 *
 * ## What is read, and by whom
 *
 * `base/openapi.js` already walks both of them without booting -- the
 * routes expanded the way the router expands them, the model files with
 * the columns the adapters add -- so this borrows `columnsOf()` and
 * `settingsOf()` from it rather than reading a model a second way. A
 * second traversal that disagreed with the first would be a bug factory,
 * and `src/__tests__/types.spec.js` is what keeps the two reading a model
 * the same.
 *
 * Two callers, one answer: `5.router.js` hands over what the booted
 * application holds, and `henri types` (`packages/cli/scripts/types.js`)
 * hands over what it read off the disk. Same builder, same file.
 *
 * ## What it promises, and what it refuses to
 *
 * A **record** is closed: the columns of the model file plus the ones every
 * adapter adds (`externalId`, the timestamps, `slug`, `deletedAt`, and the
 * user model's own), and nothing else. That is what makes a wrong column
 * name an error, which is the point of the file.
 *
 * A **model** is as closed as its adapter lets it be, which is not the
 * same answer for the three. `ModelGuarantees` is the measured
 * intersection -- `findById`, `findByKey`, `findByExternalId`, `findOne`,
 * `create` and `paginate`, and not `find()`, which a Sequelize model does
 * not have at all -- and each adapter gets an interface of its own on top
 * of it, picked here by the adapter of the model's store the same way the
 * record base already is.
 *
 * Two of those three stay open. A Mongoose model's statics are Mongoose's
 * (`aggregate`, `insertMany`, `watch`, the `EventEmitter` it inherits) and
 * a Sequelize model's are Sequelize's, at whatever version the application
 * installed: enumerating either would pin someone else's API to a henri
 * release, and an ORM that added one static would turn code that runs into
 * an error. So the index signature stays there, and an honest `any` beats
 * an invented signature -- the same answer `base/openapi.js` gives when it
 * cannot know what an action returns.
 *
 * The third does not. A drizzle model is henri's own class
 * (`@usehenri/drizzle/model.js`), released in lockstep with core, and its
 * statics are the same 83 whatever the model declares -- so
 * `DrizzleModelStatics` lists them and nothing else, which is what makes
 * `Task.fnid()` an error on the adapter `henri new` scaffolds by default.
 * The names it lists are also the names `base/enums.js` refuses a scope to
 * claim, so a model that would collide with one of them fails the boot
 * rather than reaching this file.
 *
 * What the record type is *not* is a promise that the value is there: a
 * column henri cannot type (a nested schema, a Mongoose `ObjectId`, a
 * constructor it does not know) is `any`, said once here rather than
 * guessed.
 *
 * ## What it refuses to write
 *
 * A generated file that does not parse is worse than no file: it turns
 * every other declaration in the project off. So this skips rather than
 * guesses. A model whose name is not a TypeScript identifier, a model that
 * is not an object, a column name that cannot be quoted -- each is left
 * out and named in `skipped`, which `henri types` prints and `henri
 * doctor` reports. The routes are the same: a routes file that will not
 * expand leaves `HenriPaths` empty, and an empty registry means
 * `pathFor()` takes any string again, which is exactly where an
 * application was before.
 *
 * ## How this relates to the hand-written declarations
 *
 * They are different files for different consumers and they do not
 * compete. `packages/core/index.d.ts` and the one `.d.ts` per package
 * describe *henri* -- `res.render()`, the configuration, the controller
 * shape -- are hand-written, shipped by npm and checked by
 * `pnpm test:types`. This describes *an application* -- its models, its
 * routes -- is generated, never published, and typechecked in this
 * repository through a fixture (`types/generated.d.ts`) that is the real
 * output of this builder. The generated file *uses* the hand-written ones:
 * `ModelStatics`, `ModelQuery` and the three record bases live in
 * `index.d.ts`, so a signature that changes changes in one place.
 *
 * @module types
 */
const crypto = require('crypto');

const { columnsOf, settingsOf } = require('./openapi');
const { enumsOf } = require('./enums');
const { SLUG } = require('./slug');

/**
 * The format of the file. The marker at the end carries it, so `henri
 * doctor` can tell a file this version wrote from one an older henri did.
 */
const FORMAT = 2;

/** Where the file goes, relative to the application */
const FILE = '.henri/types.d.ts';

/** The comment that opens the marker line */
const MARKER = '// henri:types';

/**
 * The model API of every adapter core can load.
 *
 * `packages/cli/scripts/adapters.js` holds the same mapping for the
 * generators, and `src/__tests__/types.spec.js` compares the two: an
 * adapter added to one has to be added to the other.
 */
const APIS = {
  disk: 'mongoose',
  drizzle: 'drizzle',
  mariadb: 'drizzle',
  mongoose: 'mongoose',
  mssql: 'sequelize',
  mysql: 'drizzle',
  postgresql: 'drizzle',
};

/**
 * The record interface of each model API, declared by hand in
 * `packages/core/index.d.ts`. A store whose adapter is not one of these
 * gets `RecordBase`, which is what the three have in common.
 */
const RECORDS = {
  drizzle: 'DrizzleRecord',
  mongoose: 'MongooseRecord',
  sequelize: 'SequelizeRecord',
};

/**
 * The statics interface of each model API, declared by hand next to the
 * record ones. A store whose adapter is not one of these gets
 * `ModelStatics`, which is the measured intersection of the three plus an
 * index signature.
 *
 * The split is what lets each one say what its adapter answers rather than
 * what the loosest of the three does: a Sequelize model has no `find()` at
 * all, a Mongoose `find()` chains, and a Drizzle `find()` is a plain
 * promise whose `.sort()` is a `TypeError`. `DrizzleModelStatics` is also
 * the one that is *closed* -- that class is henri's own, so `Task.fnid()`
 * is an error there and stays an `any` on the two adapters whose surface
 * belongs to an ORM.
 */
const STATICS = {
  drizzle: 'DrizzleModelStatics',
  mongoose: 'MongooseModelStatics',
  sequelize: 'SequelizeModelStatics',
};

/**
 * The declarations the file borrows from `@usehenri/core`, aliased once at
 * the top.
 *
 * `interface X extends import('...').Y` is not a thing TypeScript accepts
 * -- an interface extends an identifier -- so the import type is written
 * once as an alias and the interfaces extend the alias.
 */
const BORROWED = [
  { generic: true, name: 'ModelQuery' },
  { generic: true, name: 'ModelStatics' },
  { generic: true, name: 'DrizzleModelStatics' },
  { generic: true, name: 'MongooseModelStatics' },
  { generic: true, name: 'SequelizeModelStatics' },
  { generic: false, name: 'RecordBase' },
  { generic: false, name: 'DrizzleRecord' },
  { generic: false, name: 'MongooseRecord' },
  { generic: false, name: 'SequelizeRecord' },
];

/**
 * What a henri type is once it is a JavaScript value.
 *
 * `decimal` and `bigint` are strings, and that is the truth rather than a
 * looser version of it: both cross the boundary as decimal strings on
 * every adapter, because a double cannot carry either (`base/exact.js`).
 * `json` is `any`: a JSON column holds whatever the application put in it,
 * and `unknown` would make reading it back a cast in a language that has
 * no casts.
 */
const TYPES = {
  bigint: 'string',
  boolean: 'boolean',
  date: 'Date',
  decimal: 'string',
  float: 'number',
  integer: 'number',
  json: 'any',
  number: 'number',
  string: 'string',
  text: 'string',
  uuid: 'string',
};

/** What a constructor in a schema means (`title: String`) */
const CONSTRUCTORS = {
  Boolean: 'boolean',
  Date: 'Date',
  Number: 'number',
  String: 'string',
};

/** A name TypeScript reads as an identifier */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A name that may be an interface of its own (`Article` -> `ArticleRecord`) */
const TYPE_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * A plain object, and nothing else
 *
 * @param {*} value anything
 * @returns {boolean} true for a plain object
 */
function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The model API behind an adapter name
 *
 * @param {*} adapter the `adapter` of a store
 * @returns {?string} `mongoose`, `sequelize`, `drizzle`, or null
 */
function apiOf(adapter) {
  return APIS[String(adapter || '').toLowerCase()] || null;
}

/**
 * The adapter of every store, by store name
 *
 * @param {*} config the configuration, or a plain object
 * @returns {object} `{ default: 'disk' }`
 */
function storesOf(config) {
  const read =
    config && typeof config.get === 'function'
      ? config.get('stores')
      : config && config.stores;
  const out = {};

  for (const [name, store] of Object.entries(isObject(read) ? read : {})) {
    out[name] = isObject(store) ? String(store.adapter || '') : '';
  }

  return out;
}

/**
 * A value written back as a TypeScript literal, for an enum union
 *
 * @param {*} value one value of an `enum`
 * @returns {?string} the literal, or null when it cannot be one
 */
function literalOf(value) {
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

/**
 * The union of an `enum`, when every value can be written as a literal.
 *
 * One value that cannot be is enough to give the union up: a partial union
 * would refuse a value the column accepts, which is a wrong answer rather
 * than a missing one.
 *
 * @param {*} values what the field declares as its `enum`
 * @returns {?string} the union, or null
 */
function unionOf(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const written = values.map(literalOf);

  return written.every(Boolean) ? [...new Set(written)].join(' | ') : null;
}

/**
 * The type of a field that is not an object: a name, a constructor, a list
 *
 * @param {*} type what the field says it is
 * @returns {string} the TypeScript type
 */
function scalarOf(type) {
  if (typeof type === 'string') {
    return TYPES[type] || 'any';
  }

  if (typeof type === 'function') {
    return CONSTRUCTORS[type.name] || 'any';
  }

  return 'any';
}

/**
 * The type of one column
 *
 * @param {*} field a field definition
 * @returns {string} the TypeScript type
 */
function typeOf(field) {
  if (!isObject(field)) {
    return Array.isArray(field) ? 'any[]' : scalarOf(field);
  }

  const union = unionOf(field.enum);

  if (union) {
    return union;
  }

  if (Array.isArray(field.type)) {
    return 'any[]';
  }

  // A nested schema (`{ street: 'string' }`) has no `type` of its own: it
  // is an object henri hands to the adapter as it is
  return isObject(field.type) ? 'any' : scalarOf(field.type);
}

/**
 * Can this column hold null?
 *
 * A column the model requires cannot, and neither can one with a default:
 * the row always has a value, whatever the request left out. Everything
 * else can, and saying so is what makes a page reading it decide.
 *
 * @param {*} field a field definition
 * @returns {boolean} true when the value may be null
 */
function nullableOf(field) {
  if (!isObject(field)) {
    return true;
  }

  if (field.required === true) {
    return false;
  }

  return (
    typeof field.default === 'undefined' ||
    field.default === null ||
    field.default === ''
  );
}

/**
 * The sentence describing one column, for an editor to show on hover
 *
 * @param {string} name the column name
 * @param {*} field the field definition
 * @param {object} context `{ reference, user }`
 * @returns {string} the description
 */
function documentOf(name, field, { reference, user }) {
  const parts = [];
  const definition = isObject(field) ? field : {};

  if (name === 'externalId') {
    parts.push(
      'The public identifier: the only one that leaves the server. `findById()` takes it.'
    );
  }

  if (name === SLUG) {
    parts.push(
      'The name every url of this record carries, written by henri (`options.slug`).'
    );
  }

  if (name === 'deletedAt') {
    parts.push('The soft delete stamp (`options.paranoid`).');
  }

  if (user && (name === 'password' || name === 'roles')) {
    parts.push(
      name === 'password'
        ? 'Hashed, and not selected by default: a record read the usual way does not carry it.'
        : 'Stripped from mass assignment: `setRoles()` or `{ unsafe: true }` writes it.'
    );
  }

  if (reference) {
    parts.push(
      `A declared reference to ${reference}: the column holds that row's key, and what leaves the server is its externalId.`
    );
  }

  if (definition.unique === true) {
    parts.push('Unique.');
  }

  if (definition.encrypted) {
    parts.push('Encrypted at rest; the model hands back the string.');
  }

  if (isObject(definition.personal) && definition.personal.expose === false) {
    parts.push(
      'Personal, and never in an answer henri builds -- it is on the record all the same.'
    );
  } else if (definition.personal) {
    parts.push('Personal: exported, erased and masked in the logs.');
  }

  return parts.join(' ');
}

/**
 * The model a column points at, when it declares one. henri reads no field
 * name for this (see `base/references.js`), and neither does this.
 *
 * @param {*} field a field definition
 * @returns {?string} the model name, or null
 */
function referenceOf(field) {
  if (!isObject(field)) {
    return null;
  }

  if (typeof field.ref === 'string' && field.ref.length > 0) {
    return field.ref;
  }

  const model = isObject(field.references) ? field.references.model : null;

  return typeof model === 'string' && model.length > 0 ? model : null;
}

/**
 * A property name, quoted when TypeScript will not read it as one
 *
 * @param {string} name the column name
 * @returns {?string} the property name, or null when it cannot be written
 */
function propertyOf(name) {
  if (IDENTIFIER.test(name)) {
    return name;
  }

  // Anything else is a quoted property, which is what a namespaced helper
  // needs (`index_admin/tasks_path`). A quote, a backslash or a control
  // character in a name is not worth guessing at
  // eslint-disable-next-line no-control-regex
  return /^[^'\\\r\n\u0000-\u001f]+$/.test(name) ? `'${name}'` : null;
}

/**
 * The columns of one model, described
 *
 * @param {object} model a model file
 * @param {object} settings what `settingsOf()` read from the configuration
 * @param {boolean} user is this the user model?
 * @returns {{columns: Array<object>, dropped: Array<string>}} the columns
 */
function columnsFor(model, settings, user) {
  const fields = columnsOf(model, settings);
  const columns = [];
  const dropped = [];

  for (const name of Object.keys(fields).sort()) {
    const property = propertyOf(name);

    if (!property) {
      dropped.push(name);
      continue;
    }

    const field = fields[name];
    const reference = referenceOf(field);

    const type = typeOf(field);

    columns.push({
      documentation: documentOf(name, field, { reference, user }),
      name: property,
      // A column the adapter does not select is not on a record it read
      optional: isObject(field) && field.select === false,
      // `any | null` is `any`: a column henri cannot type says nothing
      // about null either
      type: type !== 'any' && nullableOf(field) ? `${type} | null` : type,
    });
  }

  return { columns, dropped };
}

/**
 * The enum methods of one model, as `base/enums.js` generates them
 *
 * @param {object} model a model file
 * @returns {Array<object>} `[{ field, methods, values }]`
 */
function enumsFor(model) {
  try {
    return enumsOf(model) || [];
  } catch {
    // A declaration henri cannot carry out fails the boot; here it is one
    // more thing this file could not read
    return [];
  }
}

/**
 * Every model this file can describe, and every one it cannot
 *
 * @param {object} options `{ config, models }`
 * @returns {{described: Array<object>, skipped: Array<object>}} the models
 */
function modelsOf({ config, models }) {
  const settings = settingsOf(config);
  const stores = storesOf(config);
  const described = [];
  const skipped = [];
  const wanted = String(settings.user.model || '').toLowerCase();

  for (const model of Array.isArray(models) ? models : []) {
    if (!isObject(model)) {
      skipped.push({ name: 'a model file', why: 'it is not an object' });
      continue;
    }

    const name = String(model.globalId || model.identity || '');

    if (!TYPE_NAME.test(name)) {
      skipped.push({
        name: name || 'a model file',
        why: 'its name is not a TypeScript identifier',
      });
      continue;
    }

    if (!isObject(model.schema)) {
      skipped.push({ name, why: 'it declares no schema' });
      continue;
    }

    const store = String(model.store || 'default');
    const user = String(model.identity || '').toLowerCase() === wanted;
    const { columns, dropped } = columnsFor(model, settings, user);
    const options = isObject(model.options) ? model.options : {};

    for (const column of dropped) {
      skipped.push({
        name: `${name}.${column}`,
        why: 'its name cannot be written as a property',
      });
    }

    described.push({
      adapter: stores[store] || null,
      api: apiOf(stores[store]),
      columns,
      enums: enumsFor(model),
      name,
      paranoid: options.paranoid === true,
      slug: Boolean(options.slug),
      store,
      user,
    });
  }

  return { described: described.sort(byName), skipped };
}

/**
 * Sorts two described things by name
 *
 * @param {object} one the first
 * @param {object} two the second
 * @returns {number} the order
 */
function byName(one, two) {
  return one.name < two.name ? -1 : Number(one.name > two.name);
}

/**
 * Every path helper the routes expand to, once each
 *
 * @param {Array<object>} routes the expanded routes (see `base/routes.js`)
 * @returns {Array<object>} `[{ controller, name, route, verb }]`
 */
function pathsOf(routes) {
  const seen = new Map();

  for (const route of Array.isArray(routes) ? routes : []) {
    // A namespaced route's helper carries the namespace and its slash
    // (`index_admin/tasks_path`), which is a property and not an identifier
    const property = isObject(route)
      ? propertyOf(String(route.path || ''))
      : null;

    if (!property) {
      continue;
    }

    // A helper names one route: the last one registered under it wins, the
    // way the router's own table does
    seen.set(property, {
      controller: String(route.controller || ''),
      name: property,
      route: String(route.route || ''),
      verb: String(route.verb || 'get').toUpperCase(),
    });
  }

  return [...seen.values()].sort(byName);
}

/**
 * What an application declares, read from its model files, its expanded
 * routes and its configuration.
 *
 * `skipped` is what the caller already could not read -- a model directory
 * that would not load, a routes file with a syntax error -- and it is part
 * of the description rather than a note beside it, because the digest of
 * the description is what `henri doctor` compares: a file written while a
 * model was broken has to stop matching once it is fixed.
 *
 * @param {object} options `{ config, models, routes, skipped }`
 * @returns {object} the description
 */
function describe({
  config = {},
  models = [],
  routes = [],
  skipped = [],
} = {}) {
  const described = modelsOf({ config, models });

  return {
    format: FORMAT,
    models: described.described,
    paths: pathsOf(routes),
    skipped: [...skipped, ...described.skipped],
  };
}

/**
 * A JSDoc block, indented, or nothing at all
 *
 * @param {string} text the sentence
 * @param {string} [indent=''] what to put in front of every line
 * @returns {string} the comment, with its newline, or an empty string
 */
function comment(text, indent = '') {
  return text ? `${indent}/** ${text} */\n` : '';
}

/**
 * The record interface of one model
 *
 * @param {object} model one described model
 * @returns {string} the source
 */
function recordOf(model) {
  const base = `Henri${RECORDS[model.api] || 'RecordBase'}`;
  const lines = [
    `/** A ${model.name} record, as the ${model.store} store hands it back. */`,
    `interface ${model.name}Record extends ${base} {`,
  ];

  for (const column of model.columns) {
    lines.push(
      `${comment(column.documentation, '  ')}  ${column.name}${
        column.optional ? '?' : ''
      }: ${column.type};`
    );
  }

  for (const { field, methods } of model.enums) {
    for (const { predicate, value } of methods) {
      lines.push(
        `  /** \`${field} === ${JSON.stringify(value)}\` */`,
        `  ${predicate}(): boolean;`
      );
    }
  }

  if (model.paranoid) {
    lines.push(
      '  /** Brings a soft-deleted record back (`options.paranoid`). */',
      '  restore(): Promise<any>;'
    );
  }

  if (model.user) {
    lines.push(
      '  /** Does this user hold every one of these roles? */',
      '  hasRole(roles?: string | string[]): Promise<boolean>;',
      '  /** The one write that may set `roles`. */',
      '  setRoles(roles: string | string[]): Promise<any>;'
    );
  }

  lines.push('}');

  return lines.join('\n');
}

/**
 * The statics interface of one model
 *
 * @param {object} model one described model
 * @returns {string} the source
 */
function staticsOf(model) {
  const record = `${model.name}Record`;
  const base = `Henri${STATICS[model.api] || 'ModelStatics'}`;
  const opening = `interface ${model.name}Model extends ${base}<${record}> {`;
  const lines = [
    `/** The \`${model.name}\` model: a global in every file of this application. */`,
    // Where prettier would break it, break it in the same place
    ...(opening.length > 80
      ? [`interface ${model.name}Model`, `  extends ${base}<${record}> {`]
      : [opening]),
  ];

  const opened = lines.length;

  if (model.slug) {
    lines.push(
      '  /** The record of a slug (`options.slug`), or null. */',
      `  findBySlug(slug: string, ...args: any[]): HenriModelQuery<${record} | null>;`
    );
  }

  if (model.enums.length > 0) {
    lines.push('  /** The values every enum column of this model accepts. */');
    lines.push('  enums: {');

    for (const { field, values } of model.enums) {
      const property = propertyOf(field);
      const union = unionOf(values);

      property &&
        lines.push(`    ${property}: readonly (${union || 'any'})[];`);
    }

    lines.push('  };');
  }

  for (const { field, methods } of model.enums) {
    for (const { scope, value } of methods) {
      lines.push(
        `  /** \`{ ${field}: ${JSON.stringify(value)} }\`, intersected with what it is given. */`,
        `  ${scope}(where?: Record<string, any>): Record<string, any>;`
      );
    }
  }

  if (model.user) {
    lines.push(
      '  /** The one write that may set `roles`. */',
      `  setRoles(id: any, roles: string | string[]): Promise<${record} | null>;`
    );
  }

  if (lines.length === opened) {
    // Nothing but what every model has: say so on the line that opened it
    lines[opened - 1] = `${lines[opened - 1]}}`;
  } else {
    lines.push('}');
  }

  lines.push('', `declare const ${model.name}: ${model.name}Model;`);

  return lines.join('\n');
}

/**
 * The registry of path helpers: every name `config/routes.js` expands to.
 *
 * The interface is declared empty by `@usehenri/core`, which is what makes
 * `pathFor()` take any string in an application that has never generated
 * this file. Filling it in is what turns a helper name into a union.
 *
 * @param {Array<object>} paths the described helpers
 * @returns {string} the source
 */
function pathsSource(paths) {
  if (paths.length === 0) {
    return '';
  }

  const lines = [
    '// --- the path helpers -------------------------------------------------',
    '',
    '/**',
    ' * Every path helper `config/routes.js` expands to. The keys are what',
    ' * matters: they are the union `pathFor()` and `getRoute()` take, so a',
    ' * helper that does not exist is a compile error rather than a link that',
    ' * goes nowhere.',
    ' */',
    'interface HenriPaths {',
  ];

  for (const path of paths) {
    lines.push(
      `  /** \`${path.verb} ${path.route}\` -> ${path.controller} */`,
      `  ${path.name}: true;`
    );
  }

  lines.push('}');

  return lines.join('\n');
}

/**
 * The digest a marker carries: what the application was when this was
 * written, so `henri doctor` can tell a stale file from a current one
 *
 * @param {object} description what `describe()` read
 * @returns {string} twelve hex characters
 */
function stampOf(description) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(description), 'utf8')
    .digest('hex')
    .slice(0, 12);
}

/**
 * The marker of a generated file, read back
 *
 * @param {string} source the content of `.henri/types.d.ts`
 * @returns {?{app: string, format: number}} what it claims, or null
 */
function markerOf(source) {
  const match = new RegExp(`^${MARKER} (\\d+) app=([0-9a-f]+)$`, 'm').exec(
    String(source || '')
  );

  return match ? { app: match[2], format: Number(match[1]) } : null;
}

/**
 * The header of the file: what it is, who wrote it and how to use it
 *
 * @param {object} description what `describe()` read
 * @returns {string} the source
 */
function header(description) {
  const models = description.models.length;
  const paths = description.paths.length;

  return [
    '// The models and the path helpers of this application, as types.',
    '//',
    '// Generated by henri -- `henri types`, every development boot and every',
    '// hot reload write it -- from `app/models` and `config/routes.js`. It is',
    '// gitignored and safe to delete: nothing reads it at runtime.',
    '//',
    `// ${models} model${models === 1 ? '' : 's'}, ${paths} path helper${
      paths === 1 ? '' : 's'
    }.`,
    '//',
    '// A record carries exactly the columns of its model file plus the ones',
    '// henri adds, so a wrong column name is an error. A model carries what',
    '// the adapter of its store answers: closed on a drizzle store, where',
    '// the model class belongs to henri, and open on the two where it',
    '// belongs to an ORM at whatever version this application installed.',
    '//',
    '// An editor reads it through `jsconfig.json`. Errors are opt-in: add',
    '// `// @ts-check` at the top of a file, or turn `checkJs` on for the',
    '// whole application. See https://usehenri.io/reference/types/',
  ].join('\n');
}

/**
 * The aliases the interfaces below extend, taken from the hand-written
 * declarations of `@usehenri/core`
 *
 * @returns {string} the source
 */
function preamble(models) {
  const used = new Set();

  for (const model of models) {
    used.add(RECORDS[model.api] || 'RecordBase');
    used.add(STATICS[model.api] || 'ModelStatics');
    model.slug && used.add('ModelQuery');
  }

  if (used.size === 0) {
    return '';
  }

  const lines = [
    '// What the interfaces below are built on: the declarations',
    '// `@usehenri/core` ships by hand, aliased here because an interface',
    '// extends a name and not an import type.',
  ];

  for (const { generic, name } of BORROWED.filter(({ name }) =>
    used.has(name)
  )) {
    lines.push(
      generic
        ? `type Henri${name}<T> = import('@usehenri/core').${name}<T>;`
        : `type Henri${name} = import('@usehenri/core').${name};`
    );
  }

  return lines.join('\n');
}

/**
 * The file, from what `describe()` read
 *
 * @param {object} description what `describe()` read
 * @returns {string} the content of `.henri/types.d.ts`
 */
function render(description) {
  const blocks = [header(description), preamble(description.models)].filter(
    Boolean
  );

  for (const model of description.models) {
    blocks.push(
      `// --- ${model.name} ${'-'.repeat(Math.max(0, 66 - model.name.length))}`,
      recordOf(model),
      staticsOf(model)
    );
  }

  const paths = pathsSource(description.paths);

  paths && blocks.push(paths);

  blocks.push(`${MARKER} ${FORMAT} app=${stampOf(description)}`);

  return `${blocks.join('\n\n')}\n`;
}

/**
 * What an application declares, and the file that says so
 *
 * @param {object} options `{ config, models, routes }`
 * @returns {{description: object, source: string}} both
 */
function build(options) {
  const description = describe(options);

  return { description, source: render(description) };
}

module.exports = {
  APIS,
  FILE,
  FORMAT,
  MARKER,
  RECORDS,
  STATICS,
  TYPES,
  build,
  describe,
  markerOf,
  render,
  stampOf,
};
