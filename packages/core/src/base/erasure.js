/**
 * Export and erasure: everything about one person, and the removal of it.
 *
 * The map of `base/privacy.js` says which fields are about a person and how
 * each model reaches one. This is what does something with it:
 * `henri.privacy.export(who)` builds the document a person may ask for, and
 * `henri.privacy.erase(who)` removes them, both from the command line
 * (`henri privacy:export`, `henri privacy:erase`) and from an application
 * that puts a "delete my account" button on a page.
 *
 * The SQL is the easy half. These are the three questions, and the answers
 * henri picked:
 *
 * ## What does erasure do to a soft-deleted row?
 *
 * It erases it, and it never uses a soft delete to perform an erasure.
 *
 * `options: { paranoid: true }` keeps a row *so that it can be brought
 * back*: `deletedAt` is a hidden row, not a removed one, and a restore
 * would bring the personal data back with it. So the walk is
 * `withDeleted()` everywhere -- a withdrawn proposal holds the same words
 * its author wrote -- and where the strategy is `delete`, the row is deleted
 * for real (`{ force: true }`), stamp or no stamp. An erasure that left a
 * restorable row behind would be a filing decision wearing the word
 * "erasure".
 *
 * ## What happens to the records that reference the erased one?
 *
 * By default: they survive, their own personal fields are erased, and their
 * link to the person is left pointing at a row that no longer describes
 * anybody. The person is *anonymized in place* rather than deleted.
 *
 * The alternative is to delete the person's row, and then every reference to
 * it has to go somewhere: cascade (the conference loses the programme it
 * ran, which is its own record and not only the speaker's), null the key
 * (impossible where the column is `required`, which is most of them), or
 * leave a dangling key (a database that lies). Anonymizing the person keeps
 * every foreign key valid and every count true, and it removes exactly what
 * the erasure was about: the identity.
 *
 * A model says otherwise with `options: { personal: { onErase } }`, and an
 * application changes the default for all of them with
 * `config.privacy.onErase`:
 *
 * - `anonymize` (the default): erase the personal fields, keep the row.
 * - `delete`: delete the rows, soft delete stamp or not.
 * - `orphan`: null the link to the person, erase the personal fields, keep
 *   the row. Refused where the link is `required`, before anything is
 *   written.
 * - `retain`: leave the records alone, and say so in the receipt. This is
 *   the one for an invoice a tax authority requires; an omission that is
 *   written down is a decision, an omission that is silent is a leak.
 *
 * The plan is computed and checked before the first write: a `delete` on the
 * person while another model wants to keep a `required` link to it is a
 * refusal, not a failed transaction halfway through.
 *
 * ## What proves it happened?
 *
 * A receipt: a JSON document naming what was erased, when, under which
 * strategy, and the external id of every record that was touched -- written
 * to `config.privacy.receipts` (`privacy/` by default), printed by the
 * command and returned by the call.
 *
 * It cannot hold the email that was erased, since that is the thing being
 * removed, so it holds an HMAC-SHA256 of it keyed with `config.secret`.
 * Whoever has to answer "was this person erased" recomputes the digest from
 * the address they were asked about and looks for it; the receipts alone
 * give nobody their address back.
 *
 * ## Export
 *
 * The same walk, without the writes: every record of every model that holds
 * something about the person, with the fields marked `personal` included
 * (that is what the person is asking for) and the ones marked
 * `personal: { export: false }` left out, alongside the fields that are not
 * personal at all -- a proposal is as much part of "what you hold about me"
 * as the name on it. Passwords never leave, whatever they are marked.
 *
 * @module base/erasure
 */

const { createHmac, randomBytes, randomUUID } = require('node:crypto');
const { fail } = require('./errors');
const { EXTERNAL_ID, isUuid } = require('./external-id');

/** The version of the receipt and export documents */
const VERSION = 1;

/** How the digest of a receipt is computed */
const DIGEST = 'hmac-sha256';

