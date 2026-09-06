/**
 * Factories: a valid record with the fields the test does not care about
 * already filled in.
 *
 * A factory lives in `test/factories/<name>.js` and is read the first time a
 * test asks for one. It is a plain object, like a model or a policy:
 *
 *   // test/factories/proposal.js
 *   module.exports = {
 *     attributes: {
 *       abstract: () => 'An abstract, comfortably past the sixty characters.',
 *       eventId: async ({ create }) => (await create('event')).id,
 *       speakerId: async ({ create }) => (await create('user')).id,
 *       title: ({ sequence }) => `A proposal long enough to pass (${sequence})`,
 *       trackId: async ({ attrs, create }) =>
 *         (await create('track', { eventId: await attrs.eventId })).id,
 *     },
 *     traits: {
 *       accepted: { decidedAt: () => new Date(), state: 'accepted' },
 *     },
 *   };
 *
 *   await create('proposal');                        // saved
 *   await create('proposal', 'accepted');            // with the trait
 *   await create('proposal', { title: 'A talk' });   // the test's own value
 *   await createList('proposal', 3, 'accepted');
 *   await build('proposal');                         // the attributes, unsaved
 *
 * Three rules hold the design together:
 *
 * - **What the caller gives is never made.** An override wins over the
 *   definition and the definition's value is not evaluated at all, so
 *   `create('proposal', { speakerId: someone.id })` creates no second user.
 * - **A value is a literal or a function of the build context.** There is no
 *   separate vocabulary for associations, sequences or computed fields: an
 *   association is a function that calls `create`, a sequence is a number on
 *   the context.
 * - **Fields resolve on demand, not in the order they are written.** Reading
 *   `attrs.eventId` from another field's function resolves that field first,
 *   so two fields can share one parent whatever order the keys sit in --
 *   which `sort-keys` decides anyway.
 *
 * A trait is an override object with a name, kept next to the model instead
 * of copied into every test. `accepted` versus `draft` is rarely one field
 * -- an accepted proposal has a `state`, a `submittedAt` and a `decidedAt` --
 * and that is knowledge about the model, not about the test.
 *
 * @module @usehenri/testing/factory
 */

const fs = require('fs');
const path = require('path');

const { notRunning, stamp } = require('./errors');

/** Where an application keeps its factories, relative to its root */
const DIRECTORY = path.join('test', 'factories');

/**
 * How many factories may make one another before it is called a cycle.
 * Depth is the honest signal, not a repeated name: an `after` that makes
 * children of the same kind as its parent is a real pattern.
 */
const MAX_DEPTH = 10;

/** The definitions, by name */
const registry = new Map();

/** How many records each factory has made in this process */
const counters = new Map();

/** The directory the registry was read from, so it is read once */
let loaded = null;

/**
 * A short string of this process's own, so a suite whose workers share one
 * database can keep its unique columns apart:
 * `` email: ({ sequence, uid }) => `speaker-${uid}-${sequence}@example.test` ``
 *
 * @returns {string} four base36 characters
 */
const uid = () => `0000${process.pid.toString(36)}`.slice(-4);

/**
 * The running instance, or a failure naming what is missing
 *
 * @returns {object} the henri instance
 * @throws when nothing booted the application
 */
const running = () => {
  // Lazily, so this module and index.js may require each other
  const { henri } = require('./index.js');

  if (!henri) {
    throw notRunning();
  }

  return henri;
};

/**
 * The models henri exposes as globals, by lowercased name
 *
 * @param {object} henri the running instance
 * @returns {Map<string, string>} lowercased name to global name
 */
const modelNames = (henri) =>
  new Map(
    ((henri.model && henri.model.ids) || []).map((name) => [
      String(name).toLowerCase(),
      name,
    ])
  );

