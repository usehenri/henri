/**
 * The shape of an answer, declared by the controller.
 *
 * `base/params-schema.js` closed one direction: what arrives is declared per
 * action and refused before the action runs. This is the same idea pointing
 * the other way, and it exists because the two directions were not equally
 * guarded.
 *
 * `res.render()`, `res.resource()` and `res.collection()` all go through one
 * gate on the way out (`toPublic()`, base/hateoas.js): the foreign keys are
 * published as the `externalId` of the row they name, and a field the model
 * marked `personal: { expose: false }` is dropped. `res.json()` went through
 * nothing at all:
 *
 * ```js
 * // gated
 * res.render('Users/Index', { data: records });
 * // not gated, and the same records
 * res.json({ rows: records.map((r) => ({ id: r.id, gender: r.gender })) });
 * ```
 *
 * A hand-built object is not a record, so nothing published its foreign keys
 * and nothing stripped what the model said must never leave. That is not an
 * exotic controller: it is what an Inertia page whose props are assembled by
 * hand looks like, and what every JSON route that answers a total next to a
 * list looks like.
 *
 * ## Two things, and the difference between them matters
 *
 * **The floor** applies to every JSON answer of every controller action,
 * declared or not: the value is published and then stripped, the same two
 * passes and in the same order as everywhere else. Nothing an application
 * writes turns it off, because the mark on the field is the model's word
 * about a person and a controller is not the place to overrule it.
 *
 * **The declaration** is opt-in, per action, in the block `before` and
 * `params` already established -- an export the router reads, keyed by
 * action, never an action itself:
 *
 * ```js
 * module.exports = {
 *   answers: {
 *     index: {
 *       rows: { model: 'Memo', type: 'array' },
 *       total: 'integer',
 *     },
 *     peek: { title: 'string' },
 *   },
 *
 *   index: async (req, res) =>
 *     res.json({ rows: await Memo.find(), total: await Memo.count() }),
 * };
 * ```
 *
 * ## The vocabulary
 *
 * The one `params` uses, plus the two things an answer knows and a request
 * does not. A rule is an object, or the type itself (`total: 'integer'`):
 *
 * - `type`: the henri schema types, plus `array` and `record`.
 * - `model`: the model whose records this field holds. On its own it is one
 *   record; with `type: 'array'` it is a list of them. **This is what lets a
 *   hand-built object be published**: an object that never was a record
 *   carries no model, so henri cannot know that its `ownerId` names a row --
 *   the declaration is where it is told.
 * - `from`: `'User.gender'`, the column this value came from. It makes the
 *   field obey that column's marks under whatever name the answer gives it,
 *   which is the one leak a name-based strip cannot see, and it is what
 *   `henri openapi` types the field from. On its own it says nothing about
 *   the shape (`json`, the type that says nothing): a controller may present
 *   a column as anything, so a rule that wants a shape checked names one.
 * - `of`: the rule every item of a list of scalars follows.
 * - `required`: the field has to be in the answer.
 * - `expose`: `true` says this action may carry a field marked
 *   `personal: { expose: false }`, and it is the declared form of the
 *   `include` that `res.resource()` and `res.render()` already take.
 *
 * A rule henri cannot carry out fails the boot naming the controller, the
 * action and the field (`HENRI_ANSWERS_DECLARATION_INVALID`), the way a
 * `params` rule does: a declaration that is quietly ignored is worse than no
 * declaration, because it reads like a guarantee.
 *
 * ### What a declaration is deliberately not
 *
 * It does not validate the application's own values on the way out. There is
 * no `enum`, no `min`, no `pattern`, no `default`: the model checked those
 * when the value was written, and a response that fails after the work is
 * done turns a cosmetic mistake into an outage. What is checked is the
 * shape, because the shape is what `henri openapi` publishes as a contract.
 *
 * ## What is not declared does not leave
 *
 * An action that declared answers sends the fields it declared and nothing
 * else. That is the same rule `req.permit()` follows in the other direction
 * -- the declaration is the list, an undeclared key is dropped and never
 * refused -- and it is the safe direction: the field nobody declared is the
 * field nobody thought about, and that is where a value rides out. It costs
 * an application nothing to adopt, because an action with no declaration is
 * untouched.
 *
 * The other half is the opposite: a field that was **declared and is
 * missing**, or that holds something other than what was declared, is a
 * mistake in the declaration rather than a leak, so it is reported once per
 * route (`pen.warn`) and only refused with `config.api.strict` -- the knob
 * that already means "refuse what would otherwise be a warning about this
 * application's API" for the HAL links.
 *
 * ## What henri still cannot see
 *
 * A value taken off a record and put under another name is an opaque value:
 * `res.json({ g: user.gender })` is a string as far as henri is concerned.
 * `from: 'User.gender'` is how a controller says otherwise, and there is no
 * way to infer it -- the same limit `base/references.js` states for an
 * undeclared foreign key, and for the same reason.
 *
 * ## What reads them besides the gate
 *
 * `henri openapi` (base/openapi.js): a declaration is a description of what
 * an operation answers, which is exactly what the document could not know
 * for an action whose body a controller writes. Such an operation used to
 * carry `x-henri.known: false` and no success status at all; one that
 * declares its answer carries the schema instead.
 *
 * @module base/answers
 */