/** The domain the anonymized addresses land in (RFC 2606 reserves it) */
const DOMAIN = 'erased.invalid';

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
 * Which ORM a model belongs to. The three adapters answer the same
 * questions with different words; this is the only place that knows it.
 *
 * @param {*} Model an ORM model
 * @returns {?string} `drizzle`, `mongoose`, `sequelize` or null
 */
function kindOf(Model) {
  if (!Model) {
    return null;
  }

  if (Model.fields && typeof Model.withDeleted === 'function' && Model.table) {
    return 'drizzle';
  }

  if (Model.schema && typeof Model.findOneAndUpdate === 'function') {
    return 'mongoose';
  }

  if (typeof Model.findByPk === 'function') {
    return 'sequelize';
  }

  return null;
}

/**
 * The name of the primary key of a model
 *
 * @param {*} Model an ORM model
 * @returns {string} `_id` on Mongoose, `id` everywhere else
 */
function primaryOf(Model) {
  return kindOf(Model) === 'mongoose' ? '_id' : 'id';
}

/**
 * Every record matching a condition, soft-deleted ones included
 *
 * @param {*} Model an ORM model
 * @param {object} where the condition
 * @returns {Promise<Array>} the records
 * @throws when the adapter is one henri does not know
 */
async function findRecords(Model, where) {
  const kind = kindOf(Model);

  if (kind === 'drizzle') {
    return Model.find(where, { withDeleted: true });
  }

  if (kind === 'mongoose') {
    return Model.find(where).setOptions({ withDeleted: true });
  }

  if (kind === 'sequelize') {
    return Model.findAll({ paranoid: false, where });
  }

  throw unknownAdapter(Model);
}

/**
 * Writes values over every record matching a condition
 *
 * `unsafe` is what lets the roles of an erased account be emptied: they are
 * kept out of a mass assignment on purpose, and this is not one.
 *
 * @param {*} Model an ORM model
 * @param {object} where the condition
 * @param {object} values the values
 * @returns {Promise<number>} how many records were written
 * @throws when the adapter is one henri does not know
 */
async function updateRecords(Model, where, values) {
  const kind = kindOf(Model);

  if (kind === 'drizzle') {
    return Model.withDeleted().where(where).update(values, { unsafe: true });
  }

  if (kind === 'mongoose') {
    const result = await Model.updateMany(where, { $set: values }).setOptions({
      unsafe: true,
      withDeleted: true,
    });

    return result.modifiedCount || 0;
  }

  if (kind === 'sequelize') {
    const [count] = await Model.update(values, {
      paranoid: false,
      unsafe: true,
      where,
    });

    return count || 0;
  }

  throw unknownAdapter(Model);
}

/**
 * Deletes every record matching a condition, for real
 *
 * @param {*} Model an ORM model
 * @param {object} where the condition
 * @returns {Promise<number>} how many records were deleted
 * @throws when the adapter is one henri does not know
 */
async function deleteRecords(Model, where) {
  const kind = kindOf(Model);

  if (kind === 'drizzle') {
    return Model.withDeleted().where(where).destroy({ force: true });
  }

  if (kind === 'mongoose') {
    const result = await Model.deleteMany(where, { force: true });

    return (result && result.deletedCount) || 0;
  }

  if (kind === 'sequelize') {
    return Model.destroy({ force: true, paranoid: false, where });
  }

  throw unknownAdapter(Model);
}

/**
 * The failure raised for an adapter henri cannot drive
 *
 * @param {*} Model the ORM model
 * @returns {Error} the error
 */
function unknownAdapter(Model) {
  return refuse(
    'HENRI_PRIVACY_ADAPTER_UNSUPPORTED',
    `unable to export or erase ${
      (Model && Model.name) || 'a model'
    }: its adapter is not one henri knows how to drive`,
    'The export and the erasure go through the model API of the three adapters henri ships: mongoose, sequelize and drizzle'
  );
}

