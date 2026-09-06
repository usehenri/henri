/**
 * Filtering and ordering an index, from the query string.
 *
 * Every index page ends up re-implementing this, and it is the one surface
 * where an application writing a query out of request parameters gets hurt.
 * `ransack` is the Rails answer, at a hundred and seventeen million
 * downloads, and it is also -- deservedly -- near the top of the list of
 * gems people find most frustrating: a generic
 * `?q[email_cont]=@&s=password asc` reaches every column of every model, so
 * what an endpoint exposes stops being something anybody wrote down. henri
 * takes the opposite position, and the whole file is that one sentence:
 *
 * > **Nothing undeclared is filterable, and nothing undeclared is
 * > sortable.**
 *
 * A controller says what an action's list may be narrowed by and ordered
 * by, next to `params` and in the same shape (`base/params-schema.js`, the
 * selectors of `base/hooks.js`):
 *
 * ```js
 * module.exports = {
 *   filters: {
 *     index: {
 *       where: {
 *         state: { enum: ['submitted', 'accepted'], type: 'string' },
 *         submittedAt: { type: 'date' },
 *         title: { operators: ['starts'], type: 'string' },
 *       },
 *       sort: ['submittedAt', 'title'],
 *       default: '-submittedAt',
 *     },
 *   },
 *
 *   index: async (req, res) => {
 *     const { order, where } = await req.filter();
 *     const { page, perPage, records, total } = await Proposal.paginate({
 *       ...req.pagination(),
 *       order,
 *       where,
 *     });
 *
 *     return res.collection(records, { page, perPage, total });
 *   },
 * };
 * ```
 *
 * and a client writes it in the query string:
 *
 * ```
 * /proposals?filter[state]=accepted&filter[submittedAt][gte]=2026-01-01&sort=-submittedAt,title
 * ```
 *
 * Anything else -- a name the action did not declare, an operator the field
 * did not allow, a sort over a column nobody listed -- is a **422 before
 * the action runs**, with one message per term, through the answer
 * `base/params-schema.js` already gives (`HENRI_FILTER_INVALID`). A filter
 * is a parameter, so it is coerced by a parameter rule and refused the way
 * a parameter is; an empty value is an absent filter, because a browser
 * sends one for every select nobody touched.
 *
 * ## The operators are henri's, not the ORM's
 *
 * `eq`, `ne`, `in`, `nin`, `lt`, `lte`, `gt`, `gte`, `between`, `null`,
 * `starts`, `ends`, `contains`. Thirteen words that mean the same thing on
 * the three adapters, turned into **the adapter's own condition** by
 * `conditionFor()` below -- Sequelize's `Op` symbols, the `$` spellings
 * Mongoose and Drizzle share -- and never into SQL. henri writes no SQL
 * here for the reason `base/retention.js` gives about its own cutoff: the
 * adapters spell a comparison differently and core depends on none of them.
 *
 * What a field gets **by default** is deliberately small, and the line is
 * what a database can answer with an index:
 *
 * - every type gets `eq`, `ne`, `in`, `nin` and `null`. An equality is an
 *   index lookup and a bounded amount of work whatever the column holds.
 * - an ordered type -- `date`, `number`, `integer`, `float`, `decimal`,
 *   `bigint` -- also gets `lt`, `lte`, `gt`, `gte` and `between`. A range
 *   over an ordered column is a range scan, which is the other thing an
 *   index does.
 * - **the three text operators are opt-in, per field, by name**
 *   (`operators: ['starts', 'contains']`). `contains` on an unindexed text
 *   column is a full scan an unauthenticated client can ask for as often as
 *   it likes, and there is no bound henri can put on it: the honest answer
 *   is that the application says which columns it has thought about.
 *   `starts` is a prefix, which an ordinary b-tree index answers; `ends`
 *   and `contains` are not, and the guide says so where it says how to
 *   index them.
 *
 * A value is a **literal**, always. `%` and `_` in a text-operator value
 * are refused rather than escaped: they are the wildcards this whole
 * surface exists to keep a client from sending, and the three dialects do
 * not agree on an escape character (sqlite has none without an `ESCAPE`
 * clause henri would have to write as SQL). On MongoDB the value becomes a
 * fully escaped literal `$regex`, walked character by character, never a
 * pattern from the request.
 *
 * ## Ordering is not free either
 *
 * `sort` is a list of names, `-name` is descending, and the request may
 * carry at most `config.api.maxSort` of them (three). A column is refused
 * **at boot**, not at request time, when ordering it is something the
 * database would answer slowly or not at all:
 *
 * - a `text` or `json` column: an unbounded sort with no order to speak of.
 *   A `string` is a bounded column and is allowed.
 * - an `encrypted` column, either kind: `checkOrder()` in every adapter
 *   already refuses it (the rows would come back ordered by ciphertext),
 *   and this inherits that refusal instead of routing around it.
 * - a column marked `personal: { expose: false }`, for the reason below.
 *
 * henri appends the model's `externalId` to every order it builds. A page
 * is only stable when the order is total, and paging through a list ordered
 * by `submittedAt` alone silently shows and hides the rows that share a
 * timestamp. `externalId` is a uuid v7, unique and indexed on all three
 * adapters, so the tiebreaker costs nothing and the page is exact. A model
 * that opted out of `externalId` gets no tiebreaker, and the guide says so.
 *
 * ## What can never be declared
 *
 * Refused at boot, naming the controller, the action and the field
 * (`HENRI_FILTER_DECLARATION_INVALID`):
 *
 * - a column the model does not have. A typo that filtered nothing would
 *   quietly answer the whole table.
 * - a **randomised `encrypted`** column, and any non-equality on a
 *   deterministic one. The adapters refuse exactly this
 *   (`HENRI_ENCRYPTION_NOT_QUERYABLE`), and a filter surface that got there
 *   at request time would be a 500 where the boot could have said so.
 * - a column marked `personal: { expose: false }`. henri promised that
 *   value never leaves; a filter over it hands it back one bit at a time,
 *   which is the same value with more steps. A field marked plain
 *   `personal: true` **is** filterable: it is in the answer already.
 * - a **declared foreign key**. Its public value is another row's
 *   `externalId` (`base/references.js`), so matching it is a lookup henri
 *   would have to make per term -- the same refusal
 *   `base/graphql-schema.js` makes, for the same reason. Resolve it in the
 *   controller and put the key in the scope.
 * - a `json` column: there is no comparison henri can spell on three
 *   adapters.
 *
 * ## The scope wins
 *
 * A client-supplied filter **narrows a list and can never widen it**. The
 * condition `req.filter()` answers is
 * `policy.scope(user) AND (what the client asked for)` -- an `and`, spelled
 * for the adapter, never a merge of keys. `base/graphql-resolvers.js` made
 * the same promise for the derived list query and could keep it by letting
 * the scope win key by key, because its `where` is a flat map of
 * equalities; here a client can put an operator on the very column a scope
 * constrains, and an `and` is the only merge that cannot widen. Two
 * conditions on one column intersect; they never replace each other.
 *
 * The scope is `policy.scope(user)` and it is asked for by default, which
 * is what makes this safe to reach for: an action that calls `req.filter()`
 * on a model whose policy declares no scope gets the refusal
 * `henri.policies.scope()` already gives rather than "everything". An
 * application whose list is genuinely public says so, once, in the call:
 * `req.filter({ scope: false })`, or hands over the condition it wants
 * intersected (`req.filter({ scope: { state: PUBLIC } })`).
 *
 * ## The links carry it
 *
 * Nothing to do, and that is the point: `pageLinks()` builds `next` and
 * `prev` out of the url as requested and only ever sets `page` and
 * `per_page` (`base/pagination.js`), so the filter and the sort ride along
 * and page two of a filtered list is page two of the same list. That is a
 * property worth a test rather than a change, and
 * `src/__tests__/filters.spec.js` has it.
 *
 * ## Deliberately not here
 *
 * No `or` between filters (a client composing boolean algebra is
 * `ransack`), no free-text search across columns (that is a search engine,
 * and henri is not one), no cursor paging, no filtering across an
 * association, and no operator an application can add: the vocabulary is
 * closed, because every word in it has to mean the same thing on three
 * adapters.
 */