const { fail } = require('./errors');
const { isInertiaPage, sealed } = require('./headers');
const { prepare, settle } = require('./references');
const { TYPES: PARAM_TYPES, typed } = require('./params-schema');

/** The controller exports that are never actions (see base/hooks.js) */
const RESERVED = new Set(['answers']);

/** The failure an answer gets when `config.api.strict` refuses it */
const CODE = 'HENRI_ANSWERS_MISMATCH';

/** The types a rule may declare: the request vocabulary, plus a record */
const TYPES = [...PARAM_TYPES, 'record'].sort();

/** Every key a rule may hold */
const KEYS = ['expose', 'from', 'model', 'of', 'required', 'type'];

/**
 * Is this a plain object (a declaration, a rule, an answer)?
 *
 * @param {*} value anything
 * @returns {boolean} true for a plain object
 */
function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

/**
 * The failure a wrong declaration raises, naming where it is
 *
 * @param {string} where the controller, or the controller and action
 * @param {string} what what is wrong
 * @returns {Error} the error to throw
 */
const invalid = (where, what) =>
  fail('HENRI_ANSWERS_DECLARATION_INVALID', `${where} ${what}`);

/**
 * The action names a selector key stands for: the selectors `before` and
 * `params` already use
 *
 * @param {string} key the key of the `answers` block
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
 * @param {object} block the `answers` export
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
 * The `Model.field` a rule's `from` names
 *
 * Split, never matched: a declaration is written by hand and read at boot,
 * and there is no pattern here worth the risk of one (see base/exact.js).
 *
 * @param {*} written what `from` holds
 * @returns {?{field: string, model: string}} the column, or null
 */
function columnOf(written) {
  if (typeof written !== 'string') {
    return null;
  }

  const parts = written.split('.');

  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    return null;
  }

  return { field: parts[1].trim(), model: parts[0].trim() };
}

/**
 * Normalizes and checks one rule
 *
 * @param {*} written what the controller wrote
 * @param {string} where the controller and action (`memos#index`)
 * @param {string} field the field name
 * @param {boolean} [nested=false] is this the `of` of a list?
 * @returns {object} the compiled rule
 * @throws {Error} when the rule holds something henri cannot carry out
 */
function rule(written, where, field, nested = false) {
  if (typeof written !== 'string' && !isObject(written)) {
    throw invalid(
      where,
      `answers "${field}" as ${
        written === null ? 'null' : typeof written
      }: a rule is an object, or the type itself`
    );
  }

  const source = typeof written === 'string' ? { type: written } : written;
  const compiled = {};

  for (const [key, value] of Object.entries(source)) {
    if (!KEYS.includes(key)) {
      throw invalid(
        where,
        `answers "${field}" with the unknown key "${key}": ` +
          `a rule takes ${KEYS.join(', ')}`
      );
    }

    compiled[key] = value;
  }

  return finish(compiled, where, field, nested);
}

/**
 * The type a rule ends up with, from what it wrote down
 *
 * @param {object} compiled the rule
 * @param {string} where the controller and action
 * @param {string} field the field name
 * @returns {string} the type
 * @throws {Error} when there is none, or it is not one of them
 */
function typeOf(compiled, where, field) {
  const { from, model, type } = compiled;

  if (typeof type === 'undefined') {
    if (typeof model === 'string') {
      return 'record';
    }

    // A column named and nothing else: the marks are what was asked for,
    // and the shape is whatever the column holds. `json` is the type that
    // says nothing, here as in a request
    if (typeof from === 'string') {
      return 'json';
    }

    throw invalid(
      where,
      `answers "${field}", which names no type: the types are ` +
        `${TYPES.join(', ')} (\`${field}: 'string'\` is the short form), ` +
        "and `model` names one of the application's"
    );
  }

  if (typeof type !== 'string' || !TYPES.includes(type)) {
    throw invalid(
      where,
      `answers "${field}" as the type ${JSON.stringify(type)}, ` +
        `which henri does not have: the types are ${TYPES.join(', ')}`
    );
  }

  return type;
}