/**
 * A record as a plain object
 *
 * @param {*} record an instance or a plain object
 * @returns {object} the plain object
 */
function plainOf(record) {
  if (!record || typeof record !== 'object') {
    return {};
  }

  if (typeof record.toObject === 'function') {
    return record.toObject();
  }

  if (typeof record.toJSON === 'function') {
    return record.toJSON();
  }

  return { ...record };
}

/**
 * The public identifier of a record, for the receipt and the export
 *
 * @param {*} record an instance or a plain object
 * @param {string} primary the name of the primary key
 * @returns {?string} the external id, or the primary key
 */
function identify(record, primary) {
  const plain = plainOf(record);
  const external = plain[EXTERNAL_ID];

  if (typeof external === 'string' && external !== '') {
    return external;
  }

  const key = plain[primary];

  return key === null || typeof key === 'undefined' ? null : String(key);
}

/**
 * A replacement value that still fits the column it goes in: long enough
 * for a `minLength`, short enough for a `maxLength`, and matching a `match`
 * when it can. An erasure that a model's own validation refuses is an
 * erasure that did not happen, and the person asking is not interested in
 * whose rule stopped it.
 *
 * @param {string} value the candidate
 * @param {object} mark the mark of the field
 * @returns {string} the value, made to fit
 */
function fit(value, mark) {
  let text = value;

  if (Number.isFinite(mark.minLength) && text.length < mark.minLength) {
    text = text.padEnd(mark.minLength, '.');
  }

  if (Number.isFinite(mark.maxLength) && text.length > mark.maxLength) {
    text = text.slice(0, mark.maxLength);
  }

  return text;
}

/**
 * What is written over a personal value that cannot simply be cleared.
 *
 * The shapes matter: a unique email has to stay unique and has to stay an
 * email, or the write fails and the erasure with it.
 *
 * @param {string} field the field name
 * @param {object} mark the mark of the field
 * @param {string} token the token of this erasure (keeps unique values unique)
 * @returns {*} the value to write
 */
function anonymousValue(field, mark, token) {
  const name = String(field).toLowerCase();

  if (name === 'password') {
    // Not a hash and not a password: 32 bytes nobody holds. The account
    // cannot be signed into again, whichever way the adapter stores it
    return randomBytes(32).toString('hex');
  }

  if (mark.type === 'uuid') {
    return randomUUID();
  }

  if (['float', 'integer', 'number'].includes(mark.type)) {
    return 0;
  }

  if (mark.type === 'boolean') {
    return false;
  }

  if (mark.type === 'date') {
    return mark.required ? new Date(0) : null;
  }

  if (mark.type === 'json') {
    return mark.required ? {} : null;
  }

  const candidates =
    name.includes('email') || name.includes('mail')
      ? [`erased-${token}@${DOMAIN}`, `erased-${token}`]
      : [mark.unique ? `erased-${token}` : '[erased]', `erased-${token}`];

  for (const candidate of candidates) {
    const value = fit(candidate, mark);

    // A column validating against a pattern gets whichever candidate
    // satisfies it; a pattern neither one matches is a field to mark
    // `erase: 'retain'` (or a column to make nullable), and the write says so
    if (!mark.match || mark.match.test(value)) {
      return value;
    }
  }

  return fit(candidates[0], mark);
}

/**
 * The values an erasure writes over the personal fields of one model
 *
 * @param {object} entry the map entry of the model
 * @param {string} token the token of this erasure
 * @returns {{values: object, problems: Array<object>}} the values, and the
 *   fields that cannot be written the way they are marked
 */
function erasedValues(entry, token) {
  const values = {};
  const problems = [];

  for (const field of Object.keys(entry.fields)) {
    const mark = entry.fields[field];

    if (mark.erase === 'retain') {
      continue;
    }

    if (mark.erase === 'clear' && (mark.required || mark.unique)) {
      problems.push({
        field,
        message: `${entry.name}.${field} is marked 'erase: clear' but the column cannot hold null`,
        model: entry.name,
        problem: 'field-not-nullable',
      });
      continue;
    }

    values[field] =
      mark.erase === 'clear' ? null : anonymousValue(field, mark, token);
  }

  return { problems, values };
}

