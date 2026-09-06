/**
 * Retention: how long a model keeps its records, and what removes them when
 * the time is up.
 *
 * An erasure answers a person who asked. Retention answers nobody: it is the
 * promise an application already made in its privacy policy -- "we keep
 * proposals for two years" -- and the only way to keep that promise is for
 * something to run while nobody is watching. So the rule is written where
 * the promise is about, in the model, and henri sweeps.
 *
 * ```js
 * // app/models/Proposal.js
 * options: {
 *   retention: {
 *     action: 'anonymize',
 *     after: '2y',
 *     from: 'decidedAt',
 *   },
 * },
 * ```
 *
 * A model with more than one class of records writes a list, and each entry
 * names itself:
 *
 * ```js
 * retention: [
 *   { after: '30d', name: 'drafts', where: { state: 'draft' } },
 *   { action: 'anonymize', after: '2y', from: 'decidedAt', name: 'decided' },
 * ],
 * ```
 *
 * ## What retention does to a record
 *
 * One of the three verbs henri already has, and no fourth:
 *
 * - `delete` (the default): the row goes, for real, `deletedAt` stamp or
 *   not. A soft delete is a hidden row, and a hidden row is still held.
 * - `soft-delete`: the row is stamped `deletedAt` and stops being returned.
 *   Only on a model that declared `options: { paranoid: true }` -- asking
 *   for it elsewhere is refused rather than quietly turned into a delete,
 *   because "we removed it after 90 days" and "we hid it after 90 days" are
 *   different sentences.
 * - `anonymize`: exactly what an erasure writes -- the fields the model
 *   marked `personal` get the values of `base/erasure.js`, the row and every
 *   foreign key pointing at it survive. A model that marks no field personal
 *   cannot be anonymized: the sweep would touch nothing and report success,
 *   which is the worst thing a compliance feature can do.
 *
 * ## What it is measured from
 *
 * `from`, a date field of the model. It defaults to `createdAt` and
 * `createdAt` is usually the wrong answer: a record's clock rarely starts
 * when the row was inserted. A proposal is kept for two years *after the
 * decision*, an account for a year *after it closed*, a booking for seven
 * years *after the stay*. Naming the column is how the model says which
 * event starts the clock.
 *
 * A record whose `from` column is null has not started its clock and is
 * never swept -- an open ticket does not age out. The plan counts those
 * separately (`waiting`) so that a rule quietly matching nothing is visible
 * rather than reassuring.
 *
 * ## What enforces it
 *
 * `henri.retention.sweep()`, which is core and needs nothing installed.
 * Three things call it:
 *
 * - `henri retention:sweep`, which boots to runlevel 4, binds no port and is
 *   what a cron line runs.
 * - the recurring job `henri/retention`, when the application has
 *   `@usehenri/jobs`: `config.retention.schedule` is a cron expression and
 *   henri registers the schedule itself.
 * - an application calling it, from a page of its own.
 *
 * The queue is a package an application installs, so it is never assumed.
 * An application with retention rules and no schedule is told at boot, by
 * name, what is not running and the command line that would run it.
 *
 * ## What proves it ran, and what happens when it is interrupted
 *
 * A receipt, the shape the erasure already writes, in
 * `config.retention.receipts`: the rules that ran, what each of them did,
 * how many records remain, and a digest of the rule rather than the rows.
 * With `henri.trail` on, every rule is also one appended, hash-chained
 * event.
 *
 * A sweep is not a transaction and does not need to be one. Every rule is a
 * query over the age of a row, so a sweep that dies halfway leaves the rest
 * exactly as the next sweep will find it -- a resumable operation, because
 * it is a filter and not a cursor. The receipt of an interrupted sweep says
 * which rules ran, which failed and which were never reached.
 *
 * ## Refusing to be a foot-gun
 *
 * A wrong retention rule deletes production data on a schedule, quietly,
 * for as long as nobody looks. Two things stand in the way:
 *
 * - **A rule nobody approved never writes.** Every rule has a token --
 *   `Model:name:<digest of its terms>` -- and the sweep applies a rule only
 *   when `config.retention.approved` holds its token. The digest is plain
 *   rather than keyed: a token is committed to the configuration and has to
 *   mean the same thing in every environment. A new rule, or a rule
 *   whose `after`, `from`, `action` or `where` changed, is `pending`: it is
 *   planned, counted and reported, and it writes nothing. Approving is a
 *   line in `config/<env>.json`, which means a person, a diff and a review.
 *   `config.retention.approve: false` gives that up on purpose.
 * - **A run is bounded.** `config.retention.batch` (1000) is how many
 *   records one rule may touch in one sweep; the rest is reported as
 *   `remaining` and taken by the next run. A mistyped `'2h'` where `'2y'`
 *   was meant cannot take the table out in one pass.
 *
 * And the command is a dry run unless it is told otherwise: `henri
 * retention:sweep` without `--yes` plans and writes nothing.
 *
 * @module base/retention
 */