const { kindOf } = require('./erasure');
const { fail } = require('./errors');
const { coerce, rule: compileRule, refuse } = require('./params-schema');
const { singularize } = require('./routes');

/** The controller exports that are never actions (see base/hooks.js) */
const RESERVED = new Set(['filters']);

/** The failure a request gets when it asks for something undeclared */
const CODE = 'HENRI_FILTER_INVALID';

/** What every answer says before the term messages */
const MESSAGE = 'the filters are invalid';

/** The query parameter that carries the order */
const SORT = 'sort';

/** The prefix of every query key that carries a filter */
const PREFIX = 'filter';

/** The column every order ends with, so a page is stable */
const TIEBREAK = 'externalId';

/** What `config.api` says about this when it says nothing */
const DEFAULTS = Object.freeze({ maxFilters: 8, maxSort: 3 });

/**
 * The operators, and what each of them takes.
 *
 * `shape` is what the request has to hold: `one` a value, `list` a list of
 * them, `pair` exactly two, `flag` a boolean. `text` is the mark that makes
 * an operator opt-in and its value a literal with no wildcard in it.
 */
const OPERATORS = Object.freeze({
  between: { ordered: true, shape: 'pair' },
  contains: { shape: 'one', text: true },
  ends: { shape: 'one', text: true },
  eq: { shape: 'one' },
  gt: { ordered: true, shape: 'one' },
  gte: { ordered: true, shape: 'one' },
  in: { shape: 'list' },
  lt: { ordered: true, shape: 'one' },
  lte: { ordered: true, shape: 'one' },
  ne: { shape: 'one' },
  nin: { shape: 'list' },
  null: { shape: 'flag' },
  starts: { shape: 'one', text: true },
});

/** Every operator name, for a message */
const NAMES = Object.keys(OPERATORS).sort();

/** The operators an equality gives every type */
const EQUALITY = ['eq', 'in', 'ne', 'nin', 'null'];

/** ... and the ones an ordered column adds */
const ORDERED = ['between', 'gt', 'gte', 'lt', 'lte'];

/**
 * The operators a deterministic `encrypted` column keeps. `null` is one of
 * them because it is spelled as an equality against null, which every
 * adapter's encryption translates by leaving alone: a column with no value
 * has no value in any scheme.
 */
const ENCRYPTABLE = ['eq', 'in', 'ne', 'nin', 'null'];

/** The types a range is a range over */
const COMPARABLE = new Set([
  'bigint',
  'date',
  'decimal',
  'float',
  'integer',
  'number',
]);

/** The types a text operator means anything for */
const TEXTUAL = new Set(['string', 'text']);

/** The types a column may not be ordered by */
const UNORDERABLE = new Set(['json', 'text']);

/** The keys a `where` entry may hold, on top of a parameter rule's own */
const EXTRA = ['column', 'operators'];

/** The keys one action's declaration may hold */
const KEYS = ['default', 'model', 'sort', 'where'];

/** What a text value may never carry: the wildcards of a SQL `LIKE` */
const WILDCARDS = ['%', '_'];

