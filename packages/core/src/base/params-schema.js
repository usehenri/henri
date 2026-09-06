/**
 * The shape of a request, declared by the controller.
 *
 * `req.permit('title', 'year')` picks fields by name and says nothing about
 * what they hold: `?year=banana` reaches the model, and what a person sees
 * is whatever the ORM said, if anything. A controller closes that by saying
 * what each of its actions accepts, in the block `before` already
 * established (`base/hooks.js`) -- an export the router reads, keyed by
 * action, never an action itself:
 *
 * ```js
 * module.exports = {
 *   params: {
 *     all: { format: { type: 'string', enum: ['html', 'json'] } },
 *     create: { title: { type: 'string', required: true, maxLength: 120 } },
 *     'index,search': { page: { type: 'integer', min: 1, default: 1 } },
 *   },
 *
 *   create: async (req, res) => res.resource(await Task.create(req.permit())),
 * };
 * ```
 *
 * The check runs where the guards already are -- behind the role and the
 * policy, ahead of the `before` hooks -- so a request that may not reach the
 * action is never told what is wrong with its parameters, and a hook that
 * loads a record already sees the coerced value. An action with no
 * declaration is untouched, and `req.permit(...)` keeps working as it does.
 *
 * ## The vocabulary
 *
 * The one the models use (`type`, `required`, `default`, `enum`), plus the
 * bounds a request genuinely needs. A rule is an object, or the type itself
 * (`year: 'integer'` is `year: { type: 'integer' }`):
 *
 * - `type`: `string`, `text`, `number`, `integer`, `float`, `boolean`,
 *   `date`, `json`, `uuid` -- the henri schema types -- and `array`, which a
 *   query string produces on its own (`?tag=a&tag=b`) and nothing else could
 *   express.
 * - `required`: the field has to be there.
 * - `default`: what an absent field is worth. A function is called per
 *   request, so `default: () => new Date()` is a value and not a shared one.
 * - `enum`: the values accepted, checked after the coercion.
 * - `min`, `max`: the bounds of a number.
 * - `minLength`, `maxLength`: the bounds of a length -- the characters of a
 *   string, the items of a list. One word for one meaning rather than two.
 * - `pattern`: a regular expression a string has to match.
 * - `of`: the rule every item of a list follows. A list declares it.
 *
 * A constraint that means nothing for its type (`min` on a string, `of` on a
 * number) is a mistake, not a subtlety: it fails at boot rather than being
 * ignored, and so does an unknown key, an unknown type and a `default` the
 * rule itself refuses.
 *
 * ## Coercion, which is the interesting half
 *
 * A query string is all strings. A form body is all strings. A JSON body is
 * not, and that difference is the rule:
 *
 * - **A textual source** -- the query string, a path parameter, a form body
 *   -- is *parsed* into the declared type. `?page=2` arrives as the number
 *   2, `?active=true` (or `on`, or `1`) as `true`, `?at=2024-01-01` as a
 *   Date. There is no other way for a client to say 2 there.
 * - **A typed source** -- a JSON body -- is *checked*, never parsed:
 *   `{"page": "2"}` is a caller sending a string where the action declared a
 *   number, and it is refused. JSON can say 2; it said "2". The two types
 *   JSON cannot express are the exception and are read from a string there
 *   as well: a `date` is an ISO-8601 string and a `uuid` is a string.
 *
 * The rest follows from those two: an empty string from a textual source is
 * an absent field (a browser sends one for every input nobody touched)
 * unless the type is `string` or `text`, where it is the empty string;
 * `null` is an absent field everywhere; a single textual value is a one-item
 * list when the type is `array`, while a JSON body has to send the list it
 * declared; and a repeated query key (`?year=1&year=2`) is a list arriving
 * where a number was declared, which is refused rather than silently taking
 * one of the two.
 *
 * What is accepted is written back where it came from, so `req.query.page`
 * is the number 2 and not the string, and `req.permit()` with no arguments
 * answers everything the action declared -- the whole point of declaring it.
 * A `default` for a field nobody sent lands in the body of a request that
 * has one, and in the query string otherwise.
 *
 * ## Unknown keys stay dropped
 *
 * `req.permit()` drops what it was not asked for and this keeps dropping:
 * there is no strict mode refusing an undeclared key. It would have to carve
 * out henri's own vocabulary first (`_csrf` and `_method` in a body, `page`
 * and `per_page` in a query string) and it would still refuse a bookmarked
 * url carrying `utm_source`, which is a link somebody shared and not an
 * attack. What matters is that nothing undeclared reaches a model, and the
 * declaration is already the list `permit()` answers.
 *
 * ## Deliberately not here
 *
 * No dependency, and no second vocabulary: no `oneOf`, no nested objects (a
 * JSON body deeper than one level is a document, and a model is what
 * validates documents), no cross-field rules (`endsAt` after `startsAt` is
 * the action's business, and it needs both values), no date bounds, no
 * message of one's own per field, and no trimming -- henri hands over
 * exactly what was sent. `henri openapi` does not read these declarations
 * yet.
 */