const { createHash } = require('node:crypto');

const { fail } = require('./errors');
const { isPlainObject } = require('./privacy');
const {
  deleteRecords,
  erasedValues,
  findRecords,
  identify,
  kindOf,
  primaryOf,
  updateRecords,
} = require('./erasure');

/** What `retention.action` accepts */
const ACTIONS = ['anonymize', 'delete', 'soft-delete'];

/** The action of a rule that does not name one */
const DEFAULT_ACTION = 'delete';

/** The column a rule measures from unless it names another */
const DEFAULT_FROM = 'createdAt';

/** How many records one rule may touch in one sweep */
const DEFAULT_BATCH = 1000;

/** Where the receipts are written, unless the configuration says */
const DEFAULT_RECEIPTS = 'privacy';

/** The version of the receipt document */
const VERSION = 1;

/** How many identifiers a receipt keeps: a sample, never an index */
const SAMPLE = 20;

/**
 * The units a retention period is written in.
 *
 * Longer than everywhere else in henri, which stops at weeks, because this
 * is the one setting measured in years: `'90d'`, `'18mo'`, `'7y'`. `mo` and
 * `y` are the calendar's rough shapes (30 and 365 days), which is what a
 * retention promise means -- nobody keeps a record for exactly the leap
 * seconds longer.
 */
const UNITS = {
  d: 86400000,
  h: 3600000,
  m: 60000,
  mo: 2592000000,
  ms: 1,
  s: 1000,
  w: 604800000,
  y: 31536000000,
};

/** An amount, then a unit. `ms` and `mo` come before the single letters */
const PERIOD = /^(\d+(?:\.\d+)?)\s*(ms|mo|[smhdwy])?$/iu;

/** The shortest period a rule may declare: under this it is a typo */
const MINIMUM = 60000;

/**
 * A coded failure carrying what to do about it
 *
 * @param {string} code one of the catalogue's codes
 * @param {string} message what went wrong
 * @param {string} hint what to do about it
 * @returns {Error} the error to throw
 */
function refuse(code, message, hint) {
  const error = fail(code, message);

  error.hint = hint;

  return error;
}

/**
 * A retention period in milliseconds (`'2y'`, `'18mo'`, `'90d'`)
 *
 * @param {*} value what was written
 * @returns {?number} the period, or null when it cannot be read
 */
function period(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const match = PERIOD.exec(value.trim());

  if (!match) {
    return null;
  }

  const amount = Number(match[1]) * UNITS[(match[2] || 'ms').toLowerCase()];

  return amount > 0 ? Math.round(amount) : null;
}

/**
 * The date fields of a model, by name: what `from` may point at
 *
 * @param {object} model a model file
 * @returns {Set<string>} the names
 */