/** The characters a literal has to lose to become one inside a regex */
const ESCAPED = new Set([
  '$',
  '(',
  ')',
  '*',
  '+',
  '-',
  '.',
  '/',
  '?',
  '[',
  '\\',
  ']',
  '^',
  '{',
  '|',
  '}',
]);

/**
 * Is this a plain object?
 *
 * @param {*} value anything
 * @returns {boolean} true for a plain object
 */
const isObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * The failure a wrong declaration raises, naming where it is
 *
 * @param {string} where the controller and action
 * @param {string} what what is wrong
 * @param {string} [hint] what to do about it
 * @returns {Error} the error to throw
 */
const invalid = (where, what, hint) =>
  fail('HENRI_FILTER_DECLARATION_INVALID', `${where} ${what}`, { hint });

/**
 * A literal, as a regular expression source that matches it and nothing
 * else.
 *
 * Walked character by character rather than replaced through a pattern: a
 * value that reaches a regular expression from a request is walked and
 * never matched, and what comes out has no quantifier, no group and no
 * alternation in it -- so what MongoDB runs is a substring scan and not a
 * pattern a client wrote.
 *
 * @param {string} value the literal
 * @returns {string} the escaped source
 */
function escapeRegex(value) {
  let escaped = '';

  for (const character of String(value)) {
    escaped += ESCAPED.has(character) ? `\\${character}` : character;
  }

  return escaped;
}

/**
 * The action names a selector key stands for, the way `params` and `before`
 * read them
 *
 * @param {string} key the key of the `filters` block
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
 * The operators a field gets when it names none
 *
 * @param {string} type the declared type
 * @returns {Array<string>} the operator names, sorted
 */
function defaultOperators(type) {
  return COMPARABLE.has(type)
    ? [...EQUALITY, ...ORDERED].sort()
    : [...EQUALITY].sort();
}

/**
 * The operators one field accepts, checked against its type
 *
 * @param {object} source what the controller wrote
 * @param {object} rule the compiled parameter rule
 * @param {string} where the controller and action
 * @param {string} name the filter name
 * @returns {Array<string>} the operator names, sorted
 * @throws {Error} on an operator that is not one, or means nothing here
 */
function operatorsOf(source, rule, where, name) {
  if (typeof source.operators === 'undefined') {
    return defaultOperators(rule.type);
  }

  if (!Array.isArray(source.operators) || source.operators.length === 0) {
    throw invalid(
      where,
      `declares the filter "${name}" with an "operators" that is not a list of operator names`,
      `The operators are ${NAMES.join(', ')}`
    );
  }

  const wanted = new Set(defaultOperators(rule.type));

  for (const operator of source.operators) {
    if (!Object.prototype.hasOwnProperty.call(OPERATORS, operator)) {
      throw invalid(
        where,
        `declares the filter "${name}" with the unknown operator "${operator}"`,
        `The operators are ${NAMES.join(', ')}`
      );
    }

    if (OPERATORS[operator].text && !TEXTUAL.has(rule.type)) {
      throw invalid(
        where,
        `declares the filter "${name}" with "${operator}", which ${rule.type} does not take: it is for string and text`
      );
    }

    if (OPERATORS[operator].ordered && !COMPARABLE.has(rule.type)) {
      throw invalid(
        where,
        `declares the filter "${name}" with "${operator}", which ${rule.type} does not take: it is for ${[
          ...COMPARABLE,
        ]
          .sort()
          .join(', ')}`
      );
    }

    wanted.add(operator);
  }

  return [...wanted].sort();
}

/**
 * Compiles one `where` entry: a parameter rule, plus what may be asked of
 * it
 *
 * @param {*} written what the controller wrote
 * @param {string} where the controller and action
 * @param {string} name the filter name
 * @returns {object} the compiled entry
 * @throws {Error} when the entry holds something henri cannot carry out
 */
function entry(written, where, name) {
  if (typeof written !== 'string' && !isObject(written)) {
    throw invalid(
      where,
      `declares the filter "${name}" as ${
        written === null ? 'null' : typeof written
      }: a filter is an object, or the type itself`,
      "state: 'string', or state: { type: 'string', operators: ['eq'] }"
    );
  }

  const source = typeof written === 'string' ? { type: written } : written;
  const rest = {};

  for (const key of Object.keys(source)) {
    if (!EXTRA.includes(key)) {
      rest[key] = source[key];
    }
  }

  for (const key of ['default', 'required']) {
    if (key in rest) {
      throw invalid(
        where,
        `declares the filter "${name}" with "${key}": a filter is what a client may ask for, never what it has to ask for`,
        'The narrowing an action always applies belongs in the scope'
      );
    }
  }

  const rule = compileRule(rest, where, `${PREFIX}[${name}]`);

  if (rule.type === 'array' || rule.type === 'json') {
    throw invalid(
      where,
      `declares the filter "${name}" as ${rule.type}, which is not something a column is compared against`,
      'A list of accepted values is what `in` takes, and every filter has it'
    );
  }

  return Object.freeze({
    column:
      typeof source.column === 'string' && source.column.trim() !== ''
        ? source.column.trim()
        : name,
    name,
    operators: Object.freeze(operatorsOf(source, rule, where, name)),
    rule,
  });
}

/**
 * One sort term, from the spelling a request and a declaration share
 *
 * @param {string} spec the term (`title`, `-title`)
 * @param {object} sortable the sortable columns, by name
 * @returns {?object} `{ column, descending, name }`, or null when unknown
 */
function sortTerm(spec, sortable) {
  const descending = spec.startsWith('-');
  const name = descending ? spec.slice(1) : spec;

  if (!Object.prototype.hasOwnProperty.call(sortable, name)) {
    return null;
  }

  return { column: sortable[name], descending, name };
}