/**
 * Check a definition and put it in the registry
 *
 * Also how a test file declares a factory without a file, which is what a
 * one-off shape and the framework's own suites use. A definition made this
 * way wins over `test/factories/<name>.js`, whatever order they arrive in.
 *
 * @param {string} name the factory name (`create('<name>')`)
 * @param {object} definition `{ after, attributes, model, traits }`
 * @param {string} [source] where it came from, for the error message
 * @returns {object} the definition
 * @throws when the definition cannot be used
 */
const defineFactory = (name, definition, source = 'defineFactory()') => {
  if (typeof name !== 'string' || name.length === 0) {
    throw stamp(
      new Error('@usehenri/testing: a factory needs a name'),
      'HENRI_FACTORY_INVALID'
    );
  }

  // The files first, so a factory declared in a test always wins
  source === 'defineFactory()' && load();

  /**
   * The failure of this definition
   *
   * @param {string} message what is wrong with it
   * @returns {Error} the error to throw
   */
  const invalid = (message) =>
    stamp(
      new Error(
        `@usehenri/testing: the factory '${name}' (${source}) ${message}`
      ),
      'HENRI_FACTORY_INVALID'
    );

  if (!definition || typeof definition !== 'object') {
    throw invalid('exports no object');
  }

  const { after, attributes, model, traits } = definition;

  if (!attributes || typeof attributes !== 'object') {
    throw invalid('has no `attributes` object');
  }

  if (typeof model !== 'undefined' && typeof model !== 'string') {
    throw invalid('has a `model` that is not the name of one');
  }

  if (typeof after !== 'undefined' && typeof after !== 'function') {
    throw invalid('has an `after` that is not a function');
  }

  if (typeof traits !== 'undefined') {
    if (!traits || typeof traits !== 'object') {
      throw invalid('has a `traits` that is not an object');
    }

    for (const [trait, values] of Object.entries(traits)) {
      if (!values || typeof values !== 'object') {
        throw invalid(`declares a trait '${trait}' that is not an object`);
      }
    }
  }

  registry.set(name, { after, attributes, model, name, source, traits });

  return definition;
};

/**
 * Read the factory files of the application
 *
 * @param {string} directory where to look
 * @returns {number} how many were read
 * @throws when a file cannot be loaded or exports nothing usable
 */
const readDirectory = (directory) => {
  if (!fs.existsSync(directory)) {
    return 0;
  }

  const files = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((item) => item.isFile() && item.name.endsWith('.js'))
    .map((item) => item.name)
    .sort();

  for (const file of files) {
    const full = path.join(directory, file);
    let definition;

    try {
      // Read from disk rather than from the cache, the way core loads
      // app/models: a watch run that reloaded the registry wants the file
      delete require.cache[require.resolve(full)];

      definition = require(full);
    } catch (error) {
      throw stamp(
        new Error(
          `@usehenri/testing: unable to load the factory ${full} (${error.message})`,
          { cause: error }
        ),
        'HENRI_FACTORY_INVALID'
      );
    }

    defineFactory(path.basename(file, '.js'), definition, full);
  }

  return files.length;
};

/**
 * Read `test/factories` once, on the first call that needs it
 *
 * @returns {void}
 */
const load = () => {
  const directory = path.resolve(process.cwd(), DIRECTORY);

  if (loaded === directory) {
    return;
  }

  // Marked before the read, because `readDirectory` declares what it finds
  // and would come back here; unmarked again when it fails, so the next
  // call reports the broken file rather than a factory that is missing
  loaded = directory;

  try {
    readDirectory(directory);
  } catch (error) {
    loaded = null;
    throw error;
  }
};

/**
 * The definition of a factory
 *
 * @param {string} name the factory name
 * @returns {object} the definition
 * @throws when nothing declares it
 */
const definitionOf = (name) => {
  load();

  const found = registry.get(name);

  if (found) {
    return found;
  }

  const known = [...registry.keys()].sort();
  const list =
    known.length > 0
      ? `this application has ${known.join(', ')}`
      : `nothing was found in ${DIRECTORY}`;

  throw stamp(
    new Error(
      `@usehenri/testing: there is no factory named '${name}': ${list}`
    ),
    'HENRI_FACTORY_UNKNOWN'
  );
};