function datesOf(model) {
  const schema = (model && model.schema) || {};
  const names = new Set(['createdAt', 'deletedAt', 'updatedAt']);

  for (const field of Object.keys(schema)) {
    const definition = schema[field];

    if (definition === Date) {
      names.add(field);
    }

    if (isPlainObject(definition) && definition.type === 'date') {
      names.add(field);
    }
  }

  return names;
}

/**
 * The token of a rule: what `config.retention.approved` holds.
 *
 * It covers the terms that decide which records are touched and what
 * happens to them, so a rule whose `after` moved from two years to two
 * hours is a different rule and has to be approved again.
 *
 * It is a plain digest and not a keyed one, deliberately. A token is an
 * identifier, not a capability: it is committed to `config/<env>.json` and
 * has to mean the same thing on a laptop, in the test suite and in
 * production, where `config.secret` does not. Anybody who can add a token
 * to the configuration can also set `approve: false`, so a key would buy
 * nothing and cost the one property that makes approving reviewable.
 *
 * @param {object} rule a normalized rule
 * @returns {string} `Model:name:<12 hex>`
 */
function tokenOf(rule) {
  const terms = JSON.stringify([
    rule.model,
    rule.name,
    rule.action,
    rule.after,
    rule.from,
    rule.where,
  ]);
  const digest = createHash('sha256').update(terms).digest('hex');

  return `${rule.model}:${rule.name}:${digest.slice(0, 12)}`;
}

/**
 * One rule of one model, checked against what the model can do
 *
 * @param {object} model a model file
 * @param {*} declared what `options.retention` (or one of its entries) holds
 * @param {object} context the context
 * @param {number} context.index the position in the list, for a default name
 * @param {object} context.fields the personal fields of the model
 * @returns {object} the normalized rule
 * @throws HENRI_RETENTION_INVALID_RULE when the rule cannot be carried out
 */
function ruleOf(model, declared, { index, fields }) {
  const name = model.globalId;
  const value = isPlainObject(declared) ? declared : {};
  const label =
    typeof value.name === 'string' && value.name.trim() !== ''
      ? value.name.trim()
      : String(index === 0 ? 'default' : index);
  const where = `${name}.options.retention${
    label === 'default' ? '' : ` (${label})`
  }`;

  if (!isPlainObject(declared)) {
    throw refuse(
      'HENRI_RETENTION_INVALID_RULE',
      `${where}: a retention rule is an object ({ after, action, from, where }), not ${typeof declared}`,
      "Write it as options: { retention: { after: '2y' } }, or a list of those"
    );
  }

  const after = period(value.after);
  const action = value.action || DEFAULT_ACTION;
  const from = value.from || DEFAULT_FROM;

  if (after === null) {
    throw refuse(
      'HENRI_RETENTION_INVALID_RULE',
      `${where}: 'after' is how long the records are kept ('90d', '18mo', '2y'), and ${JSON.stringify(
        value.after
      )} cannot be read as one`,
      'Write a number of milliseconds, or a string: ms, s, m, h, d, w, mo, y'
    );
  }

  if (after < MINIMUM) {
    throw refuse(
      'HENRI_RETENTION_INVALID_RULE',
      `${where}: 'after' is ${JSON.stringify(value.after)}, which is under a minute`,
      'A retention period is measured in days, months or years; anything shorter is a queue, not a policy'
    );
  }

  if (!ACTIONS.includes(action)) {
    throw refuse(
      'HENRI_RETENTION_INVALID_RULE',
      `${where}: 'action' must be one of ${ACTIONS.join(', ')}, not ${JSON.stringify(action)}`,
      'henri has three verbs for taking a record away, and retention uses those three'
    );
  }

  if (!datesOf(model).has(from)) {
    throw refuse(
      'HENRI_RETENTION_INVALID_RULE',
      `${where}: 'from' names ${from}, which is not a date field of ${name}`,
      "The clock starts on a date column of the model: { from: 'decidedAt' }, or leave it out for createdAt"
    );
  }

  if (action === 'soft-delete' && !(model.options || {}).paranoid) {
    throw refuse(
      'HENRI_RETENTION_INVALID_RULE',
      `${where}: 'soft-delete' needs options: { paranoid: true } on ${name}`,
      "Add the soft delete to the model, or say what you mean: action: 'delete'"
    );
  }

  if (action === 'anonymize' && Object.keys(fields || {}).length === 0) {
    throw refuse(
      'HENRI_RETENTION_INVALID_RULE',
      `${where}: 'anonymize' has nothing to write over: no field of ${name} is marked personal`,
      "Mark the fields that are about a person ({ personal: true }), or use action: 'delete'"
    );
  }

  if (
    typeof value.where !== 'undefined' &&
    value.where !== null &&
    !isPlainObject(value.where)
  ) {
    throw refuse(
      'HENRI_RETENTION_INVALID_RULE',
      `${where}: 'where' is the condition that picks the class of records, and has to be an object`,
      "Write it the way a query is written: where: { state: 'withdrawn' }"
    );
  }

  return {
    action,
    after,
    from,
    model: name,
    name: label,
    where: isPlainObject(value.where) ? { ...value.where } : {},
  };
}