/**
 * The condition matching the records of one model that belong to a person
 *
 * @param {object} entry the map entry of the model
 * @param {object} subject the person, as a plain object
 * @param {string} primary the name of the subject's primary key
 * @returns {?object} the condition, or null when nothing links them
 */
function whereFor(entry, subject, primary) {
  if (!entry.link) {
    return null;
  }

  const matches = entry.link.matches === 'id' ? primary : entry.link.matches;
  const value = subject[matches];

  return typeof value === 'undefined' || value === null
    ? null
    : { [entry.link.field]: value };
}

/**
 * Finds the person an export or an erasure is about.
 *
 * `who` is an email address, an `externalId` or a primary key -- whichever
 * the person asking happens to hold.
 *
 * @param {object} context the context
 * @param {*} context.Model the subject model
 * @param {string} context.name the name of the subject model
 * @param {string} who the email, external id or id
 * @returns {Promise<object>} the record
 * @throws HENRI_PRIVACY_UNKNOWN_SUBJECT when nobody matches
 */
async function findSubject({ Model, name }, who) {
  const value = String(who || '').trim();

  if (value === '') {
    throw refuse(
      'HENRI_PRIVACY_UNKNOWN_SUBJECT',
      'no person was named',
      'Name them by email address, by external id or by id'
    );
  }

  const primary = primaryOf(Model);
  const conditions = [];

  if (value.includes('@')) {
    conditions.push({ email: value.toLowerCase() });
  }

  if (isUuid(value)) {
    conditions.push({ [EXTERNAL_ID]: value.toLowerCase() });
  }

  if (!value.includes('@')) {
    conditions.push({ [primary]: value });
  }

  for (const where of conditions) {
    let found = [];

    try {
      found = await findRecords(Model, where);
    } catch (error) {
      // A primary key of the wrong shape (a uuid where a bigint lives) is
      // not a match, it is the next condition's turn
      if (Object.keys(where)[0] !== primary) {
        throw error;
      }
    }

    if (found.length > 0) {
      return found[0];
    }
  }

  throw refuse(
    'HENRI_PRIVACY_UNKNOWN_SUBJECT',
    `no ${name} matches "${value}"`,
    'Name the person by email address, by external id or by id'
  );
}

/**
 * The digest of a person, for a receipt: proof without the value
 *
 * @param {object} subject the person, as a plain object
 * @param {string} model the name of the subject model
 * @param {string} secret `config.secret`
 * @returns {string} the digest, hex
 */
function digestOf(subject, model, secret) {
  const parts = [
    model,
    String(subject.email || ''),
    String(subject.id || subject._id || ''),
  ];

  return createHmac('sha256', String(secret || ''))
    .update(parts.join('\n'))
    .digest('hex');
}

/**
 * The strategy one model is erased under.
 *
 * A model that declared one has decided; `--strategy` (and
 * `config.privacy.onErase`) is the default for the models that did not.
 *
 * @param {object} entry the map entry of the model
 * @param {object} options the options of the run (`strategy`)
 * @returns {string} the strategy
 */
function actionFor(entry, options = {}) {
  if (entry.declared) {
    return entry.onErase;
  }

  return options.strategy || entry.onErase;
}

/**
 * What an erasure would do, model by model, and what stands in its way.
 *
 * Nothing is written here: this is what `--dry-run` prints and what the
 * erasure itself runs on, so the refusals happen before the first write.
 *
 * @param {object} context the context
 * @param {object} context.map the map (base/privacy.js)
 * @param {function} context.modelOf `(name) => the ORM model`
 * @param {object} subject the person, as a plain object
 * @param {object} [options={}] `strategy` overrides the default of the run
 * @returns {Promise<{problems: Array, steps: Array, unlinked: Array}>} the plan
 */
