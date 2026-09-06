const { Op } = require('sequelize');

const {
  contextOf,
  encryptionOn,
  isPlainObject,
  lookupValues,
  notQueryable,
} = require('./encrypted');

/**
 * Encrypted attributes on a Sequelize model: where the plaintext turns
 * into an envelope and back.
 *
 * The mark and what it refuses are in `./encrypted.js`; the envelope and
 * the keys are core's. This is the Sequelize half, and it is three things:
 *
 * ## Reading: an attribute getter
 *
 * Not an `afterFind` hook. A hook fires for the model that was queried and
 * not for the ones that came along in an `include`, so
 * `Proposal.findAll({ include: [User] })` would hand back a `User` still
 * holding ciphertext -- the kind of hole that is only found in production.
 * A getter belongs to the attribute, so it answers wherever the instance
 * came from: a find, an include, a `create()`, a `build()`.
 *
 * The cost is that a value that will not decrypt throws where it is read
 * rather than where it was loaded, `toJSON()` included. That is the right
 * way round: `record.ssn` answering `null` because a key is missing is how
 * a bad deploy turns into an overwrite. `henri.encryption.tolerate()` is
 * the way past it, and `henri privacy:export` is what uses it.
 *
 * `raw: true` bypasses getters, which is Sequelize's own escape hatch and
 * what `henri encryption:rotate` reads the stored bytes through.
 *
 * ## Writing: the before hooks
 *
 * After validation, so a `maxLength` still measures the plaintext, and
 * before the insert. `options.encrypted` says the caller is handing over
 * envelopes already -- the same shape as the `passwordsHashed` the user
 * hooks take -- which is what the rotation writes with.
 *
 * A value assigned but not yet written is plaintext sitting in
 * `dataValues`, so the getter would try to decrypt it and fail. The
 * setter records the assignment in a `WeakMap` and the getter answers
 * with what was assigned until the hook has encrypted it; nothing is
 * guessed from the shape of the value.
 *
 * ## Querying: the where clauses
 *
 * `beforeFind`, `beforeCount`, `beforeBulkUpdate` and `beforeBulkDestroy`
 * carry a `where`, and includes carry their own. A deterministic field is
 * replaced by every envelope it could be stored as -- one per configured
 * key, so a lookup keeps working while a rotation is in flight. Anything
 * else is a refusal, never an empty result.
 *
 * @module encryption
 */

/** The operators an encrypted column can still be compared with */
const EQUALITY = new Set([Op.eq, Op.in]);

/** What a `where` may hold beside an operator object */
const NEGATIONS = new Set([Op.ne, Op.notIn]);

/**
 * What each instance had assigned to an encrypted field, and not written
 * yet: `instance -> field -> the value the setter received`.
 *
 * The *value*, not a flag. A flag would be a claim about the field that
 * can outlive what it was about -- `reload()` replaces `dataValues`
 * without going through the setter, so a field assigned and then reloaded
 * would still be claimed as plaintext and the getter would hand back the
 * envelope. Comparing what is there now against what was assigned answers
 * exactly, and it answers without ever looking at the *shape* of a value:
 * a telephone number that happens to read `henri:v1:...` is a telephone
 * number, and a request that could make it mean something else would be a
 * request that chooses whether it is encrypted.
 *
 * Keyed by the instance, so two records never share an entry and two
 * models cannot collide (an instance belongs to one model), and weak, so
 * an instance that goes out of scope takes its entry with it.
 */
const assignments = new WeakMap();

/**
 * Is what the instance holds for this field the value that was assigned to
 * it, rather than something read from the database?
 *
 * @param {object} record A Sequelize instance
 * @param {string} field The field name
 * @param {*} raw What `dataValues` holds now
 * @returns {boolean} true when the two are the same value
 */
const isAssigned = (record, field, raw) => {
  const fields = assignments.get(record);

  return Boolean(fields && fields.has(field) && fields.get(field) === raw);
};

/**
 * Records the value a field was assigned in the clear
 *
 * @param {object} record A Sequelize instance
 * @param {string} field The field name
 * @param {*} value The value
 * @returns {void}
 */