/**
 * Every retention rule of every model, in model order
 *
 * @param {Array<object>} models the model files (`henri.model.models`)
 * @param {object} [options={}] options
 * @param {function} [options.fields] `(globalId) => the personal fields`
 * @returns {Array<object>} the rules, each with its token
 * @throws HENRI_RETENTION_INVALID_RULE on the first rule that cannot run
 */
function rulesOf(models, { fields = () => ({}) } = {}) {
  const rules = [];

  for (const model of models || []) {
    const declared = ((model && model.options) || {}).retention;

    if (
      typeof declared === 'undefined' ||
      declared === null ||
      declared === false
    ) {
      continue;
    }

    const list = Array.isArray(declared) ? declared : [declared];
    const seen = new Set();

    for (const [index, entry] of list.entries()) {
      const rule = ruleOf(model, entry, {
        fields: fields(model.globalId),
        index,
      });

      if (seen.has(rule.name)) {
        throw refuse(
          'HENRI_RETENTION_INVALID_RULE',
          `${model.globalId}.options.retention: two rules are called "${rule.name}"`,
          "Every rule of a model needs a name of its own: { name: 'drafts' }"
        );
      }

      seen.add(rule.name);
      rules.push({ ...rule, token: tokenOf(rule) });
    }
  }

  return rules;
}

/**
 * Where the receipts go: a directory, or false to write none
 *
 * @param {*} value what `retention.receipts` holds
 * @returns {(string|boolean)} the directory, or false
 */
function receiptsOf(value) {
  if (value === false) {
    return false;
  }

  return typeof value === 'string' && value !== '' ? value : DEFAULT_RECEIPTS;
}

/**
 * The `retention` configuration, normalized
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @returns {object} `{ approve, approved, batch, receipts, schedule }`
 */
function retentionConfig(config) {
  const has =
    config && typeof config.has === 'function' && config.has('retention');
  const raw = has ? config.get('retention') : {};
  const settings = isPlainObject(raw) ? raw : {};
  const batch = settings.batch === false ? false : Number(settings.batch);

  return {
    approve: settings.approve !== false,
    approved: Array.isArray(settings.approved)
      ? settings.approved.map((token) => String(token))
      : [],
    batch:
      settings.batch === false
        ? false
        : (Number.isFinite(batch) && batch > 0 && Math.round(batch)) ||
          DEFAULT_BATCH,
    receipts: receiptsOf(settings.receipts),
    schedule:
      typeof settings.schedule === 'string' && settings.schedule.trim() !== ''
        ? settings.schedule.trim()
        : false,
  };
}