async function planOf({ map, modelOf }, subject, options = {}) {
  const steps = [];
  const problems = [];
  const unlinked = [];
  const subjectEntry = map.subject;
  const primary = subjectEntry ? primaryOf(modelOf(subjectEntry.name)) : 'id';
  const token = randomBytes(6).toString('hex');

  for (const entry of map.entries) {
    if (entry.isSubject) {
      continue;
    }

    const action = actionFor(entry, options);
    const where = whereFor(entry, subject, primary);

    if (!where) {
      unlinked.push({
        fields: Object.keys(entry.fields),
        model: entry.name,
        reason: entry.link ? 'the person has no such key' : 'no link declared',
      });
      continue;
    }

    const Model = modelOf(entry.name);
    const records = await findRecords(Model, where);
    const { problems: refused, values } = erasedValues(entry, token);

    problems.push(...(action === 'delete' ? [] : refused));

    if (action === 'orphan') {
      // Orphaning writes null into the link, so the column has to accept
      // one; a `required` one is a refusal, before anything is written
      values[entry.link.field] = null;

      if (entry.link.required) {
        problems.push({
          message: `${entry.name}.${entry.link.field} cannot hold null, so its records cannot be orphaned`,
          model: entry.name,
          problem: 'link-not-nullable',
        });
      }
    }

    steps.push({
      action,
      count: records.length,
      ids: records.map((record) => identify(record, primaryOf(Model))),
      model: entry.name,
      values,
      where,
    });
  }

  if (subjectEntry) {
    const action = actionFor(subjectEntry, options);
    const Model = modelOf(subjectEntry.name);
    const { problems: refused, values } = erasedValues(subjectEntry, token);

    if (!['anonymize', 'delete'].includes(action)) {
      problems.push({
        message: `the person cannot be '${action}': a subject is anonymized or deleted`,
        model: subjectEntry.name,
        problem: 'subject-strategy',
      });
    }

    problems.push(...(action === 'delete' ? [] : refused));

    if (action === 'anonymize') {
      // The row survives, so the account it was has to stop being one: the
      // password is already unusable (it is personal, and anonymized), and
      // this is what refuses the sessions that are open right now
      // (`deserializeUser` compares them to this stamp, see 4.user.js)
      values.passwordChangedAt = new Date();
    }

    if (action === 'delete') {
      for (const step of steps) {
        if (step.action !== 'delete' && step.count > 0) {
          problems.push({
            message: `${step.model} keeps ${step.count} record(s) pointing at the person, which cannot be deleted under them`,
            model: step.model,
            problem: 'reference-kept',
          });
        }
      }
    }

    steps.push({
      action,
      count: 1,
      ids: [identify(subject, primaryOf(Model))],
      model: subjectEntry.name,
      subject: true,
      values,
      where: { [primaryOf(Model)]: subject[primaryOf(Model)] },
    });
  }

  return { problems, steps, token, unlinked };
}

/**
 * The records of one model as the export carries them: every field the
 * person is entitled to see, which is every field but the credentials and
 * the ones marked `personal: { export: false }`. The primary key is not one
 * of them: it is internal, and the external id is already there.
 *
 * @param {object} entry the map entry of the model
 * @param {Array} records the records
 * @returns {Array<object>} the plain objects
 */
function exportable(entry, records) {
  return records.map((record) => {
    const plain = plainOf(record);
    const copy = {};

    for (const key of Object.keys(plain)) {
      const mark = entry.fields[key];

      if (key === 'password' || (mark && mark.export === false)) {
        continue;
      }

      copy[key] = plain[key];
    }

    delete copy.id;
    delete copy._id;

    return copy;
  });
}

/**
 * Everything held about one person, in one document
 *
 * @param {object} context the context
 * @param {object} context.map the map (base/privacy.js)
 * @param {function} context.modelOf `(name) => the ORM model`
 * @param {string} [context.application] the name of the application
 * @param {object} subject the person, as a plain object
 * @returns {Promise<object>} the export document
 */
