/**
 * The gate every configuration value goes through.
 *
 * `config-schema.js` says what henri accepts; this walks it and answers with
 * every problem it found, never only the first: somebody fixing a
 * configuration file should not discover its faults one boot at a time.
 *
 * A problem is `{ key, level, message, expected, received, source, hint }`.
 * `error` fails the boot, `warning` never does -- an application may carry
 * keys of its own, and `henri.config.get()` is how it reads them -- but a
 * key that misspells one henri owns says so and names the right one.
 *
 * Values are never printed blindly: a key the configuration filters
 * (`filterParameters`) and anything the credentials provided show up as
 * their type alone, and the password of a connection string is always
 * masked. `mask` in the options decides, key by key.
 */

const { MASK } = require('./redact');
const { SCHEMA } = require('./config-schema');

/** Longest string printed back in a message before it is cut */
const MAX_LENGTH = 48;

/** `scheme://user:password@host` -> `scheme://user:[FILTERED]@host` */
const CREDENTIALS_IN_URL = /^([a-z][a-z0-9+.-]*:\/\/[^:@/\s]+):[^@\s/]*@/iu;

/**
 * Split a configuration key into path segments
 *
 * @param {string} key the key (`stores.default.adapter`)
 * @returns {Array<string>} the segments
 */
const segments = (key) =>
  String(key)
    .split(/[.[\]]/u)
    .filter((part) => part.length > 0);

/**
 * How far apart two names are (Levenshtein)
 *
 * @param {string} from the first name
 * @param {string} to the second name
 * @returns {number} the number of edits between them
 */
function distance(from, to) {
  let previous = Array.from({ length: to.length + 1 }, (value, index) => index);

  for (let row = 1; row <= from.length; row++) {
    const current = [row];

    for (let col = 1; col <= to.length; col++) {
      current[col] = Math.min(
        previous[col] + 1,
        current[col - 1] + 1,
        previous[col - 1] + (from[row - 1] === to[col - 1] ? 0 : 1)
      );
    }

    previous = current;
  }

  return previous[to.length];
}

/**
 * How wrong a name may be and still count as a misspelling of another
 *
 * @param {number} length the length of the name
 * @returns {number} the largest distance that still suggests something
 */
function tolerance(length) {
  if (length <= 4) {
    return 1;
  }

  return length <= 8 ? 2 : 3;
}

/**
 * The declared name an unknown one is probably a misspelling of
 *
 * A name that only has the case wrong always matches: the segments of
 * `HENRI_CONFIG__<key>` are case sensitive, so `trustproxy` is the mistake
 * people actually make.
 *
 * @param {string} name the unknown name
 * @param {Array<string>} known the declared names
 * @returns {?string} the closest one, or null when nothing is close
 */
function nearest(name, known) {
  const lowered = name.toLowerCase();
  const cased = known.find((candidate) => candidate.toLowerCase() === lowered);

  if (cased) {
    return cased;
  }

  const limit = tolerance(name.length);
  let best = null;
  let score = Infinity;

  for (const candidate of known) {
    const found = distance(lowered, candidate.toLowerCase());

    if (found <= limit && found < score) {
      best = candidate;
      score = found;
    }
  }

  return best;
}

/**
 * A value, ready to be printed back in a message
 *
 * @param {any} value the value
 * @param {boolean} [masked=false] print its type only
 * @returns {string} what to print
 */
function received(value, masked = false) {
  if (typeof value === 'undefined') {
    return 'missing';
  }

  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return 'an empty list';
    }

    return `a list of ${value.length} item${value.length === 1 ? '' : 's'}`;
  }

  if (typeof value === 'object') {
    return 'an object';
  }

  if (masked) {
    return `a ${typeof value}`;
  }

  if (typeof value === 'string') {
    const safe = value.replace(CREDENTIALS_IN_URL, `$1:${MASK}@`);
    const cut =
      safe.length > MAX_LENGTH ? `${safe.slice(0, MAX_LENGTH)}...` : safe;

    return `the string "${cut}"`;
  }

  return `the ${typeof value} ${String(value)}`;
}

/**
 * What a node accepts, in words
 *
 * @param {object} node a schema node
 * @returns {string} the expectation ("a whole number between 1 and 65535")
 */