/**
 * The condition matching the records a rule has come for.
 *
 * The three adapters spell a comparison differently and henri depends on
 * none of them: Sequelize's operators are symbols taken from the model's own
 * connection, Mongoose and drizzle both read `$lte`.
 *
 * @param {*} Model an ORM model
 * @param {object} rule a normalized rule
 * @param {Date} cutoff the moment a record has to be older than
 * @returns {object} the condition
 * @throws HENRI_RETENTION_ADAPTER_UNSUPPORTED on an adapter henri cannot drive
 */
function whereFor(Model, rule, cutoff) {
  const kind = kindOf(Model);
  const extra = { ...rule.where };

  // A soft delete never comes for a row that is already hidden: it would
  // move the stamp and report work that took nothing away
  if (rule.action === 'soft-delete') {
    extra.deletedAt = null;
  }

  if (kind === 'sequelize') {
    const sequelize = Model.sequelize || {};
    const { Op } = sequelize.Sequelize || sequelize.constructor || {};

    if (!Op) {
      throw refuse(
        'HENRI_RETENTION_ADAPTER_UNSUPPORTED',
        `unable to sweep ${rule.model}: its Sequelize model is not attached to a connection`,
        'The sweep runs on the models henri booted; start the application first'
      );
    }

    return { ...extra, [rule.from]: { [Op.lte]: cutoff } };
  }

  if (kind === 'drizzle' || kind === 'mongoose') {
    return { ...extra, [rule.from]: { $lte: cutoff } };
  }

  throw refuse(
    'HENRI_RETENTION_ADAPTER_UNSUPPORTED',
    `unable to sweep ${rule.model}: its adapter is not one henri knows how to drive`,
    'Retention goes through the model API of the three adapters henri ships: mongoose, sequelize and drizzle'
  );
}

/**
 * The condition matching the records whose clock has not started
 *
 * @param {object} rule a normalized rule
 * @returns {object} the condition
 */
function waitingFor(rule) {
  return { ...rule.where, [rule.from]: null };
}

/**
 * Soft deletes every record matching a condition: the stamp, not the row.
 *
 * `versions: false` for the reason `base/erasure.js` gives about its own
 * mass writes: a sweep changes rows a rule chose rather than a person did,
 * and a mass write on a versioned model is refused
 * (`HENRI_VERSION_MASS_WRITE`). A rule that has to leave a version behind
 * is a rule an application writes as a job over the records.
 *
 * @param {*} Model an ORM model
 * @param {object} where the condition
 * @returns {Promise<number>} how many records were stamped
 * @throws HENRI_RETENTION_ADAPTER_UNSUPPORTED on an unknown adapter
 */
async function softDeleteRecords(Model, where) {
  const kind = kindOf(Model);

  if (kind === 'drizzle') {
    return Model.where(where).destroy({ versions: false });
  }

  if (kind === 'mongoose') {
    const result = await Model.deleteMany(where, { versions: false });

    return (result && (result.deletedCount || result.modifiedCount)) || 0;
  }

  if (kind === 'sequelize') {
    return Model.destroy({ versions: false, where });
  }

  throw refuse(
    'HENRI_RETENTION_ADAPTER_UNSUPPORTED',
    'unable to soft delete these records: their adapter is not one henri knows how to drive',
    'Retention goes through the model API of the three adapters henri ships'
  );
}

/**
 * How many records match a condition, without reading them
 *
 * @param {*} Model an ORM model
 * @param {object} where the condition
 * @returns {Promise<number>} the count
 */
async function countRecords(Model, where) {
  const kind = kindOf(Model);

  if (kind === 'drizzle') {
    return Model.withDeleted().where(where).count();
  }

  if (kind === 'mongoose') {
    return Model.countDocuments(where).setOptions({ withDeleted: true });
  }

  if (kind === 'sequelize') {
    return Model.count({ paranoid: false, where });
  }

  return (await findRecords(Model, where)).length;
}

/**
 * The first `limit` records matching a condition, soft-deleted ones included
 *
 * @param {*} Model an ORM model
 * @param {object} where the condition
 * @param {number} limit how many
 * @returns {Promise<Array>} the records
 */