/**
 * The model a factory writes to: the one it names, or the one its own name
 * reads as
 *
 * @param {object} definition the definition
 * @param {object} henri the running instance
 * @returns {object} the model
 * @throws when the application has no such model
 */
const modelOf = (definition, henri) => {
  const names = modelNames(henri);
  const wanted = definition.model || definition.name;
  const found = names.get(String(wanted).toLowerCase());
  const model = found && globalThis[found];

  if (!model) {
    const known = [...names.values()].sort().join(', ') || 'none';

    throw stamp(
      new Error(
        `@usehenri/testing: the factory '${definition.name}' (${definition.source}) names the model '${wanted}', which this application does not have (it has ${known}). Name the right one with \`model:\`.`
      ),
      'HENRI_FACTORY_INVALID'
    );
  }

  return model;
};

/**
 * Split `create('proposal', 'accepted', { title })` into its parts. A key
 * whose override is `undefined` says nothing, so an optional value from the
 * test does not turn a default into a null.
 *
 * @param {object} definition the definition
 * @param {Array} args the trait names and override objects, in any order
 * @returns {{overrides: object, traits: Array<string>}} what was asked for
 * @throws when a trait is not declared
 */
const parseArguments = (definition, args) => {
  const overrides = {};
  const traits = [];

  for (const arg of args) {
    if (typeof arg === 'string') {
      const values = definition.traits && definition.traits[arg];

      if (!values) {
        const known = Object.keys(definition.traits || {})
          .sort()
          .join(', ');

        throw stamp(
          new Error(
            `@usehenri/testing: the factory '${definition.name}' has no trait '${arg}'${
              known ? ` (it has ${known})` : ' (it declares none)'
            }`
          ),
          'HENRI_FACTORY_UNKNOWN_TRAIT'
        );
      }

      traits.push(arg);
    } else if (arg && typeof arg === 'object') {
      for (const [field, value] of Object.entries(arg)) {
        typeof value === 'undefined' || (overrides[field] = value);
      }
    } else if (typeof arg !== 'undefined') {
      throw stamp(
        new Error(
          `@usehenri/testing: create('${definition.name}', ...) takes trait names and override objects, not ${typeof arg}`
        ),
        'HENRI_FACTORY_INVALID'
      );
    }
  }

  return { overrides, traits };
};

/**
 * The attributes of a record: the overrides, then whatever the definition
 * and its traits still have to say, each field resolved the first time
 * something reads it
 *
 * @param {string} name the factory name
 * @param {Array} args trait names and override objects
 * @param {Array<string>} chain the factories being made, outermost first
 * @returns {Promise<{context: object, definition: object, values: object}>}
 *   the definition, the attributes and the context the hooks are given
 * @throws when the factories nest too deeply, or two fields need each other
 */