/**
 * The columns an action lets a client order by
 *
 * @param {*} written the `sort` key
 * @param {string} where the controller and action
 * @returns {object} the columns, by the name a client uses
 * @throws {Error} when it is not a list of names or a map of them
 */
function sortableOf(written, where) {
  if (typeof written === 'undefined' || written === null) {
    return {};
  }

  const sortable = {};
  /**
   * Refuses the `sort` key
   *
   * @returns {void} never returns
   * @throws {Error} always
   */
  const bad = () => {
    throw invalid(
      where,
      'declares a `sort` that is not a list of column names, or a map of the name a client writes to the column it means',
      "sort: ['title', 'createdAt'], or sort: { newest: 'createdAt' }"
    );
  };

  if (Array.isArray(written)) {
    for (const name of written) {
      if (typeof name !== 'string' || name.trim() === '') {
        bad();
      }

      sortable[name] = name;
    }

    return sortable;
  }

  if (!isObject(written)) {
    return bad();
  }

  for (const name of Object.keys(written)) {
    if (typeof written[name] !== 'string' || written[name].trim() === '') {
      bad();
    }

    sortable[name] = written[name];
  }

  return sortable;
}

/**
 * The order a declaration applies when the request asks for none
 *
 * @param {*} written the `default` key
 * @param {object} sortable the sortable columns, by name
 * @param {string} where the controller and action
 * @returns {Array<object>} the terms (`{ column, descending, name }`)
 * @throws {Error} when it names something a client could not name
 */
function defaultOrder(written, sortable, where) {
  if (typeof written === 'undefined' || written === null) {
    return [];
  }

  const terms = [];

  for (const spec of [].concat(written)) {
    if (typeof spec !== 'string' || spec.trim() === '') {
      throw invalid(
        where,
        "declares a default order that is not a name or a list of them ('-submittedAt', ['-submittedAt', 'title'])"
      );
    }

    const term = sortTerm(spec.trim(), sortable);

    if (!term) {
      throw invalid(
        where,
        `orders by "${spec.trim()}" by default, which is not one of the columns it lets a client sort by (${
          Object.keys(sortable).sort().join(', ') || 'it declares none'
        })`,
        'A default order names what a client may name: add it to `sort`'
      );
    }

    terms.push(Object.freeze(term));
  }

  return terms;
}

/**
 * Compiles one action's declaration
 *
 * @param {*} written the `filters` entry
 * @param {string} where the controller and action
 * @returns {object} the compiled declaration
 * @throws {Error} when it holds something henri cannot carry out
 */
function declaration(written, where) {
  if (!isObject(written)) {
    throw invalid(
      where,
      `declares filters as ${
        written === null ? 'null' : typeof written
      }: a declaration is an object ({ where, sort, default, model })`
    );
  }

  for (const key of Object.keys(written)) {
    if (!KEYS.includes(key)) {
      throw invalid(
        where,
        `declares filters with the unknown key "${key}": a declaration takes ${KEYS.join(', ')}`
      );
    }
  }

  if (typeof written.where !== 'undefined' && !isObject(written.where)) {
    throw invalid(
      where,
      'declares a `where` that is not a list of filters, one rule per name'
    );
  }

  if (
    typeof written.model !== 'undefined' &&
    (typeof written.model !== 'string' || written.model.trim() === '')
  ) {
    throw invalid(where, 'declares a `model` that is not a model name');
  }

  const fields = {};

  for (const name of Object.keys(written.where || {})) {
    fields[name] = entry(written.where[name], where, name);
  }

  const sortable = sortableOf(written.sort, where);

  if (Object.keys(fields).length === 0 && Object.keys(sortable).length === 0) {
    throw invalid(
      where,
      'declares filters with neither a `where` nor a `sort`: there is nothing a client could ask for',
      'Drop the declaration, or say what may be filtered and ordered'
    );
  }

  return Object.freeze({
    default: Object.freeze(defaultOrder(written.default, sortable, where)),
    model: typeof written.model === 'string' ? written.model.trim() : null,
    sort: Object.freeze(sortable),
    tiebreak: null,
    where: Object.freeze(fields),
  });
}

/**
 * Two raw declarations, the later one winning: `all` is the floor and the
 * action's own key is what sits on it
 *
 * @param {*} floor the declaration of a wider selector
 * @param {*} own the declaration of a narrower one
 * @returns {*} the merged declaration
 */
function merged(floor, own) {
  if (!isObject(floor) || !isObject(own)) {
    return own;
  }

  return {
    ...floor,
    ...own,
    where: { ...(floor.where || {}), ...(own.where || {}) },
  };
}

/**
 * The declarations of a controller, action by action.
 *
 * The same compiler the boot runs and `henri openapi` runs over the files,
 * for the reason `base/params-schema.js` gives about its own: there is one,
 * so both write the same document.
 *
 * @param {object} controller the controller module
 * @param {string} name the controller name (`tasks`, `admin/users`)
 * @param {Array<string>} actions the action names of the controller
 * @returns {object} the compiled declarations, keyed by action
 * @throws {Error} when a declaration cannot be carried out
 */
function declarations(controller, name, actions) {
  const block = controller && controller.filters;

  if (typeof block === 'undefined' || block === null) {
    return {};
  }

  if (!isObject(block)) {
    throw invalid(name, 'declares `filters` as something other than an object');
  }

  for (const key of Object.keys(block)) {
    for (const action of selects(key) || []) {
      if (!actions.includes(action)) {
        throw invalid(
          name,
          `declares filters for "${action}", which is not one of its actions (${
            actions.join(', ') || 'it has none'
          })`
        );
      }
    }
  }

  const compiled = {};

  for (const action of actions) {
    let found = null;

    for (const key of Object.keys(block)) {
      const only = selects(key);

      if (only === null || only.includes(action)) {
        found = found === null ? block[key] : merged(found, block[key]);
      }
    }

    if (found !== null) {
      compiled[action] = declaration(found, `${name}#${action}`);
    }
  }

  return compiled;
}