const markAssigned = (record, field, value) => {
  const fields = assignments.get(record);

  if (fields) {
    fields.set(field, value);

    return;
  }

  assignments.set(record, new Map([[field, value]]));
};

/**
 * Forgets an assignment, once the value has been encrypted
 *
 * @param {object} record A Sequelize instance
 * @param {string} field The field name
 * @returns {void}
 */
const clearAssigned = (record, field) => {
  const fields = assignments.get(record);

  if (fields) {
    fields.delete(field);
  }
};

/**
 * Installs the getter and the setter of one encrypted attribute.
 *
 * Called on the attributes before `define()`, so the model is built with
 * them: Sequelize reads `get` and `set` off the attribute at definition
 * time and nowhere else.
 *
 * @param {object} attributes The Sequelize attributes
 * @param {object} encrypted The fields marked `encrypted`
 * @param {object} context `{ henri, model }`
 * @returns {object} The attributes
 */
const decorateAttributes = (attributes, encrypted, { henri, model }) => {
  for (const field of Object.keys(encrypted)) {
    const { deterministic } = encrypted[field];
    const name = contextOf(model, field);
    const attribute = attributes[field];

    /**
     * The plaintext of the stored value
     *
     * @returns {*} The plaintext, or what was assigned and not yet written
     */
    attribute.get = function get() {
      const raw = this.getDataValue(field);

      // What was assigned and not written yet is the plaintext the
      // application put there; everything else came from the database
      if (isAssigned(this, field, raw)) {
        return raw;
      }

      return encryptionOn(henri, name).read(raw, {
        context: name,
        deterministic,
      });
    };

    /**
     * Keeps the plaintext until a hook encrypts it
     *
     * @param {*} value The plaintext
     * @returns {void}
     */
    attribute.set = function set(value) {
      markAssigned(this, field, value);
      this.setDataValue(field, value);
    };
  }

  return attributes;
};

/**
 * Encrypts the fields of one instance that hold plaintext
 *
 * @param {object} record A Sequelize instance
 * @param {object} options The hook options (`encrypted` opts out)
 * @param {object} context `{ encrypted, henri, model }`
 * @returns {void}
 * @throws HENRI_ENCRYPTION_NO_KEY, HENRI_ENCRYPTION_TOO_LONG
 */
const encryptRecord = (record, options, { encrypted, henri, model }) => {
  if (options && options.encrypted === true) {
    return;
  }

  for (const field of Object.keys(encrypted)) {
    if (!record.changed(field) && !record.isNewRecord) {
      continue;
    }

    const name = contextOf(model, field);
    const value = record.getDataValue(field);

    if (value === null || typeof value === 'undefined') {
      clearAssigned(record, field);
      continue;
    }

    record.setDataValue(
      field,
      encryptionOn(henri, name).encrypt(value, {
        context: name,
        deterministic: encrypted[field].deterministic,
      })
    );
    clearAssigned(record, field);
  }
};

/**
 * Encrypts the values of a mass update or an upsert
 *
 * @param {object} values The values being written
 * @param {object} options The hook options (`encrypted` opts out)
 * @param {object} context `{ encrypted, henri, model }`
 * @returns {void}
 */
const encryptValues = (values, options, { encrypted, henri, model }) => {
  if (!isPlainObject(values) || (options && options.encrypted === true)) {
    return;
  }

  for (const field of Object.keys(encrypted)) {
    const value = values[field];

    if (!(field in values) || value === null || typeof value === 'undefined') {
      continue;
    }

    const name = contextOf(model, field);

    // No shape check: a value is encrypted because the caller did not say
    // `{ encrypted: true }`, never because it does not look like an
    // envelope already. A request that can put a string in this field
    // could otherwise put one shaped like an envelope and have it stored
    // in the clear
    values[field] = encryptionOn(henri, name).encrypt(value, {
      context: name,
      deterministic: encrypted[field].deterministic,
    });
  }
};