const attributesOf = async (name, args, chain) => {
  const definition = definitionOf(name);

  if (chain.length >= MAX_DEPTH) {
    throw stamp(
      new Error(
        `@usehenri/testing: the factories nested ${chain.length} deep and stopped: ${[
          ...chain,
          name,
        ].join(
          ' -> '
        )}. Give the association an id in the overrides to end the chain.`
      ),
      'HENRI_FACTORY_DEPTH'
    );
  }

  const { overrides, traits } = parseArguments(definition, args);
  const declared = Object.assign(
    {},
    definition.attributes,
    ...traits.map((trait) => definition.traits[trait])
  );
  const values = { ...overrides };
  const resolving = new Set();
  const nested = [...chain, name];
  const has = (target, field) =>
    Object.prototype.hasOwnProperty.call(target, field);

  /**
   * The value of one field, resolved once
   *
   * @param {string} field the field name
   * @returns {Promise<*>} the value
   */
  const resolve = async (field) => {
    if (has(values, field)) {
      return values[field];
    }

    if (resolving.has(field)) {
      throw stamp(
        new Error(
          `@usehenri/testing: the fields of the factory '${name}' need each other: ${[
            ...resolving,
            field,
          ].join(' -> ')}`
        ),
        'HENRI_FACTORY_DEPTH'
      );
    }

    resolving.add(field);

    try {
      const declaration = declared[field];

      values[field] =
        typeof declaration === 'function'
          ? await declaration(context)
          : declaration;
    } finally {
      resolving.delete(field);
    }

    return values[field];
  };

  /**
   * The attributes resolved so far. Reading a field the definition declares
   * and nothing has resolved yet answers a promise of it, so
   * `await attrs.eventId` reads the same either way.
   */
  const attrs = new Proxy(values, {
    /**
     * @param {object} target the resolved attributes
     * @param {string|symbol} field what is being read
     * @returns {*} the value, or a promise of it
     */
    get: (target, field) => {
      if (typeof field !== 'string' || has(target, field)) {
        return target[field];
      }

      return has(declared, field) ? resolve(field) : undefined;
    },
  });
  const context = {
    attrs,
    build: (child, ...rest) => buildIn(child, rest, nested),
    create: (child, ...rest) => createIn(child, rest, nested),
    sequence: (counters.get(name) || 0) + 1,
    traits,
    uid: uid(),
  };

  counters.set(name, context.sequence);

  for (const field of Object.keys(declared)) {
    await resolve(field);
  }

  return { context, definition, values };
};

/**
 * `build()`, carrying the chain of factories it is nested in
 *
 * @param {string} name the factory name
 * @param {Array} args trait names and override objects
 * @param {Array<string>} chain the factories being made
 * @returns {Promise<object>} the attributes
 */
const buildIn = async (name, args, chain) =>
  (await attributesOf(name, args, chain)).values;

/**
 * `create()`, carrying the chain of factories it is nested in
 *
 * @param {string} name the factory name
 * @param {Array} args trait names and override objects
 * @param {Array<string>} chain the factories being made
 * @returns {Promise<object>} the saved record
 */
const createIn = async (name, args, chain) => {
  const henri = running();
  const { context, definition, values } = await attributesOf(name, args, chain);
  const record = await modelOf(definition, henri).create(values);

  if (typeof definition.after !== 'function') {
    return record;
  }

  const answered = await definition.after(record, context);

  return typeof answered === 'undefined' ? record : answered;
};

/**
 * The attributes a valid record would have, without saving one.
 *
 * The associations are still made -- a foreign key has to name a row that
 * exists -- unless the caller gives the field, which is what makes
 * `build('proposal', { speakerId: someone.id })` touch no database at all.
 *
 * @param {string} name the factory name (`test/factories/<name>.js`)
 * @param {...(string|object)} args trait names and override objects
 * @returns {Promise<object>} the attributes
 */
const build = (name, ...args) => buildIn(name, args, []);

/**
 * A saved record
 *
 * @param {string} name the factory name (`test/factories/<name>.js`)
 * @param {...(string|object)} args trait names and override objects
 * @returns {Promise<object>} the record
 */
const create = (name, ...args) => createIn(name, args, []);

/**
 * Several saved records, one after the other so the sequences stay in order
 *
 * @param {string} name the factory name
 * @param {number} count how many
 * @param {...(string|object)} args trait names and override objects
 * @returns {Promise<Array<object>>} the records
 */
const createList = async (name, count, ...args) => {
  const records = [];

  for (let made = 0; made < count; made += 1) {
    records.push(await createIn(name, args, []));
  }

  return records;
};

/**
 * Forget every definition and every sequence.
 *
 * A suite never needs this -- each test file is its own process -- but a file
 * that declares factories of its own starts from a clean slate with it.
 *
 * @returns {void}
 */
const resetFactories = () => {
  registry.clear();
  counters.clear();
  loaded = null;
};

module.exports = {
  DIRECTORY,
  MAX_DEPTH,
  build,
  create,
  createList,
  defineFactory,
  resetFactories,
};