const { fail } = require('./errors');
const { isUuid } = require('./external-id');
const { page } = require('./http');
const { respond } = require('./auth');

/** The controller exports that are never actions (see base/hooks.js) */
const RESERVED = new Set(['params']);

/** The failure a request gets when it does not match the declaration */
const CODE = 'HENRI_PARAMS_INVALID';

/** What every answer says before the field messages */
const MESSAGE = 'the parameters are invalid';

/** The types a rule may declare */
const TYPES = [
  'array',
  'boolean',
  'date',
  'float',
  'integer',
  'json',
  'number',
  'string',
  'text',
  'uuid',
];

/** What each type is, in words, for the message a person reads */
const WORDS = {
  array: 'must be a list',
  boolean: 'must be true or false',
  date: 'must be a date',
  float: 'must be a number',
  integer: 'must be a whole number',
  json: 'must be json',
  number: 'must be a number',
  string: 'must be text',
  text: 'must be text',
  uuid: 'must be a uuid',
};

/** The types a constraint applies to; every other key is in BASE */
const APPLIES = {
  enum: ['float', 'integer', 'number', 'string', 'text', 'uuid'],
  max: ['float', 'integer', 'number'],
  maxLength: ['array', 'string', 'text'],
  min: ['float', 'integer', 'number'],
  minLength: ['array', 'string', 'text'],
  of: ['array'],
  pattern: ['string', 'text'],
};

/** The keys every type takes */
const BASE = ['default', 'required', 'type'];

/** Every key a rule may hold */
const KEYS = [...BASE, ...Object.keys(APPLIES)].sort();

/** The verbs that carry a body, and that a browser posts a form with */
const MUTATING = new Set(['DELETE', 'PATCH', 'POST', 'PUT']);

/** A decimal number, and nothing else: no `0x10`, no `Infinity`, no `1n` */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

/** What a textual source may say for `true` */
const TRUE = new Set(['1', 'on', 'true', 'yes']);

/** ... and for `false` */
const FALSE = new Set(['0', 'off', 'false', 'no']);

/**
 * Is this a plain object (a declaration, a rule, a body)?
 *
 * @param {*} value anything
 * @returns {boolean} true for a plain object
 */
const isObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * The failure a wrong declaration raises, naming where it is
 *
 * @param {string} where the controller, or the controller and action
 * @param {string} what what is wrong
 * @returns {Error} the error to throw
 */
const invalid = (where, what) =>
  fail('HENRI_PARAMS_DECLARATION_INVALID', `${where} ${what}`);

/**
 * The action names a selector key stands for
 *
 * `all` and `*` are every action, anything else is one action or a
 * comma-separated list of them -- the selectors `before` already uses.
 *
 * @param {string} key the key of the `params` block
 * @returns {?Array<string>} the actions, or null for every action
 */
function selects(key) {
  const names = String(key)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  if (names.length === 1 && (names[0] === 'all' || names[0] === '*')) {
    return null;
  }

  return names;
}

/**
 * The raw declaration of one action: every selector that names it, merged in
 * declaration order, so `all` is the floor and the action's own key wins
 *
 * @param {object} block the `params` export
 * @param {string} action the action name
 * @returns {?object} the fields, or null when nothing declares any
 */