/**
 * The checks a compiled rule goes through before it is kept
 *
 * @param {object} compiled the rule
 * @param {string} where the controller and action
 * @param {string} field the field name
 * @param {boolean} nested is this the `of` of a list?
 * @returns {object} the same rule, frozen
 * @throws {Error} when a rule cannot be carried out
 */
function finish(compiled, where, field, nested) {
  /**
   * Refuses the rule
   *
   * @param {string} what what is wrong with it
   * @returns {void} never returns
   * @throws {Error} always
   */
  const bad = (what) => {
    throw invalid(where, `answers "${field}" with ${what}`);
  };

  compiled.type = typeOf(compiled, where, field);

  if ('model' in compiled && typeof compiled.model !== 'string') {
    bad('a "model" that is not the name of a model');
  }

  if ('from' in compiled) {
    const column = columnOf(compiled.from);

    if (!column) {
      bad('a "from" that is not `Model.field`');
    }

    compiled.from = column;
  }

  for (const key of ['expose', 'required']) {
    if (key in compiled && typeof compiled[key] !== 'boolean') {
      bad(`a "${key}" that is not true or false`);
    }
  }

  if (compiled.model && compiled.type !== 'record') {
    if (compiled.type !== 'array') {
      bad(
        `"model" and the type ${JSON.stringify(compiled.type)}: a field ` +
          'holding records is a record, or an array of them'
      );
    }

    if ('of' in compiled) {
      bad('both "model" and "of": a list of records says which model, once');
    }
  }

  if (compiled.type === 'record' && !compiled.model) {
    bad('the type "record" and no "model": a record is a record of something');
  }

  if ('of' in compiled) {
    if (compiled.type !== 'array') {
      bad(`an "of", which only an array takes`);
    }

    if (nested) {
      bad('a list of lists, which an answer does not describe');
    }

    compiled.of = rule(compiled.of, where, `${field}[]`, true);
  }

  if (compiled.type === 'array' && !compiled.model && !('of' in compiled)) {
    bad('no "of" and no "model": a list says what it holds');
  }

  return Object.freeze(compiled);
}

/**
 * The declarations of a controller, action by action
 *
 * A selector naming something that is not an action of the controller is a
 * typo that would silently describe nothing: it fails here instead.
 *
 * @param {object} controller the controller module
 * @param {string} name the controller name (`memos`, `admin/notes`)
 * @param {Array<string>} actions the action names of the controller
 * @returns {object} the compiled rules, keyed by action
 * @throws {Error} when a declaration cannot be carried out
 */