function describe(node) {
  if (node.describe) {
    return node.describe;
  }

  if (Object.prototype.hasOwnProperty.call(node, 'const')) {
    return JSON.stringify(node.const);
  }

  if (node.oneOf) {
    return node.oneOf.map(describe).join(', or ');
  }

  if (node.enum) {
    return `one of ${node.enum.join(', ')}`;
  }

  const words = {
    any: 'anything',
    array: 'a list',
    boolean: 'true or false',
    number: 'a number',
    object: 'an object',
    record: 'an object',
    string: 'a string',
  };

  return words[node.type] || 'a valid value';
}

/**
 * Does a value match a node? (no message, used to pick a branch of `oneOf`)
 *
 * @param {object} node a schema node
 * @param {any} value the value
 * @returns {boolean} matching or not
 */
function matches(node, value) {
  const problems = [];

  walk(node, value, '', { mask: () => false, problems, source: () => null });

  return problems.every((problem) => problem.level !== 'error');
}

/**
 * Is a value of the kind a node stands for? (a boolean for `boolean`, an
 * object for `object`), whatever its content
 *
 * @param {object} node a schema node
 * @param {any} value the value
 * @returns {boolean} the right kind or not
 */
function accepts(node, value) {
  if (Object.prototype.hasOwnProperty.call(node, 'const')) {
    return value === node.const;
  }

  if (node.oneOf) {
    return node.oneOf.some((branch) => accepts(branch, value));
  }

  if (node.type === 'array') {
    return Array.isArray(value);
  }

  if (node.type === 'object' || node.type === 'record') {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  return node.type === 'any' || typeof value === node.type;
}

/**
 * The branch of a union a value belongs to
 *
 * The one it fully matches, or else the one it is the right kind for --
 * `rateLimit: { max: "lots" }` is the object branch, and the message then
 * names `rateLimit.max` rather than saying the whole key is wrong.
 *
 * @param {object} node a union node (`oneOf`)
 * @param {any} value the value
 * @returns {?object} the branch, or null when the value fits none
 */
function branchFor(node, value) {
  return (
    node.oneOf.find((branch) => matches(branch, value)) ||
    node.oneOf.find((branch) => accepts(branch, value)) ||
    null
  );
}

/**
 * Check a number against its constraints
 *
 * @param {object} node a schema node
 * @param {number} value the value
 * @returns {boolean} valid or not
 */
function validNumber(node, value) {
  if (!Number.isFinite(value)) {
    return false;
  }

  if (node.integer && !Number.isInteger(value)) {
    return false;
  }

  if (typeof node.above === 'number' && value <= node.above) {
    return false;
  }

  if (typeof node.min === 'number' && value < node.min) {
    return false;
  }

  return !(typeof node.max === 'number' && value > node.max);
}

/**
 * Check a string against its constraints
 *
 * @param {object} node a schema node
 * @param {string} value the value
 * @returns {boolean} valid or not
 */
function validString(node, value) {
  if (typeof value !== 'string') {
    return false;
  }

  if (node.enum) {
    const list = node.insensitive
      ? node.enum.map((entry) => entry.toLowerCase())
      : node.enum;

    return list.includes(node.insensitive ? value.toLowerCase() : value);
  }

  return !(node.pattern && !node.pattern.test(value));
}

/**
 * Walk a node and collect the problems of a value
 *
 * @param {object} node a schema node
 * @param {any} value the value at that key
 * @param {string} key the configuration key (`stores.default.url`)
 * @param {object} context `{ problems, mask, source }`
 * @returns {void}
 */
function walk(node, value, key, context) {
  const report = (level, message, extra = {}) =>
    context.problems.push({
      expected: describe(node),
      hint: node.hint || null,
      key,
      level,
      message,
      received: received(value, context.mask(key)),
      source: context.source(key),
      ...extra,
    });
  const wrong = () =>
    report(
      'error',
      `"${key}" must be ${describe(node)}, but it is ${received(value, context.mask(key))}`
    );

  if (typeof value === 'undefined') {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(node, 'const')) {
    if (value !== node.const) {
      wrong();
    }

    return;
  }

  if (node.oneOf) {
    const branch = branchFor(node, value);

    if (!branch) {
      wrong();

      return;
    }

    walk({ ...branch, hint: branch.hint || node.hint }, value, key, context);

    return;
  }

  switch (node.type) {
    case 'any':
      return;

    case 'boolean':
      if (typeof value !== 'boolean') {
        wrong();
      }

      return;

    case 'number':
      if (!validNumber(node, value)) {
        wrong();
      }

      return;

    case 'string':
      if (!validString(node, value)) {
        wrong();
      }

      return;

    case 'array':
      if (!Array.isArray(value)) {
        wrong();

        return;
      }

      value.forEach((entry, index) =>
        walk(node.of, entry, `${key}[${index}]`, context)
      );

      return;

    case 'record':
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        wrong();

        return;
      }

      for (const [name, entry] of Object.entries(value)) {
        walk(node.values, entry, `${key}.${name}`, context);
      }

      return;

    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        wrong();

        return;
      }

      shape(node, value, key, context);

      return;

    default:
      return;
  }
}