function fieldsFor(block, action) {
  if (!isObject(block)) {
    return null;
  }

  let found = null;

  for (const [key, fields] of Object.entries(block)) {
    const only = selects(key);

    if (only !== null && !only.includes(action)) {
      continue;
    }

    found = Object.assign({}, found, fields);
  }

  return found;
}

/**
 * A type with its article, for the message a person reads
 *
 * @param {string} type the type
 * @returns {string} `a string`, `an integer`
 */
const article = (type) =>
  ['array', 'integer'].includes(type) ? `an ${type}` : `a ${type}`;

/**
 * Refuses a type: one message, listing what there is
 *
 * @param {string} where the controller and action
 * @param {string} field the field name
 * @param {string} what what is wrong
 * @returns {void} never returns
 * @throws {Error} always
 */
function refuseType(where, field, what) {
  throw invalid(
    where,
    `declares "${field}", which ${what}: the types are ${TYPES.join(', ')} ` +
      `(\`${field}: 'string'\` is the short form)`
  );
}

/**
 * The type of a rule, whatever shape it was written in
 *
 * @param {*} written the rule (an object, or the type itself)
 * @param {string} where the controller and action
 * @param {string} field the field name
 * @returns {string} the type
 * @throws {Error} when there is none, or it is not one of them
 */
function typeOf(written, where, field) {
  const type = typeof written === 'string' ? written : written.type;

  if (typeof type === 'undefined') {
    return refuseType(where, field, 'names no type');
  }

  if (typeof type !== 'string' || !TYPES.includes(type)) {
    return refuseType(
      where,
      field,
      `names the type ${JSON.stringify(type)}, which henri does not have`
    );
  }

  return type;
}

/**
 * Normalizes and checks one rule
 *
 * @param {*} written what the controller wrote
 * @param {string} where the controller and action (`tasks#create`)
 * @param {string} field the field name
 * @returns {object} the compiled rule
 * @throws {Error} when the rule holds something henri cannot carry out
 */
function rule(written, where, field) {
  if (typeof written !== 'string' && !isObject(written)) {
    throw invalid(
      where,
      `declares "${field}" as ${
        written === null ? 'null' : typeof written
      }: a rule is an object, or the type itself`
    );
  }

  const type = typeOf(written, where, field);
  const source = typeof written === 'string' ? { type } : written;
  const compiled = { type };

  for (const [key, value_] of Object.entries(source)) {
    if (!KEYS.includes(key)) {
      throw invalid(
        where,
        `declares "${field}" with the unknown key "${key}": ` +
          `a rule takes ${KEYS.join(', ')}`
      );
    }

    if (APPLIES[key] && !APPLIES[key].includes(type)) {
      throw invalid(
        where,
        `declares "${field}" with "${key}", which ${article(type)} does not ` +
          `take: ${key} is for ${APPLIES[key].join(', ')}`
      );
    }

    compiled[key] = value_;
  }

  return finish(compiled, where, field);
}

/**
 * The checks a compiled rule goes through before it is kept: the shape of
 * every constraint, and the values the rule itself holds
 *
 * @param {object} compiled the rule
 * @param {string} where the controller and action
 * @param {string} field the field name
 * @returns {object} the same rule, frozen
 * @throws {Error} when a constraint cannot be carried out
 */
function finish(compiled, where, field) {
  /**
   * Refuses the rule
   *
   * @param {string} what what is wrong with it
   * @returns {void} never returns
   * @throws {Error} always
   */
  const bad = (what) => {
    throw invalid(where, `declares "${field}" with ${what}`);
  };

  for (const key of ['max', 'maxLength', 'min', 'minLength']) {
    if (key in compiled && typeof compiled[key] !== 'number') {
      bad(`a "${key}" that is not a number`);
    }
  }

  if ('pattern' in compiled && !(compiled.pattern instanceof RegExp)) {
    bad('a "pattern" that is not a regular expression');
  }

  if ('required' in compiled && typeof compiled.required !== 'boolean') {
    bad('a "required" that is not true or false');
  }

  if (compiled.type === 'array') {
    if (!('of' in compiled)) {
      bad('no "of": a list says what it holds (`of: \'string\'`)');
    }

    compiled.of = rule(compiled.of, where, `${field}[]`);
  }

  if ('enum' in compiled) {
    if (!Array.isArray(compiled.enum) || compiled.enum.length === 0) {
      bad('an "enum" that is not a list of values');
    }

    for (const allowed of compiled.enum) {
      const wrong = typed(compiled, allowed, true);

      if (wrong) {
        bad(
          `the value ${JSON.stringify(allowed)} in its "enum", which ${wrong}`
        );
      }
    }
  }

  if ('default' in compiled && typeof compiled.default !== 'function') {
    const wrong = check(compiled, compiled.default, false);

    if (wrong) {
      bad(`a "default" that the rule itself refuses: it ${wrong}`);
    }
  }

  return Object.freeze(compiled);
}