async function findSome(Model, where, limit) {
  const kind = kindOf(Model);

  if (kind === 'drizzle') {
    return Model.find(where, { limit, withDeleted: true });
  }

  if (kind === 'mongoose') {
    return Model.find(where).setOptions({ withDeleted: true }).limit(limit);
  }

  if (kind === 'sequelize') {
    return Model.findAll({ limit, paranoid: false, where });
  }

  return (await findRecords(Model, where)).slice(0, limit);
}

/**
 * Why a rule may not write, or nothing
 *
 * @param {object} rule a normalized rule
 * @param {object} settings the retention settings
 * @returns {?string} `'pending'`, or null when it is approved
 */
function gateOf(rule, settings) {
  if (!settings.approve) {
    return null;
  }

  return settings.approved.includes(rule.token) ? null : 'pending';
}

/**
 * Whether a rule is the one `--only` named (`Proposal`, `Proposal:drafts`)
 *
 * @param {object} rule a normalized rule
 * @param {string} wanted what was asked for
 * @returns {boolean} true when it matches
 */
function matches(rule, wanted) {
  const [model, name] = String(wanted).split(':');

  if (model && model.toLowerCase() !== rule.model.toLowerCase()) {
    return false;
  }

  return !name || name === rule.name;
}

/**
 * What an `anonymize` rule writes over the records it comes for
 *
 * @param {object} rule a normalized rule
 * @param {object} fields the personal fields of the model
 * @returns {{values: object, problems: Array<object>}} the values, and what
 *   stands in the way of writing them
 */
function valuesFor(rule, fields) {
  if (rule.action !== 'anonymize') {
    return { problems: [], values: {} };
  }

  const { problems, values } = erasedValues(
    { fields, name: rule.model },
    'retained'
  );

  if (problems.length === 0 && Object.keys(values).length === 0) {
    problems.push({
      message: `${rule.model}: every personal field is marked 'erase: retain', so anonymizing writes nothing`,
      model: rule.model,
      problem: 'nothing-to-write',
    });
  }

  return { problems, values };
}

/**
 * What a sweep would do, rule by rule. Nothing is written here.
 *
 * @param {object} context the context
 * @param {Array<object>} context.rules the normalized rules
 * @param {object} context.settings the retention settings
 * @param {function} context.modelOf `(name) => the ORM model`
 * @param {function} context.fieldsOf `(name) => the personal fields`
 * @param {object} [options={}] `only`, `now`
 * @returns {Promise<object>} the plan
 */
async function planOf({ rules, settings, modelOf, fieldsOf }, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const only = options.only || null;
  const steps = [];

  for (const rule of rules) {
    if (only && !matches(rule, only)) {
      continue;
    }

    const Model = modelOf(rule.model);
    const cutoff = new Date(now.getTime() - rule.after);
    const matched = await countRecords(Model, whereFor(Model, rule, cutoff));
    const waiting = await countRecords(Model, waitingFor(rule));
    const take =
      settings.batch === false ? matched : Math.min(matched, settings.batch);
    const { problems, values } = valuesFor(rule, fieldsOf(rule.model));

    steps.push({
      action: rule.action,
      count: take,
      cutoff: cutoff.toISOString(),
      fields: Object.keys(values).sort(),
      from: rule.from,
      gate: gateOf(rule, settings),
      matched,
      model: rule.model,
      problems,
      remaining: matched - take,
      rule: rule.name,
      token: rule.token,
      waiting,
      where: rule.where,
    });
  }

  return {
    at: now.toISOString(),
    pending: steps.filter((step) => step.gate === 'pending').length,
    problems: steps.flatMap((step) => step.problems),
    steps,
  };
}