/**
 * The `encrypted` mark of a field, as the model file wrote it
 *
 * @param {*} definition the field definition
 * @returns {?object} `{ deterministic }`, or null
 */
function encryptionOf(definition) {
  const mark = definition && definition.encrypted;

  if (!mark) {
    return null;
  }

  return { deterministic: isObject(mark) && mark.deterministic === true };
}

/**
 * The model a field points at, when it says so (`references: { model }` on
 * the SQL adapters, `ref` on Mongoose)
 *
 * @param {*} definition the field definition
 * @returns {?string} the model name, or null
 */
function referenceOf(definition) {
  if (!isObject(definition)) {
    return null;
  }

  if (typeof definition.ref === 'string' && definition.ref.length > 0) {
    return definition.ref;
  }

  const model = isObject(definition.references) && definition.references.model;

  return typeof model === 'string' && model.length > 0 ? model : null;
}

/**
 * What a column has to be for a filter to be declared over it
 *
 * @param {object} field the compiled filter
 * @param {object} definition the column, as the model file wrote it
 * @param {object} context `{ hidden, model, where }`
 * @returns {void}
 * @throws {Error} HENRI_FILTER_DECLARATION_INVALID
 */
function checkFilterable(field, definition, { hidden, model, where }) {
  const encrypted = encryptionOf(definition);
  const reference = referenceOf(definition);

  if (hidden.has(field.column)) {
    throw invalid(
      where,
      `filters by "${field.name}", which ${model} marks personal: { expose: false }`,
      'A value henri never hands over is not one a client may search for: a filter over it answers the same value one bit at a time'
    );
  }

  if (reference) {
    throw invalid(
      where,
      `filters by "${field.name}", which is a declared reference to ${reference}`,
      `Its public value is a ${reference}'s externalId, which henri would have to look up per term: resolve it in the controller and put the key in the scope`
    );
  }

  if (String(definition.type) === 'json') {
    throw invalid(
      where,
      `filters by "${field.name}", which is a json column: there is no comparison henri can spell on three adapters`
    );
  }

  if (encrypted && !encrypted.deterministic) {
    throw invalid(
      where,
      `filters by "${field.name}", which ${model} encrypts with a randomised scheme`,
      'A randomised ciphertext is different every time it is written, so every adapter refuses a where over it (HENRI_ENCRYPTION_NOT_QUERYABLE). encrypted: { deterministic: true } keeps an equality'
    );
  }

  const beyond = encrypted
    ? field.operators.filter((operator) => !ENCRYPTABLE.includes(operator))
    : [];

  if (beyond.length > 0) {
    throw invalid(
      where,
      `filters by "${field.name}" with ${beyond.join(', ')}, and ${model} encrypts it: a deterministic column keeps an equality and nothing else`
    );
  }
}

/**
 * What a column has to be for an order to be declared over it
 *
 * @param {string} name the name a client writes
 * @param {string} column the column it means
 * @param {object} definition the column, as the model file wrote it
 * @param {object} context `{ hidden, model, where }`
 * @returns {void}
 * @throws {Error} HENRI_FILTER_DECLARATION_INVALID
 */
function checkSortable(name, column, definition, { hidden, model, where }) {
  if (hidden.has(column)) {
    throw invalid(
      where,
      `sorts by "${name}", which ${model} marks personal: { expose: false }`,
      'The order of a page is a reading of a value henri promised not to hand over'
    );
  }

  if (encryptionOf(definition)) {
    throw invalid(
      where,
      `sorts by "${name}", which ${model} encrypts`,
      'Every adapter refuses an order over an encrypted column (HENRI_ENCRYPTION_NOT_QUERYABLE): the rows would come back ordered by ciphertext'
    );
  }

  if (UNORDERABLE.has(String(definition.type))) {
    throw invalid(
      where,
      `sorts by "${name}", which is a ${definition.type} column`,
      `A ${definition.type} column has no bound and no order worth sorting by: the database answers it with a filesort over everything. Order by a string, a number or a date`
    );
  }
}

/**
 * Checks a compiled declaration against the model it filters, and binds the
 * two together.
 *
 * Everything here could only be found out once the models were loaded, and
 * every one of them fails the boot: a filter over a column that is not
 * there, or one the adapter would refuse at request time, is a 500 waiting
 * for the first client to ask for it.
 *
 * @param {object} compiled the compiled declaration
 * @param {object} context `{ columns, hidden, model, where }`
 * @returns {object} the declaration, with the model and the tiebreaker on it
 * @throws {Error} HENRI_FILTER_DECLARATION_INVALID
 */
function verify(compiled, { columns, hidden = new Set(), model, where }) {
  const named = model ? String(model) : 'the model';
  const known = Object.keys(columns).sort().join(', ');

  for (const field of Object.values(compiled.where)) {
    const definition = columns[field.column];

    if (!definition) {
      throw invalid(
        where,
        `filters by "${field.name}", which is not a column of ${named} (${known})`,
        'A filter names a column, or names the one it means with `column`'
      );
    }

    checkFilterable(field, definition, { hidden, model: named, where });
  }

  for (const [name, column] of Object.entries(compiled.sort)) {
    const definition = columns[column];

    if (!definition) {
      throw invalid(
        where,
        `sorts by "${name}", which is not a column of ${named} (${known})`
      );
    }

    checkSortable(name, column, definition, { hidden, model: named, where });
  }

  return Object.freeze({
    ...compiled,
    model: named,
    tiebreak: columns[TIEBREAK] ? TIEBREAK : null,
  });
}