async function exportOf({ map, modelOf, application = null }, subject) {
  const subjectEntry = map.subject;
  const primary = subjectEntry ? primaryOf(modelOf(subjectEntry.name)) : 'id';
  const document = {
    application,
    counts: {},
    generatedAt: new Date().toISOString(),
    records: {},
    subject: {
      email: subject.email || null,
      externalId: subject[EXTERNAL_ID] || null,
      model: subjectEntry ? subjectEntry.name : null,
    },
    unlinked: [],
    version: VERSION,
  };

  if (subjectEntry) {
    document.records[subjectEntry.name] = exportable(subjectEntry, [subject]);
    document.counts[subjectEntry.name] = 1;
  }

  for (const entry of map.entries) {
    if (entry.isSubject || entry.export === false) {
      continue;
    }

    const where = whereFor(entry, subject, primary);

    if (!where) {
      document.unlinked.push(entry.name);
      continue;
    }

    const records = await findRecords(modelOf(entry.name), where);

    document.records[entry.name] = exportable(entry, records);
    document.counts[entry.name] = records.length;
  }

  return document;
}

/**
 * Erases one person, and answers with the receipt
 *
 * @param {object} context the context
 * @param {object} context.map the map (base/privacy.js)
 * @param {function} context.modelOf `(name) => the ORM model`
 * @param {string} [context.application] the name of the application
 * @param {string} [context.secret] `config.secret`, the key of the digest
 * @param {object} subject the person, as a plain object
 * @param {object} [options={}] `strategy`, `dryRun`, `actor`
 * @returns {Promise<object>} the receipt
 * @throws HENRI_PRIVACY_ERASE_REFUSED when the plan cannot be carried out
 */
async function eraseOf(context, subject, options = {}) {
  const { map, modelOf, application = null, secret = '' } = context;
  const plan = await planOf(context, subject, options);
  const subjectEntry = map.subject;

  if (plan.problems.length > 0) {
    throw refuse(
      'HENRI_PRIVACY_ERASE_REFUSED',
      `the erasure was refused: ${plan.problems
        .map((problem) => problem.message)
        .join('; ')}`,
      "Say what should happen to those records: options: { personal: { onErase: 'delete' } }, a nullable column, or a field marked 'erase: anonymize'"
    );
  }

  const records = [];

  for (const step of plan.steps) {
    const Model = modelOf(step.model);
    let written = 0;

    if (options.dryRun) {
      written = step.count;
    } else if (step.action === 'delete') {
      written = await deleteRecords(Model, step.where);
    } else if (step.action === 'retain') {
      written = 0;
    } else if (step.count > 0 && Object.keys(step.values).length > 0) {
      written = await updateRecords(Model, step.where, step.values);
    }

    records.push({
      action: step.action,
      count: step.count,
      fields: step.action === 'delete' ? [] : Object.keys(step.values).sort(),
      ids: step.ids,
      model: step.model,
      written,
    });
  }

  return {
    application,
    at: new Date().toISOString(),
    digest: DIGEST,
    dryRun: options.dryRun === true,
    id: randomUUID(),
    records,
    subject: {
      digest: digestOf(
        subject,
        subjectEntry ? subjectEntry.name : 'unknown',
        secret
      ),
      externalId: subject[EXTERNAL_ID] || null,
      model: subjectEntry ? subjectEntry.name : null,
    },
    unlinked: plan.unlinked,
    version: VERSION,
  };
}

module.exports = {
  DIGEST,
  DOMAIN,
  VERSION,
  actionFor,
  anonymousValue,
  deleteRecords,
  digestOf,
  eraseOf,
  erasedValues,
  exportOf,
  findRecords,
  findSubject,
  fit,
  identify,
  kindOf,
  plainOf,
  planOf,
  primaryOf,
  updateRecords,
  whereFor,
};