/**
 * The stored form of one comparison, or the refusal that says why there
 * is none
 *
 * @param {*} value What the query is comparing against
 * @param {object} context `{ encryption, deterministic, name }`
 * @returns {*} The value to compare against instead
 * @throws HENRI_ENCRYPTION_NOT_QUERYABLE on anything but an equality
 */
const translateValue = (value, { deterministic, encryption, name }) => {
  if (value === null || typeof value === 'undefined') {
    return value;
  }

  const candidates = (wanted) =>
    lookupValues(encryption, name, { deterministic }, wanted);

  if (Array.isArray(value)) {
    return { [Op.in]: value.flatMap((entry) => candidates(entry)) };
  }

  if (!isPlainObject(value) && typeof value !== 'object') {
    const found = candidates(value);

    return found.length === 1 ? found[0] : { [Op.in]: found };
  }

  const operators = [
    ...Object.keys(value),
    ...Object.getOwnPropertySymbols(value),
  ];
  const translated = {};

  for (const operator of operators) {
    const compared = value[operator];

    if (EQUALITY.has(operator)) {
      const found = [compared]
        .flat()
        .flatMap((entry) => candidates(entry))
        .filter((entry) => entry !== null);

      translated[Op.in] = [...(translated[Op.in] || []), ...found];
      continue;
    }

    if (NEGATIONS.has(operator)) {
      translated[Op.notIn] = [compared]
        .flat()
        .flatMap((entry) => candidates(entry));
      continue;
    }

    throw notQueryable(
      name,
      `it cannot be compared with ${String(operator)}`,
      deterministic
    );
  }

  return translated;
};

/**
 * Replaces the encrypted fields of a where clause by what the column
 * actually holds
 *
 * @param {*} where The where clause
 * @param {object} context `{ encrypted, henri, model }`
 * @returns {*} The where clause
 * @throws HENRI_ENCRYPTION_NOT_QUERYABLE
 */
const translateWhere = (where, context) => {
  if (!isPlainObject(where)) {
    return where;
  }

  const { encrypted, henri, model } = context;
  // A copy, never the object the caller handed in. Translating in place
  // would turn `const filter = { badge: 'B-1' }` into `{ badge: { [Op.in]:
  // [envelope] } }`, and the second query built from it would encrypt the
  // envelopes again and match nothing -- quietly, which is the one
  // behaviour this whole module exists to refuse
  const copy = { ...where };

  for (const key of Object.getOwnPropertySymbols(where)) {
    const branch = where[key];

    if (Array.isArray(branch)) {
      copy[key] = branch.map((entry) => translateWhere(entry, context));
    } else if (isPlainObject(branch)) {
      copy[key] = translateWhere(branch, context);
    }
  }

  for (const field of Object.keys(where)) {
    if (!encrypted[field]) {
      continue;
    }

    const name = contextOf(model, field);

    copy[field] = translateValue(where[field], {
      deterministic: encrypted[field].deterministic,
      encryption: encryptionOn(henri, name),
      name,
    });
  }

  return copy;
};

/**
 * Refuses an order on an encrypted column.
 *
 * `ORDER BY ssn` over ciphertext sorts by bytes nobody chose: it answers,
 * and the answer is meaningless, which is worse than a failure.
 *
 * @param {*} order The order clause
 * @param {object} context `{ encrypted, model }`
 * @returns {void}
 * @throws HENRI_ENCRYPTION_NOT_QUERYABLE
 */
const checkOrder = (order, { encrypted, model }) => {
  for (const entry of [order].flat()) {
    const field = Array.isArray(entry) ? entry[0] : entry;

    if (typeof field === 'string' && encrypted[field]) {
      throw notQueryable(
        contextOf(model, field),
        'cannot be ordered by',
        encrypted[field].deterministic
      );
    }
  }
};

/**
 * Walks the includes of a query, translating each one against its own
 * model: an include carries a where of its own, and the hooks of the
 * included model do not fire for it.
 *
 * @param {Array} includes The include list
 * @param {object} henri The henri instance
 * @returns {void}
 */