/**
 * The model a declaration is about: the one it named, or the one the
 * controller is named after (`proposals` -> `Proposal`), which is how
 * `base/openapi.js` and `3.policies.js` resolve it.
 *
 * @param {Array<object>} models the model files
 * @param {object} compiled the compiled declaration
 * @param {string} controller the controller name (`proposals`)
 * @returns {?object} the model file, or null
 */
function modelFor(models, compiled, controller) {
  const wanted = compiled.model ? String(compiled.model).toLowerCase() : null;
  const last = String(controller).split('/').pop().toLowerCase();
  const singular = singularize(last);
  const named = (model) =>
    String(model.globalId).toLowerCase() === wanted ||
    String(model.identity || '').toLowerCase() === wanted;
  const guessed = (model) =>
    [singular, last].includes(
      String(model.identity || model.globalId).toLowerCase()
    );

  return (
    (models || []).find((model) => (wanted ? named(model) : guessed(model))) ||
    null
  );
}

/**
 * The filter a query key names, walked rather than matched.
 *
 * Express 5 parses a query string with `querystring`, so `filter[a][b]`
 * arrives as that literal key and nothing has been split for us. Walking it
 * is what keeps a request value away from a regular expression, and it is
 * also the only way to tell `filter[a][b]` from `filter[a][b][c]` rather
 * than letting the second one through as the first.
 *
 * @param {string} key the query key
 * @returns {?{name: string, operator: ?string}} the filter, or null when the
 *   key is not one
 */
function parseKey(key) {
  const head = `${PREFIX}[`;

  if (!key.startsWith(head)) {
    return null;
  }

  const close = key.indexOf(']', head.length);

  if (close <= head.length) {
    return null;
  }

  const name = key.slice(head.length, close);

  if (name.includes('[')) {
    return null;
  }

  if (close === key.length - 1) {
    return { name, operator: null };
  }

  if (key[close + 1] !== '[' || key[key.length - 1] !== ']') {
    return null;
  }

  const operator = key.slice(close + 2, key.length - 1);

  return operator.includes('[') || operator.includes(']')
    ? null
    : { name, operator };
}

/**
 * The items of a list a query string carried: repeated (`a=1&a=2`) or
 * written out (`a=1,2`). Split, never matched.
 *
 * @param {*} raw what arrived
 * @returns {Array<string>} the items
 */
function listOf(raw) {
  const values = Array.isArray(raw) ? raw : [raw];

  return values
    .flatMap((value) =>
      typeof value === 'string' ? value.split(',') : [value]
    )
    .map((value) => (typeof value === 'string' ? value.trim() : value))
    .filter((value) => value !== '');
}

/**
 * Is this an absent filter? A browser sends an empty value for every input
 * and every select nobody touched, and an index page is a form: an empty
 * value is the filter not being asked for, whatever the type.
 *
 * @param {*} raw what arrived
 * @returns {boolean} absent or not
 */
function absent(raw) {
  if (raw === null || typeof raw === 'undefined' || raw === '') {
    return true;
  }

  return Array.isArray(raw) && raw.every((value) => value === '');
}

/**
 * One filter value, through the rule its field declared
 *
 * @param {object} field the compiled filter
 * @param {string} operator the operator
 * @param {*} raw what arrived
 * @returns {{value: *}|{error: string}} the value, or what is wrong with it
 */
function valueOf(field, operator, raw) {
  const { shape } = OPERATORS[operator];

  if (shape === 'flag') {
    const answer = coerce({ type: 'boolean' }, raw, true);

    return answer.error ? answer : { value: answer.value === true };
  }

  if (shape === 'one') {
    if (Array.isArray(raw)) {
      return { error: 'was sent more than once' };
    }

    const answer = coerce(field.rule, raw, true);

    return answer.error || !OPERATORS[operator].text
      ? answer
      : literal(answer.value);
  }

  return several(field, operator, raw, shape === 'pair' ? 2 : 0);
}

/**
 * A text value: a literal, with no wildcard of its own
 *
 * @param {*} value the coerced value
 * @returns {{value: *}|{error: string}} the value, or what is wrong with it
 */
function literal(value) {
  const found = WILDCARDS.filter((wildcard) =>
    String(value).includes(wildcard)
  );

  if (found.length === 0) {
    return { value };
  }

  return {
    error: `may not contain ${found.join(' or ')}: a filter value is a literal, and henri does not read a wildcard from a request`,
  };
}

/**
 * A list of values, through the rule the field declared
 *
 * @param {object} field the compiled filter
 * @param {string} operator the operator
 * @param {*} raw what arrived
 * @param {number} exactly how many the operator takes, 0 for any number
 * @returns {{value: Array}|{error: string}} the values, or what is wrong
 */
function several(field, operator, raw, exactly) {
  const items = listOf(raw);

  if (exactly > 0 && items.length !== exactly) {
    return {
      error: `takes ${exactly} values (${PREFIX}[${field.name}][${operator}]=from,to)`,
    };
  }

  if (items.length === 0) {
    return { error: 'takes at least one value' };
  }

  const values = [];

  for (const item of items) {
    const answer = coerce(field.rule, item, true);

    if (answer.error) {
      return { error: answer.error };
    }

    if ('value' in answer) {
      values.push(answer.value);
    }
  }

  return values.length === 0
    ? { error: 'takes at least one value' }
    : { value: values };
}

/**
 * What a request asked to filter and order by, checked against what the
 * action declared
 *
 * @param {object} compiled the resolved declaration
 * @param {Express.Request} req the request
 * @param {object} [limits={}] `{ maxFilters, maxSort }`
 * @returns {{errors: object, sort: Array, terms: Array}} the messages by
 *   term, the order and the conditions
 */