/**
 * The declarations of a controller, action by action
 *
 * A selector naming something that is not an action of the controller is a
 * typo that would silently accept everything: it fails here instead.
 *
 * @param {object} controller the controller module
 * @param {string} name the controller name (`tasks`, `admin/users`)
 * @param {Array<string>} actions the action names of the controller
 * @returns {object} the compiled rules, keyed by action
 * @throws {Error} when a declaration cannot be carried out
 */
function declarations(controller, name, actions) {
  const block = controller && controller.params;

  if (typeof block === 'undefined' || block === null) {
    return {};
  }

  if (!isObject(block)) {
    throw invalid(name, 'declares `params` as something other than an object');
  }

  for (const [key, fields] of Object.entries(block)) {
    if (!isObject(fields)) {
      throw invalid(
        name,
        `declares "${key}" as something other than a list of fields`
      );
    }

    for (const action of selects(key) || []) {
      if (!actions.includes(action)) {
        throw invalid(
          name,
          `declares parameters for "${action}", which is not one of its ` +
            `actions (${actions.join(', ') || 'it has none'})`
        );
      }
    }
  }

  const compiled = {};

  for (const action of actions) {
    const fields = fieldsFor(block, action);

    if (!fields || Object.keys(fields).length === 0) {
      continue;
    }

    compiled[action] = Object.freeze(
      Object.fromEntries(
        Object.entries(fields).map(([field, written]) => [
          field,
          rule(written, `${name}#${action}`, field),
        ])
      )
    );
  }

  return compiled;
}

/**
 * Is a value of the type a rule declares, as JSON would carry it?
 *
 * @param {object} compiled the rule
 * @param {*} given the value
 * @param {boolean} [strict=false] refuse the string form of a date
 * @returns {?string} what is wrong, or null
 */
function typed(compiled, given, strict = false) {
  const { type } = compiled;

  if (type === 'json') {
    return null;
  }

  if (type === 'array') {
    return Array.isArray(given) ? null : WORDS.array;
  }

  if (type === 'date') {
    return date(given, strict) ? null : WORDS.date;
  }

  if (type === 'uuid') {
    return isUuid(given) ? null : WORDS.uuid;
  }

  if (type === 'boolean') {
    return typeof given === 'boolean' ? null : WORDS.boolean;
  }

  if (type === 'string' || type === 'text') {
    return typeof given === 'string' ? null : WORDS.string;
  }

  if (typeof given !== 'number' || !Number.isFinite(given)) {
    return WORDS[type];
  }

  return type === 'integer' && !Number.isInteger(given) ? WORDS.integer : null;
}

/**
 * Is this a date? A Date, or -- since JSON has no other way of carrying one
 * -- an ISO-8601 string
 *
 * @param {*} given the value
 * @param {boolean} strict refuse the string form
 * @returns {boolean} a date or not
 */
function date(given, strict) {
  if (given instanceof Date) {
    return !Number.isNaN(given.getTime());
  }

  return (
    !strict && typeof given === 'string' && !Number.isNaN(Date.parse(given))
  );
}

/**
 * The constraints of a rule, once the value has the right type
 *
 * @param {object} compiled the rule
 * @param {*} given the coerced value
 * @returns {?string} what is wrong, or null
 */