/**
 * Check the keys of an object node: the declared ones against their node,
 * the required ones for their presence, the rest against `unknown`
 *
 * @param {object} node an object node
 * @param {object} value the object
 * @param {string} key the configuration key ('' at the root)
 * @param {object} context `{ problems, mask, source }`
 * @returns {void}
 */
function shape(node, value, key, context) {
  const keys = node.keys || {};
  const known = Object.keys(keys);
  const prefix = key === '' ? '' : `${key}.`;
  const unknown = node.unknown || (node.keys ? 'warn' : 'allow');

  for (const [name, child] of Object.entries(keys)) {
    const path = `${prefix}${name}`;

    if (typeof value[name] === 'undefined') {
      if (child.required) {
        context.problems.push({
          expected: describe(child),
          hint: child.hint || null,
          key: path,
          level: 'error',
          message: `"${path}" is missing and must be ${describe(child)}`,
          received: 'missing',
          source: context.source(key === '' ? name : key),
        });
      }

      continue;
    }

    walk(child, value[name], path, context);
  }

  if (unknown === 'allow') {
    return;
  }

  for (const name of Object.keys(value)) {
    if (Object.prototype.hasOwnProperty.call(keys, name)) {
      continue;
    }

    const path = `${prefix}${name}`;
    const suggestion = nearest(name, known);

    if (!suggestion && unknown === 'near') {
      continue;
    }

    context.problems.push({
      expected: null,
      hint: suggestion
        ? `Rename it to "${prefix}${suggestion}", or remove it`
        : 'henri ignores it; remove it, or keep it if the application reads it with henri.config.get()',
      key: path,
      level: 'warning',
      message: suggestion
        ? `"${path}" is not a henri configuration key: did you mean "${prefix}${suggestion}"?`
        : `"${path}" is not a henri configuration key`,
      received: received(value[name], context.mask(path)),
      source: context.source(path),
    });
  }
}

/**
 * The checks that need more than one key
 *
 * @param {object} config the configuration
 * @param {object} context `{ problems, mask, source }`
 * @returns {void}
 */
function related(config, context) {
  const renderer = String(config.renderer || '').toLowerCase();
  const experimental = config.experimental || {};

  if (renderer === 'vue' && experimental.vue !== true) {
    context.problems.push({
      expected: '{ "experimental": { "vue": true } }',
      hint: 'The vue renderer has not been exercised since 2020: prefer react, inertia or template',
      key: 'renderer',
      level: 'error',
      message:
        '"renderer" is "vue", which only loads with { "experimental": { "vue": true } }',
      received: 'the string "vue"',
      source: context.source('renderer'),
    });
  }
}

/**
 * Validate a configuration against the schema
 *
 * @param {object} config the configuration, after the credentials and the
 *   environment have been applied
 * @param {object} [options] options
 * @param {object} [options.schema=SCHEMA] the schema to validate against
 * @param {function} [options.source] `(key) => string`, where a value came
 *   from (a file name, a credentials file, an environment variable)
 * @param {function} [options.mask] `(key) => boolean`, true to print the
 *   type of a value instead of the value itself
 * @returns {{errors: Array<object>, problems: Array<object>, warnings: Array<object>}} what was found
 */
function validate(config, options = {}) {
  const context = {
    mask: options.mask || (() => false),
    problems: [],
    source: options.source || (() => null),
  };
  const schema = options.schema || SCHEMA;

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      errors: [
        {
          expected: 'an object',
          hint: 'config/<NODE_ENV>.json holds a JSON object',
          key: '',
          level: 'error',
          message: `the configuration must be an object, but it is ${received(config)}`,
          received: received(config),
          source: context.source(''),
        },
      ],
      problems: [],
      warnings: [],
    };
  }

  shape({ keys: schema, type: 'object', unknown: 'warn' }, config, '', context);
  related(config, context);

  const { problems } = context;

  return {
    errors: problems.filter((problem) => problem.level === 'error'),
    problems,
    warnings: problems.filter((problem) => problem.level === 'warning'),
  };
}

/**
 * A problem on one line, with where the value came from and what to do
 *
 * @param {object} problem one problem of validate()
 * @returns {string} the lines
 */