function read(compiled, req, limits = {}) {
  const { maxFilters = DEFAULTS.maxFilters, maxSort = DEFAULTS.maxSort } =
    limits;
  const query = (req && req.query) || {};
  const errors = {};
  const terms = [];
  const accepts = Object.keys(compiled.where).sort().join(', ');

  for (const key of Object.keys(query)) {
    const parsed = parseKey(key);

    if (!parsed) {
      continue;
    }

    const field = compiled.where[parsed.name];

    if (!field) {
      errors[key] =
        `is not a filter ${compiled.model} accepts here (${accepts || 'this action declares none'})`;
      continue;
    }

    const operator = parsed.operator === null ? 'eq' : parsed.operator;

    if (!field.operators.includes(operator)) {
      errors[key] =
        `does not take "${operator}" (${field.operators.join(', ')})`;
      continue;
    }

    if (absent(query[key])) {
      continue;
    }

    const answer = valueOf(field, operator, query[key]);

    if (answer.error) {
      errors[key] = answer.error;
      continue;
    }

    terms.push({
      column: field.column,
      name: field.name,
      operator,
      value: answer.value,
    });
  }

  if (terms.length > maxFilters) {
    errors[PREFIX] =
      `carries ${terms.length} filters, and this application takes at most ${maxFilters} (config.api.maxFilters)`;
  }

  return { errors, sort: sortOf(compiled, query, errors, maxSort), terms };
}

/**
 * The order a request asked for, or the one the action declared
 *
 * @param {object} compiled the resolved declaration
 * @param {object} query the query string
 * @param {object} errors the messages so far, added to
 * @param {number} maxSort the most terms a request may carry
 * @returns {Array<object>} the terms
 */
function sortOf(compiled, query, errors, maxSort) {
  const raw = query[SORT];

  if (absent(raw)) {
    return [...compiled.default];
  }

  if (Array.isArray(raw)) {
    errors[SORT] = 'was sent more than once';

    return [];
  }

  const wanted = String(raw)
    .split(',')
    .map((spec) => spec.trim())
    .filter(Boolean);
  const names = Object.keys(compiled.sort).sort().join(', ');
  const terms = [];
  const seen = new Set();

  if (wanted.length > maxSort) {
    errors[SORT] =
      `names ${wanted.length} columns, and this application orders by at most ${maxSort} (config.api.maxSort)`;

    return [];
  }

  for (const spec of wanted) {
    const term = sortTerm(spec, compiled.sort);

    if (!term) {
      errors[SORT] =
        `cannot order by "${spec}" (${names || 'this action declares no sortable column'})`;

      return [];
    }

    if (!seen.has(term.name)) {
      seen.add(term.name);
      terms.push(term);
    }
  }

  return terms;
}

/**
 * The failure an adapter henri cannot drive raises
 *
 * @param {*} Model an ORM model
 * @returns {Error} the error to throw
 */
const unsupported = (Model) =>
  fail(
    'HENRI_FILTER_ADAPTER_UNSUPPORTED',
    `unable to build a condition for ${
      (Model && Model.modelName) || 'this model'
    }: its adapter is not one henri knows how to drive`,
    {
      hint: 'A filter goes through the model API of the three adapters henri ships: mongoose, sequelize and drizzle',
    }
  );

/**
 * Sequelize's operator symbols, taken from the model's own connection
 *
 * @param {*} Model a Sequelize model
 * @returns {object} `Op`
 * @throws {Error} when the model is not attached to a connection
 */
function symbolsOf(Model) {
  const sequelize = Model.sequelize || {};
  const { Op } = sequelize.Sequelize || sequelize.constructor || {};

  if (!Op) {
    throw unsupported(Model);
  }

  return Op;
}

/**
 * The pattern a text operator compares against, as a `LIKE` reads it. The
 * value carries no wildcard of its own (`literal()` refused it), so the
 * only `%` in here is the one henri put there.
 *
 * @param {string} operator the operator
 * @param {*} value the value
 * @returns {string} the pattern
 */
function pattern(operator, value) {
  if (operator === 'starts') {
    return `${value}%`;
  }

  return operator === 'ends' ? `%${value}` : `%${value}%`;
}

/**
 * ... and as a MongoDB `$regex` reads it, from a fully escaped literal
 *
 * @param {string} operator the operator
 * @param {*} value the value
 * @returns {object} the condition
 */
function expression(operator, value) {
  const escaped = escapeRegex(value);
  const anchored = {
    contains: escaped,
    ends: `${escaped}$`,
    starts: `^${escaped}`,
  };

  return { $options: 'i', $regex: anchored[operator] };
}

/**
 * One term as Mongoose and Drizzle both read it (the `$` spellings)
 *
 * @param {object} term the term
 * @param {string} kind the adapter (`drizzle` or `mongoose`)
 * @returns {object} the comparison, by operator
 */
function dollar(term, kind) {
  const { operator, value } = term;

  if (operator === 'between') {
    return { $gte: value[0], $lte: value[1] };
  }

  if (operator === 'null') {
    return value === true ? { $eq: null } : { $ne: null };
  }

  if (!OPERATORS[operator].text) {
    return { [`$${operator}`]: value };
  }

  return kind === 'mongoose'
    ? expression(operator, value)
    : { $ilike: pattern(operator, value) };
}

/**
 * ... and as Sequelize reads it
 *
 * @param {object} term the term
 * @param {object} Op Sequelize's operator symbols
 * @param {string} dialect the dialect of the connection
 * @returns {object} the comparison, by operator symbol
 */