function constrain(compiled, given) {
  const { enum: allowed, max, maxLength, min, minLength, pattern } = compiled;
  const sized = typeof given === 'string' || Array.isArray(given);
  const unit = Array.isArray(given) ? 'items' : 'characters';

  if (typeof min === 'number' && given < min) {
    return `must be at least ${min}`;
  }

  if (typeof max === 'number' && given > max) {
    return `must be at most ${max}`;
  }

  if (sized && typeof minLength === 'number' && given.length < minLength) {
    return `must be at least ${minLength} ${unit}`;
  }

  if (sized && typeof maxLength === 'number' && given.length > maxLength) {
    return `must be at most ${maxLength} ${unit}`;
  }

  if (pattern && !pattern.test(given)) {
    return 'is not in the expected format';
  }

  if (allowed && !allowed.includes(given)) {
    return `must be one of ${allowed.join(', ')}`;
  }

  return null;
}

/**
 * The part of a message that says what JSON actually sent, for the mistake
 * this whole rule exists to catch
 *
 * @param {object} compiled the rule
 * @param {*} given the value
 * @param {boolean} nested is this an item of a list?
 * @returns {string} the addition, or an empty string
 */
function what(compiled, given, nested) {
  if (nested || compiled.type === 'array') {
    return '';
  }

  return ` (json sent ${Array.isArray(given) ? 'a list' : `a ${typeof given}`})`;
}

/**
 * A value of a typed source (a JSON body): checked, never parsed, except for
 * the two types JSON has no way of carrying
 *
 * @param {object} compiled the rule
 * @param {*} given the value
 * @param {boolean} nested is this an item of a list?
 * @returns {{value: *}|{error: string}} the value, or what is wrong with it
 */
function keep(compiled, given, nested) {
  const wrong = typed(compiled, given);

  if (wrong) {
    return { error: `${wrong}${what(compiled, given, nested)}` };
  }

  if (compiled.type === 'date') {
    return { value: given instanceof Date ? given : new Date(given) };
  }

  if (compiled.type === 'array') {
    return items(compiled, given, false);
  }

  return { value: given };
}

/**
 * A value of a textual source (the query string, a path parameter, a form
 * body): parsed into the declared type, because a string is all a client can
 * send there
 *
 * @param {object} compiled the rule
 * @param {*} given the value
 * @returns {{value: *}|{error: string}} the value, or what is wrong with it
 */
function parse(compiled, given) {
  const { type } = compiled;

  if (type === 'array') {
    return items(compiled, Array.isArray(given) ? given : [given], true);
  }

  if (Array.isArray(given)) {
    return { error: `${WORDS[type]} (it was sent more than once)` };
  }

  if (type === 'json') {
    return typeof given === 'string' ? asJson(given) : { value: given };
  }

  if (typeof given !== 'string') {
    return { error: WORDS[type] };
  }

  return scalar(type, given);
}

/**
 * One string, as the type it was declared
 *
 * @param {string} type the type
 * @param {string} given the string
 * @returns {{value: *}|{error: string}} the value, or what is wrong with it
 */
function scalar(type, given) {
  if (type === 'string' || type === 'text') {
    return { value: given };
  }

  if (type === 'uuid') {
    return isUuid(given) ? { value: given } : { error: WORDS.uuid };
  }

  if (type === 'boolean') {
    const lowered = given.trim().toLowerCase();

    if (TRUE.has(lowered)) {
      return { value: true };
    }

    return FALSE.has(lowered) ? { value: false } : { error: WORDS.boolean };
  }

  if (type === 'date') {
    const time = Date.parse(given.trim());

    return Number.isNaN(time)
      ? { error: WORDS.date }
      : { value: new Date(time) };
  }

  const number = DECIMAL.test(given.trim()) ? Number(given.trim()) : NaN;

  if (!Number.isFinite(number)) {
    return { error: WORDS[type] };
  }

  return type === 'integer' && !Number.isInteger(number)
    ? { error: WORDS.integer }
    : { value: number };
}

/**
 * A JSON string, parsed
 *
 * @param {string} given the string
 * @returns {{value: *}|{error: string}} the value, or what is wrong with it
 */
function asJson(given) {
  try {
    return { value: JSON.parse(given) };
  } catch (error) {
    return { error: WORDS.json };
  }
}

/**
 * Every item of a list, through the rule the list declared
 *
 * @param {object} compiled the rule of the list
 * @param {Array} list the items
 * @param {boolean} textual are the items strings from a url or a form?
 * @returns {{value: Array}|{error: string}} the list, or what is wrong
 */