function line(problem) {
  const from = problem.source ? ` (from ${problem.source})` : '';
  const hint = problem.hint ? `\n    ${problem.hint}` : '';

  return `  ${problem.message}${from}${hint}`;
}

/**
 * One line naming how many problems there are and which keys they are on
 *
 * @param {Array<object>} problems the problems of validate()
 * @param {string} [header] what to say before them
 * @returns {string} the line
 */
function summary(problems, header = 'invalid configuration') {
  const count =
    problems.length === 1 ? '1 problem' : `${problems.length} problems`;
  const keys = [...new Set(problems.map((problem) => problem.key))];

  return `${header} (${count}): ${keys.join(', ')}`;
}

/**
 * The problems as one message: the summary, then a line per problem with
 * where the value came from and what to do
 *
 * @param {Array<object>} problems the problems of validate()
 * @param {string} [header] what to say before them
 * @returns {string} the message
 */
function format(problems, header = 'invalid configuration') {
  return [summary(problems, header), ...problems.map(line)].join('\n');
}

/**
 * A boot failure carrying every problem found, shaped like the errors of
 * the command line (`code`, `hint`, and a message that reads on its own)
 *
 * @class ConfigurationError
 * @extends {Error}
 */
class ConfigurationError extends Error {
  /**
   * @param {Array<object>} problems the problems of validate()
   * @param {string} [header] what to say before them
   */
  constructor(problems, header = 'invalid configuration') {
    // One line: the boot log and the command line both print `message`, and
    // the problems are printed once, by whoever has the room for them
    super(summary(problems, header));
    this.name = 'ConfigurationError';
    this.code = 'CONFIG_INVALID';
    this.exitCode = 1;
    this.hint =
      'Every key henri reads is documented at https://usehenri.io/reference/configuration/';
    this.problems = problems;
  }
}

/**
 * The schema node at a configuration key, walking records and the branches
 * of a union. This is what tells `0.config.js` the type an environment
 * variable should be read as when the file has no value at that key.
 *
 * @param {string} key the configuration key (`stores.default.url`)
 * @param {object} [schema=SCHEMA] the schema
 * @returns {?object} the node, or null when henri does not own that key
 */
function nodeAt(key, schema = SCHEMA) {
  let node = { keys: schema, type: 'object' };

  for (const part of segments(key)) {
    if (!node) {
      return null;
    }

    if (node.type === 'record') {
      node = node.values;
      continue;
    }

    const branches = node.oneOf || [node];
    const found = branches
      .map((branch) => branch.keys && branch.keys[part])
      .find(Boolean);

    node = found || null;
  }

  return node;
}

/**
 * The javascript types a node accepts
 *
 * @param {?object} node a schema node
 * @returns {Array<string>} `boolean`, `number`, `object` and/or `string`
 */
function kinds(node) {
  if (!node) {
    return [];
  }

  if (Object.prototype.hasOwnProperty.call(node, 'const')) {
    return node.const === null ? [] : [typeof node.const];
  }

  if (node.oneOf) {
    return node.oneOf.flatMap(kinds);
  }

  if (node.type === 'record') {
    return ['object'];
  }

  return ['boolean', 'number', 'object', 'string'].includes(node.type)
    ? [node.type]
    : [];
}

/**
 * The type an environment variable should be read as, from the schema
 *
 * Only what the raw value can plausibly be counts: `HENRI_CONFIG__port=nope`
 * answers null rather than `number`, so the value reaches the validator and
 * fails there, naming the key, the variable and what was expected, instead
 * of failing here on the type alone.
 *
 * @param {string} key the configuration key
 * @param {string} raw the value of the variable
 * @param {object} [schema=SCHEMA] the schema
 * @returns {?string} `boolean`, `number`, `object`, `string`, or null when
 *   henri owns no such key (or the value cannot be one of its types)
 */
function coercionFor(key, raw, schema = SCHEMA) {
  const list = kinds(nodeAt(key, schema));

  if (list.includes('boolean') && /^(true|false)$/iu.test(raw)) {
    return 'boolean';
  }

  if (
    list.includes('number') &&
    raw.trim() !== '' &&
    Number.isFinite(Number(raw))
  ) {
    return 'number';
  }

  if (list.includes('string')) {
    return 'string';
  }

  return null;
}

module.exports = {
  ConfigurationError,
  coercionFor,
  describe,
  distance,
  format,
  nearest,
  nodeAt,
  received,
  summary,
  validate,
};