/**
 * Carries out one rule, up to the batch
 *
 * @param {*} Model the ORM model
 * @param {object} rule the normalized rule
 * @param {object} step the step of the plan
 * @param {object} settings the retention settings
 * @returns {Promise<{written: number, sample: Array<string>}>} what it did
 */
async function apply(Model, rule, step, settings) {
  const where = whereFor(Model, rule, new Date(step.cutoff));
  const primary = primaryOf(Model);
  const bounded = settings.batch !== false;
  const rows = await findSome(Model, where, bounded ? settings.batch : SAMPLE);

  if (rows.length === 0) {
    return { sample: [], written: 0 };
  }

  // The batch is taken by primary key rather than by writing a limited
  // UPDATE or DELETE: three adapters, three ways to bound a write, and one
  // way to write `id IN (...)`. Unbounded, the age condition is the scope
  // and only the sample is read
  const scope = bounded
    ? { [primary]: rows.map((row) => row[primary]) }
    : where;
  const sample = rows.slice(0, SAMPLE).map((row) => identify(row, primary));

  if (step.action === 'delete') {
    return { sample, written: await deleteRecords(Model, scope) };
  }

  if (step.action === 'soft-delete') {
    return { sample, written: await softDeleteRecords(Model, scope) };
  }

  return {
    sample,
    written: await updateRecords(Model, scope, step.values),
  };
}

/**
 * Sweeps every rule, and answers with the receipt
 *
 * @param {object} context the context
 * @param {Array<object>} context.rules the normalized rules
 * @param {object} context.settings the retention settings
 * @param {function} context.modelOf `(name) => the ORM model`
 * @param {function} context.fieldsOf `(name) => the personal fields`
 * @param {string} [context.application] the name of the application
 * @param {object} [options={}] `only`, `now`, `dryRun`
 * @returns {Promise<object>} the receipt
 */
async function sweepOf(context, options = {}) {
  const { settings, modelOf, fieldsOf, application = null } = context;
  const dryRun = options.dryRun === true;
  const plan = await planOf(context, options);
  const rules = [];
  let interrupted = false;

  for (const step of plan.steps) {
    const rule = context.rules.find(
      (entry) => entry.model === step.model && entry.name === step.rule
    );
    const outcome = {
      action: step.action,
      cutoff: step.cutoff,
      fields: step.fields,
      matched: step.matched,
      model: step.model,
      remaining: step.remaining,
      rule: step.rule,
      sample: [],
      skipped: null,
      token: step.token,
      waiting: step.waiting,
      would: step.count,
      written: 0,
    };

    if (step.problems.length > 0) {
      outcome.skipped = step.problems[0].message;
    } else if (step.gate === 'pending') {
      outcome.skipped = 'not approved';
    } else if (dryRun) {
      outcome.skipped = 'dry run';
    } else if (step.count > 0) {
      try {
        const done = await apply(
          modelOf(step.model),
          rule,
          { ...step, values: valuesFor(rule, fieldsOf(step.model)).values },
          settings
        );

        outcome.sample = done.sample;
        outcome.written = done.written;
      } catch (error) {
        // One rule that fails stops that rule and nothing else: a sweep is
        // a list of independent queries, and the ones that can run should
        interrupted = true;
        outcome.failed = error.message;
      }
    }

    rules.push(outcome);
  }

  return {
    application,
    at: plan.at,
    dryRun,
    interrupted,
    pending: plan.pending,
    rules,
    version: VERSION,
  };
}

module.exports = {
  ACTIONS,
  DEFAULT_ACTION,
  DEFAULT_BATCH,
  DEFAULT_FROM,
  DEFAULT_RECEIPTS,
  MINIMUM,
  SAMPLE,
  UNITS,
  VERSION,
  countRecords,
  datesOf,
  findSome,
  gateOf,
  matches,
  period,
  planOf,
  retentionConfig,
  ruleOf,
  rulesOf,
  softDeleteRecords,
  sweepOf,
  tokenOf,
  valuesFor,
  waitingFor,
  whereFor,
};