function items(compiled, list, textual) {
  const values = [];

  for (const [index, item] of list.entries()) {
    const answer = value(compiled.of, item, textual, true);

    if (answer.error) {
      return { error: `item ${index + 1} ${answer.error}` };
    }

    if ('value' in answer) {
      values.push(answer.value);
    }
  }

  return { value: values };
}

/**
 * One value, from whichever source it came
 *
 * @param {object} compiled the rule
 * @param {*} raw what arrived
 * @param {boolean} textual is the source textual (a url, a form)?
 * @param {boolean} [nested=false] is this an item of a list?
 * @returns {{value: *}|{error: string}|{}} the value, what is wrong with it,
 *   or nothing at all when the field is absent
 */
function value(compiled, raw, textual, nested = false) {
  if (absent(compiled, raw, textual)) {
    return {};
  }

  const answer = textual ? parse(compiled, raw) : keep(compiled, raw, nested);

  if (answer.error) {
    return answer;
  }

  const wrong = constrain(compiled, answer.value);

  return wrong ? { error: wrong } : answer;
}

/**
 * Is the field absent? `null` always is, and so is the empty string a
 * browser sends for every input nobody touched -- unless the field is text,
 * where an empty string is a value
 *
 * @param {object} compiled the rule
 * @param {*} raw what arrived
 * @param {boolean} textual is the source textual?
 * @returns {boolean} absent or not
 */
function absent(compiled, raw, textual) {
  if (typeof raw === 'undefined' || raw === null) {
    return true;
  }

  const text = compiled.type === 'string' || compiled.type === 'text';

  return textual && raw === '' && !text;
}

/**
 * What a rule says about a value, without a request: the same check the
 * middleware runs, for the declaration's own `default`
 *
 * @param {object} compiled the rule
 * @param {*} raw the value
 * @param {boolean} textual is the source textual?
 * @returns {?string} what is wrong, or null
 */
function check(compiled, raw, textual) {
  const answer = value(compiled, raw, textual);

  return answer.error || null;
}

/**
 * Where a field was sent, and what it holds there
 *
 * The precedence `req.permit()` follows: the query string, then the body,
 * then the path parameters, a later source winning over an earlier one.
 *
 * @param {Express.Request} req the request
 * @param {string} field the field name
 * @returns {?{from: string, raw: *}} the source and the value, or null
 */
function sent(req, field) {
  let found = null;

  for (const from of ['query', 'body', 'params']) {
    const bag = req[from];

    if (isObject(bag) && Object.prototype.hasOwnProperty.call(bag, field)) {
      found = { from, raw: bag[field] };
    }
  }

  return found;
}

/**
 * Does this body carry types of its own?
 *
 * Only JSON does. Everything else henri parses -- a form, a multipart body,
 * a query string, a path -- is strings all the way down.
 *
 * @param {Express.Request} req the request
 * @returns {boolean} true when the body is JSON
 */
function isJson(req) {
  return typeof req.is === 'function' && Boolean(req.is('json'));
}

/**
 * Checks a request against the rules of an action
 *
 * @param {object} rules the compiled rules, by field
 * @param {Express.Request} req the request
 * @returns {{errors: object, values: object, origin: object}} the messages by
 *   field, the accepted values and where each of them came from
 */
function inspect(rules, req) {
  const errors = {};
  const values = {};
  const origin = {};
  const typedBody = isJson(req);

  for (const [field, compiled] of Object.entries(rules)) {
    const found = sent(req, field);
    const textual = !found || found.from !== 'body' || !typedBody;
    const answer = value(compiled, found && found.raw, textual);

    if (answer.error) {
      errors[field] = answer.error;
    } else if ('value' in answer) {
      values[field] = answer.value;
      origin[field] = found.from;
    } else if ('default' in compiled) {
      values[field] = fallback(compiled);
      origin[field] = null;
    } else if (compiled.required) {
      errors[field] = 'is required';
    }
  }

  return { errors, origin, values };
}

/**
 * The default of a rule, computed for this request when it is a function
 *
 * @param {object} compiled the rule
 * @returns {*} the value
 */