function symbolic(term, Op, dialect) {
  const { operator, value } = term;
  const named = {
    eq: Op.eq,
    gt: Op.gt,
    gte: Op.gte,
    in: Op.in,
    lt: Op.lt,
    lte: Op.lte,
    ne: Op.ne,
    nin: Op.notIn,
  };

  if (operator === 'between') {
    return { [Op.gte]: value[0], [Op.lte]: value[1] };
  }

  // An equality against null, not `Op.is`: Sequelize writes `IS NULL` for
  // it, and it is the spelling an encrypted column's translation reads
  if (operator === 'null') {
    return value === true ? { [Op.eq]: null } : { [Op.ne]: null };
  }

  if (!OPERATORS[operator].text) {
    return { [named[operator]]: value };
  }

  const like = dialect === 'postgres' && Op.iLike ? Op.iLike : Op.like;

  return { [like]: pattern(operator, value) };
}

/**
 * The terms a request asked for, as the adapter's own condition.
 *
 * Two terms on one column are one comparison with two keys, so
 * `?filter[at][gte]=x&filter[at][lte]=y` is a range and not the second
 * clause overwriting the first.
 *
 * @param {*} Model an ORM model
 * @param {Array<object>} terms the terms
 * @returns {object} the condition
 * @throws {Error} HENRI_FILTER_ADAPTER_UNSUPPORTED
 */
function conditionFor(Model, terms) {
  const kind = kindOf(Model);

  if (kind === null) {
    throw unsupported(Model);
  }

  const sequelize = kind === 'sequelize';
  const Op = sequelize ? symbolsOf(Model) : null;
  const dialect =
    sequelize && typeof Model.sequelize.getDialect === 'function'
      ? Model.sequelize.getDialect()
      : null;
  const condition = {};

  for (const term of terms) {
    const comparison = sequelize
      ? symbolic(term, Op, dialect)
      : dollar(term, kind);

    condition[term.column] = Object.assign(
      {},
      condition[term.column],
      comparison
    );
  }

  return condition;
}

/**
 * The order a request asked for, as the adapter's own, with the tiebreaker
 * that makes a page stable appended
 *
 * @param {*} Model an ORM model
 * @param {Array<object>} terms the sort terms
 * @param {?string} [tiebreak=null] the column every order ends with
 * @returns {object|Array} the order
 * @throws {Error} HENRI_FILTER_ADAPTER_UNSUPPORTED
 */
function orderFor(Model, terms, tiebreak = null) {
  const kind = kindOf(Model);

  if (kind === null) {
    throw unsupported(Model);
  }

  const columns = terms.map((term) => [
    term.column,
    term.descending ? 'desc' : 'asc',
  ]);

  if (tiebreak && !columns.some(([column]) => column === tiebreak)) {
    columns.push([tiebreak, 'asc']);
  }

  if (kind === 'sequelize') {
    return columns.map(([column, direction]) => [
      column,
      direction.toUpperCase(),
    ]);
  }

  return Object.fromEntries(columns);
}

/**
 * The scope and the client's condition, intersected.
 *
 * An `and`, spelled for the adapter: a filter narrows a list and can never
 * widen it, and two conditions on one column have to hold at once rather
 * than replace each other.
 *
 * @param {*} Model an ORM model
 * @param {*} scope what the policy answered, or null
 * @param {object} condition what the client asked for
 * @returns {*} the condition to query with
 * @throws {Error} HENRI_FILTER_SCOPE_UNMERGEABLE
 */
function narrow(Model, scope, condition) {
  const asked = Object.keys(condition).length > 0;
  const scoped = scope !== null && typeof scope !== 'undefined';

  if (!scoped) {
    return condition;
  }

  if (!asked) {
    return scope;
  }

  if (!isObject(scope)) {
    throw fail(
      'HENRI_FILTER_SCOPE_UNMERGEABLE',
      'the policy scope is not a condition a filter can narrow',
      {
        hint: 'A scope that is not a plain object is handed to the ORM as it is, so henri cannot put a filter under it: answer a plain object from scope(user), or hand req.filter() the condition to intersect',
      }
    );
  }

  if (Object.keys(scope).length === 0) {
    return condition;
  }

  const parts = [scope, condition];

  return kindOf(Model) === 'sequelize'
    ? { [symbolsOf(Model)['and']]: parts }
    : { $and: parts };
}

/**
 * The middleware checking one action's filters.
 *
 * It runs where the parameter check runs -- behind the role and the policy
 * guards, ahead of the `before` hooks -- so a request that may not reach
 * the action is never told what it could have filtered by.
 *
 * @param {object} compiled the resolved declaration
 * @param {function(): object} limits answers `{ maxFilters, maxSort }`
 * @returns {function} express middleware
 */
function guard(compiled, limits) {
  return (req, res, next) => {
    let result;

    try {
      result = read(compiled, req, limits());
    } catch (error) {
      return next(error);
    }

    if (Object.keys(result.errors).length > 0) {
      return refuse(req, res, result.errors, { code: CODE, message: MESSAGE });
    }

    req._filters = {
      declaration: compiled,
      sort: result.sort,
      terms: result.terms,
    };

    return next();
  };
}

module.exports = {
  CODE,
  DEFAULTS,
  ENCRYPTABLE,
  EQUALITY,
  KEYS,
  MESSAGE,
  NAMES,
  OPERATORS,
  ORDERED,
  PREFIX,
  RESERVED,
  SORT,
  TIEBREAK,
  UNORDERABLE,
  conditionFor,
  declaration,
  declarations,
  defaultOperators,
  encryptionOf,
  escapeRegex,
  guard,
  modelFor,
  narrow,
  orderFor,
  parseKey,
  read,
  referenceOf,
  sortTerm,
  verify,
};