const translateIncludes = (includes, henri) => {
  if (!Array.isArray(includes)) {
    return includes;
  }

  return includes.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }

    const included = entry.model || entry;
    const encrypted = included && included.henriEncrypted;
    const copy = { ...entry };

    if (encrypted && entry.where) {
      copy.where = translateWhere(entry.where, {
        encrypted,
        henri,
        model: included.name,
      });
    }

    if (entry.include) {
      copy.include = translateIncludes(entry.include, henri);
    }

    return copy;
  });
};

/** The Sequelize instances whose global hook is already registered */
const decorated = new WeakSet();

/**
 * The include walk, registered once on the connector rather than on each
 * model.
 *
 * `Note.findAll({ include: [{ model: Person, where: { badge } }] })` runs
 * the hooks of `Note`, and `Note` may hold nothing encrypted at all --
 * while the condition it carries is against a column of `Person` that is
 * an envelope. A model hook cannot see that query; a connector hook sees
 * every one of them.
 *
 * @param {object} connector The Sequelize instance
 * @param {object} henri The henri instance
 * @returns {object} The connector
 */
const decorateConnector = (connector, henri) => {
  if (decorated.has(connector)) {
    return connector;
  }

  decorated.add(connector);

  connector.addHook('beforeFind', 'henriEncryption', (options = {}) => {
    options.include = translateIncludes(options.include, henri);
  });

  connector.addHook('beforeCount', 'henriEncryption', (options = {}) => {
    options.include = translateIncludes(options.include, henri);
  });

  return connector;
};

/**
 * The whole of it on one model: the getters, the write hooks and the
 * query hooks
 *
 * @param {object} Model The Sequelize model
 * @param {object} encrypted The fields marked `encrypted`
 * @param {object} henri The henri instance
 * @returns {object} The model
 */
const decorateModel = (Model, encrypted, henri) => {
  const model = Model.name;
  const context = { encrypted, henri, model };

  // What `translateIncludes()` reads off a model it was handed
  Model.henriEncrypted = encrypted;

  Model.addHook('beforeCreate', 'henriEncryption', (record, options) =>
    encryptRecord(record, options, context)
  );

  Model.addHook('beforeUpdate', 'henriEncryption', (record, options) =>
    encryptRecord(record, options, context)
  );

  Model.addHook(
    'beforeBulkCreate',
    'henriEncryption',
    (records, options = {}) => {
      for (const record of records) {
        encryptRecord(record, options, context);
      }

      // `individualHooks: true` runs beforeCreate on every record after
      // this, and their values are envelopes already
      options.encrypted = true;
    }
  );

  Model.addHook('beforeBulkUpdate', 'henriEncryption', (options = {}) => {
    encryptValues(options.attributes, options, context);
    options.where = translateWhere(options.where, context);
    // Same as the bulk create: with `individualHooks` the per-record hook
    // runs next, over values this one has already encrypted
    options.encrypted = true;
  });

  Model.addHook('beforeBulkDestroy', 'henriEncryption', (options = {}) => {
    options.where = translateWhere(options.where, context);
  });

  Model.addHook('beforeUpsert', 'henriEncryption', (values, options = {}) => {
    encryptValues(values, options, context);
    // Whatever else this upsert fires, the values are envelopes now: with
    // no shape check on the write path, encrypting twice would be a value
    // nothing can read back
    options.encrypted = true;
  });

  // The includes are walked by the connector hook, once, because the
  // query that carries them may be against a model that holds nothing
  // encrypted at all
  Model.addHook('beforeFind', 'henriEncryption', (options = {}) => {
    options.where = translateWhere(options.where, context);

    if (options.order) {
      checkOrder(options.order, context);
    }
  });

  Model.addHook('beforeCount', 'henriEncryption', (options = {}) => {
    options.where = translateWhere(options.where, context);
  });

  decorateConnector(Model.sequelize, henri);

  return Model;
};

module.exports = {
  decorateAttributes,
  decorateConnector,
  decorateModel,
  encryptRecord,
  encryptValues,
  translateWhere,
};