function fallback(compiled) {
  return typeof compiled.default === 'function'
    ? compiled.default()
    : compiled.default;
}

/**
 * Where a value nobody sent belongs: the body of a request that has one, the
 * query string otherwise
 *
 * @param {Express.Request} req the request
 * @returns {string} `query` or `body`
 */
function home(req) {
  return MUTATING.has(String(req.method).toUpperCase()) && isObject(req.body)
    ? 'body'
    : 'query';
}

/**
 * Writes what was accepted back where it came from, so that everything
 * downstream -- `req.permit()`, a `before` hook, the action, the view
 * options -- reads the request in the shape the action declared
 *
 * @param {Express.Request} req the request
 * @param {object} result what `inspect` answered
 * @returns {void}
 */
function write(req, result) {
  const query = {};
  let rewrite = false;

  for (const [field, given] of Object.entries(result.values)) {
    const from = result.origin[field] || home(req);

    if (from === 'query') {
      query[field] = given;
      rewrite = true;
    } else if (isObject(req[from])) {
      req[from][field] = given;
    }
  }

  if (rewrite) {
    // `req.query` is a getter parsing the url again on every read (express
    // 5), so taking the property over is the only way to hand the coerced
    // values to whatever reads it next
    Object.defineProperty(req, 'query', {
      configurable: true,
      enumerable: true,
      value: Object.assign({}, req.query, query),
      writable: true,
    });
  }

  req._accepted = result.values;
}

/**
 * The page a browser came from, when it is this application's own and the
 * request carried a body: a refused `GET` cannot be sent back where it came
 * from without looping
 *
 * @param {Express.Request} req the request
 * @returns {?string} the path to go back to, or null
 */
function back(req) {
  if (!MUTATING.has(String(req.method).toUpperCase())) {
    return null;
  }

  const host = typeof req.get === 'function' ? req.get('host') : null;
  const referer = typeof req.get === 'function' ? req.get('referer') : null;

  if (!host || !referer) {
    return null;
  }

  try {
    const url = new URL(referer, `${req.protocol || 'http'}://${host}`);

    if (url.host !== host) {
      return null;
    }

    const path = `${url.pathname}${url.search}`;

    // `https://this.app//elsewhere.test/x` is same-host and its *path* is
    // `//elsewhere.test/x`, which a browser reads as scheme-relative in a
    // Location header: same-origin in, another origin out. A path that is
    // not a single leading slash is not somewhere this application sent
    // anybody, so it is not somewhere it sends them back to
    return /^\/(?![/\\])/u.test(path) ? path : null;
  } catch (error) {
    return null;
  }
}

/**
 * Answers a request that does not match the declaration: 422 with one
 * message per field, negotiated like every other answer henri gives. A
 * browser that posted a form is sent back to it with the messages in the
 * flash -- the messages only, because henri cannot tell a password from a
 * title and the values would go through the session and the page.
 *
 * @param {Express.Request} req the request
 * @param {Express.Response} res the response
 * @param {object} errors the messages, by field
 * @returns {*} the answer
 */
function refuse(req, res, errors) {
  const target = back(req);

  if (target && typeof req.flash === 'function') {
    req.flash('errors', errors);
  }

  const details = Object.entries(errors)
    .map(([field, message]) => `${field} ${message}`)
    .join('\n');

  return respond(res, {
    html: () =>
      target
        ? res.redirect(303, target)
        : res
            .status(422)
            .type('html')
            .send(page(422, 'Unprocessable Entity', details, CODE)),
    json: () => res.boom.badData(MESSAGE, { errors }, CODE),
  });
}

/**
 * The middleware checking one action's parameters
 *
 * @param {object} rules the compiled rules, by field
 * @returns {function} express middleware
 */
function guard(rules) {
  return (req, res, next) => {
    let result;

    try {
      result = inspect(rules, req);
    } catch (error) {
      return next(error);
    }

    if (Object.keys(result.errors).length > 0) {
      return refuse(req, res, result.errors);
    }

    write(req, result);

    return next();
  };
}

module.exports = {
  APPLIES,
  CODE,
  KEYS,
  MESSAGE,
  RESERVED,
  TYPES,
  declarations,
  fieldsFor,
  guard,
  inspect,
  rule,
  write,
};