function declarations(controller, name, actions) {
  const block = controller && controller.answers;

  if (typeof block === 'undefined' || block === null) {
    return {};
  }

  if (!isObject(block)) {
    throw invalid(name, 'declares `answers` as something other than an object');
  }

  for (const [key, fields] of Object.entries(block)) {
    if (!isObject(fields)) {
      throw invalid(
        name,
        `answers "${key}" with something other than a list of fields`
      );
    }

    for (const action of selects(key) || []) {
      if (!actions.includes(action)) {
        throw invalid(
          name,
          `declares an answer for "${action}", which is not one of its ` +
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
 * Checks a compiled declaration against the models of the application.
 *
 * This runs later than the compile does -- the models are loaded at runlevel
 * 3 and a controller at 2 -- so it is a second pass rather than part of
 * `rule()`, and it still fails the boot.
 *
 * @param {object} rules the compiled rules of one action
 * @param {object} context the context
 * @param {string} context.where the controller and action
 * @param {function} context.model `(globalId) => the model file, or null`
 * @param {function} context.mark `(globalId, field) => the personal mark`
 * @returns {void}
 * @throws {Error} when a rule names a model or a column that is not there,
 *   or a column that must never leave
 */
function verify(rules, { mark, model, where }) {
  for (const [field, compiled] of Object.entries(rules || {})) {
    const named = [compiled, compiled.of].filter(Boolean);

    for (const entry of named) {
      if (entry.model && !model(entry.model)) {
        throw invalid(
          where,
          `answers "${field}" with records of ${entry.model}, which is not ` +
            'a model of this application'
        );
      }

      if (!entry.from) {
        continue;
      }

      if (!model(entry.from.model)) {
        throw invalid(
          where,
          `answers "${field}" from ${entry.from.model}.${entry.from.field}, ` +
            `and ${entry.from.model} is not a model of this application`
        );
      }

      const found = mark(entry.from.model, entry.from.field);

      if (found && found.expose === false && compiled.expose !== true) {
        throw invalid(
          where,
          `answers "${field}" from ${entry.from.model}.${entry.from.field}, ` +
            'which the model marked `personal: { expose: false }`: that ' +
            'field never leaves the server. Drop it from the answer, or say ' +
            `it on purpose with \`expose: true\` on "${field}"`
        );
      }
    }
  }
}

/**
 * The personal field names one action is allowed to carry: the `include` of
 * `res.resource()`, written down instead of passed
 *
 * @param {object} rules the compiled rules
 * @returns {Array<string>} the names
 */
function includeOf(rules) {
  const names = [];

  for (const [field, compiled] of Object.entries(rules || {})) {
    if (compiled.expose !== true) {
      continue;
    }

    names.push(field);

    if (compiled.from) {
      names.push(compiled.from.field);
    }
  }

  return names;
}

/**
 * What a value is, in words, for the report a person reads
 *
 * @param {*} value anything
 * @returns {string} `a list`, `a string`, `null`
 */
function what(value) {
  if (value === null) {
    return 'null';
  }

  return Array.isArray(value) ? 'a list' : `a ${typeof value}`;
}

/**
 * What one declared field says about the value that arrived, or null
 *
 * A value that is absent or null is nothing to say: an answer that holds no
 * comment is not the same as one that holds the wrong kind of comment, and
 * `required` is about the key rather than what is under it.
 *
 * @param {object} compiled the rule
 * @param {*} value the value
 * @returns {?string} what is wrong, or null
 */
function mismatch(compiled, value) {
  if (value === null || typeof value === 'undefined') {
    return null;
  }

  if (compiled.type === 'record') {
    // Not `isObject`: a record may be a model instance, which is an object
    // with a prototype of its own
    return typeof value === 'object' && !Array.isArray(value)
      ? null
      : `must be a record, and it is ${what(value)}`;
  }

  if (compiled.type === 'array') {
    if (!Array.isArray(value)) {
      return `must be a list, and it is ${what(value)}`;
    }

    if (!compiled.of) {
      return null;
    }

    for (const [index, item] of value.entries()) {
      const wrong = mismatch(compiled.of, item);

      if (wrong) {
        return `item ${index + 1} ${wrong}`;
      }
    }

    return null;
  }

  const wrong = typed(compiled, value);

  return wrong ? `${wrong}, and it is ${what(value)}` : null;
}

/**
 * The answer an action declared, taken out of what it sent.
 *
 * Only the declared fields, in declaration order, plus the map telling
 * `publish()` which model a hand-built object holds.
 *
 * @param {object} rules the compiled rules
 * @param {object} body what the action sent
 * @returns {{picked: object, problems: Array<string>, types: WeakMap}} the
 *   answer, what does not match and the models of its nodes
 */
function pick(rules, body) {
  const picked = {};
  const problems = [];
  const types = new WeakMap();
  const declared = new Set(Object.keys(rules));

  for (const [field, compiled] of Object.entries(rules)) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) {
      if (compiled.required) {
        problems.push(`${field} is missing`);
      }

      continue;
    }

    const value = body[field];
    const wrong = mismatch(compiled, value);

    if (wrong) {
      problems.push(`${field} ${wrong}`);
    }

    if (compiled.model && value && typeof value === 'object') {
      // The list is not the record: the model goes on every item, which is
      // the node `walk()` reaches
      for (const node of Array.isArray(value) ? value : [value]) {
        if (node && typeof node === 'object') {
          types.set(node, compiled.model);
        }
      }
    }

    if (field === '__proto__') {
      // Never assigned: the setter of Object.prototype would replace the
      // answer's prototype instead of adding a field (see base/privacy.js)
      Object.defineProperty(picked, field, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
      continue;
    }

    picked[field] = value;
  }

  const dropped = Object.keys(body).filter((key) => !declared.has(key));

  if (dropped.length > 0) {
    problems.push(`${dropped.sort().join(', ')} left the answer undeclared`);
  }

  return { picked, problems, types };
}

/**
 * Says what a declared answer did not do, once per route.
 *
 * A warning rather than a failure by default, and a failure with
 * `config.api.strict`: what is reported here is a declaration that does not
 * describe the answer, which is a mistake in this application rather than
 * something a client did or a value that leaked.
 *
 * @param {Henri} henri the henri instance
 * @param {string} name the route name (`get /memos`)
 * @param {Array<string>} problems what does not match
 * @returns {boolean} true when the answer may still be sent
 */
function report(henri, name, problems) {
  const { api, pen } = henri;
  const message = `${name} does not answer what it declared: ${problems.join('; ')}`;
  const settings = (api && api.settings) || {};
  const warned = (api && api.warned) || new Set();

  if (!warned.has(message)) {
    warned.add(message);
    pen && pen.warn && pen.warn('api', message);
  }

  if (settings.strict !== true) {
    return true;
  }

  pen && pen.error && pen.error('api', name, 'refused by config.api.strict');

  return false;
}

/**
 * The floor and the declaration, as one function of a body.
 *
 * The order is the one `toPublic()` established and it is not an accident:
 * publishing resolves a foreign key into the public identifier of the row it
 * names, and a field marked `personal: { expose: false }` must not leave
 * carrying whatever it resolved to (see base/privacy.js).
 *
 * @param {Henri} henri the henri instance
 * @param {?object} rules the compiled rules, or null
 * @param {*} body what the action sent
 * @returns {{answer: *, settle: ?function, problems: Array<string>}} the
 *   answer as it stands, the lookups it still wants and what did not match
 */
function gate(henri, rules, body) {
  const strip = (value, include) =>
    henri.privacy ? henri.privacy.strip(value, include) : value;
  let value = body;
  let include = [];
  let problems = [];
  let types = null;

  if (rules && isObject(body)) {
    const chosen = pick(rules, body);

    include = includeOf(rules);
    problems = chosen.problems;
    types = chosen.types;
    value = chosen.picked;
  } else if (rules) {
    // A declaration names fields, and this answer has none to name. The
    // floor still runs: the point of the floor is that it always does
    problems = [`the declaration names fields and the answer is ${what(body)}`];
  }

  const { context, copy, pending } = prepare(henri, value, { types });

  if (pending.length === 0) {
    return { answer: strip(copy, include), problems, settle: null };
  }

  return {
    answer: null,
    problems,
    settle: async () => {
      await settle(henri, context);

      return strip(copy, include);
    },
  };
}

/**
 * The middleware gating what one action answers.
 *
 * It wraps `res.json()` for this route only, so the gate covers what a
 * controller sends by hand and nothing henri serves itself: `/livez`,
 * `/_routes`, the catalogues and the mail previews are not controller
 * actions and never see it.
 *
 * `res.json()` stays synchronous whenever it can, which is nearly always:
 * the walk is free and only a foreign key nobody eager loaded needs a
 * lookup. When one does, the wrapper answers a promise -- an action that
 * `return`s it is awaited by the implicit render (base/hooks.js), and one
 * that does not still has its answer written, because the failure path
 * answers rather than throwing into nobody's catch.
 *
 * @param {Henri} henri the henri instance
 * @param {?object} rules the compiled rules of the action, or null
 * @param {string} name the route name (`get /memos`)
 * @returns {function} express middleware
 */
function guard(henri, rules, name) {
  return (req, res, next) => {
    const json = res.json.bind(res);

    res.json = (body) => {
      if (sealed(res)) {
        return json(body);
      }

      // An Inertia page object is a rendered page rather than an answer of
      // this shape, and its props went through the gate as `data` already
      if (isInertiaPage(req, res)) {
        return json(body);
      }

      // The implicit render reads this to tell an action that answered from
      // one that returned without answering, and it reads it before the
      // promise below resolves (see base/hooks.js)
      res._answered = true;

      let gated;

      try {
        gated = gate(henri, rules, body);
      } catch (error) {
        return next(error);
      }

      if (gated.problems.length > 0 && !report(henri, name, gated.problems)) {
        return json({
          code: CODE,
          error: 'Internal Server Error',
          message: `${name} does not answer what it declared (config.api.strict)`,
          statusCode: (res.statusCode = 500),
        });
      }

      if (!gated.settle) {
        return json(gated.answer);
      }

      return gated.settle().then(
        (answer) => json(answer),
        (error) => {
          // A controller that did not `return` its `res.json()` would turn a
          // throw here into an unhandled rejection, so this answers instead
          // (the same reasoning as `enforce()` in base/hateoas.js)
          henri.pen &&
            henri.pen.error &&
            henri.pen.error('api', name, error.message);

          if (res.headersSent) {
            return res;
          }

          res.statusCode = 500;

          return json({
            code: CODE,
            error: 'Internal Server Error',
            message: `${name} could not publish its answer`,
            statusCode: 500,
          });
        }
      );
    };

    next();
  };
}

module.exports = {
  CODE,
  KEYS,
  RESERVED,
  TYPES,
  columnOf,
  declarations,
  fieldsFor,
  gate,
  guard,
  includeOf,
  mismatch,
  pick,
  rule,
  verify,
};
