const {
  DataTypes,
  ValidationError,
  ValidationErrorItem,
} = require('sequelize');
const {
  EXTERNAL_ID,
  isUuid,
  normalizeExternalId,
  resolvesKeys,
  withoutInternalIds,
} = require('./external-id');
const {
  SLUG,
  emptySlug,
  massWrite: massSlug,
  problemOf: slugProblem,
  slugFor,
  writesSource,
} = require('./slug');
const {
  massWrite,
  problemsOf,
  uncheckedWrite,
  wantsRecord,
} = require('./validations');

/**
 * The Rails behaviours henri adds to every Sequelize model. Soft deletes
 * are Sequelize's own `paranoid` option, so `paginate()`, `findById()` and
 * the public identifier are what is added here.
 */

/**
 * A positive integer, or a fallback
 *
 * @param {*} value Anything (a query string value, usually)
 * @param {number} fallback Used when the value is not a positive integer
 * @returns {number} The integer
 */
const toInt = (value, fallback) => {
  const number = parseInt(value, 10);

  return Number.isFinite(number) && number > 0 ? number : fallback;
};

/**
 * Adds `Model.paginate()`: one call for a page of rows and the counters
 * `res.collection()` wants
 *
 * @param {object} Model A Sequelize model
 * @returns {object} The model
 */
const paginate = (Model) => {
  /**
   * A page of rows and its counters
   *
   * @param {object} [options={}] `page` and `perPage` (as `req.pagination()`
   *   returns them, its `limit`, `offset` and `skip` are ignored); every
   *   other key is a `findAndCountAll()` option (`where`, `order`,
   *   `include`, `attributes`, `paranoid`, ...)
   * @returns {Promise<object>} `{ records, page, perPage, total, pages }`
   */
  Model.paginate = async function paginate(options = {}) {
    // `limit`, `offset` and `skip` are dropped so `Model.paginate(
    // req.pagination())` can be handed the whole object
    const {
      limit,
      offset,
      page: wanted,
      perPage: size,
      skip,
      ...query
    } = options;
    const page = toInt(wanted, 1);
    const perPage = toInt(size, 25);
    const { count, rows } = await this.findAndCountAll({
      ...query,
      limit: perPage,
      offset: (page - 1) * perPage,
    });
    // `findAndCountAll` counts groups when the query groups rows
    const total = Array.isArray(count) ? count.length : count;

    return {
      page,
      pages: Math.max(1, Math.ceil(total / perPage)),
      perPage,
      records: rows,
      total,
    };
  };

  return Model;
};

/**
 * Adds the two lookups henri splits an id into.
 *
 * `findById()` is the one that takes what arrived from outside, and on a
 * model carrying a public identifier (`external-id.js`) it takes a uuid and
 * nothing else: a primary key answers `null`, the same `null` a uuid naming
 * no row answers, so nothing in the reply says which of the two it was.
 * `externalIds.lookup: "any"` restores the old permissive behaviour.
 *
 * `findByKey()` is the primary key and only the primary key, for the code
 * that legitimately holds one -- the subject of a session, a row it just
 * joined. `findByPk()`, the Sequelize name, is its alias.
 *
 * A model that opted out of the public identifier has only the primary key
 * to be found by, so both take it and nothing changes for it.
 *
 * @param {object} Model A Sequelize model
 * @param {boolean} external Does the model carry a public identifier?
 * @param {object} henri The henri instance (for `externalIds.lookup`)
 * @returns {object} The model
 */
const lookup = (Model, external, henri, named = null) => {
  const findByPk = Model.findByPk;

  /**
   * Can the primary key column hold this value at all?
   *
   * A uuid handed to an integer key is a `SequelizeDatabaseError` on
   * PostgreSQL, which would answer a 500 -- and print a fragment of SQL --
   * where a lookup that found nothing belongs. It answers `null` instead,
   * the way every other miss does.
   *
   * @param {object} model The model (`this` in a static)
   * @param {*} value The value
   * @returns {boolean} true when the lookup is worth running
   */
  const castable = (model, value) => {
    if (value === null || typeof value === 'undefined' || value === '') {
      return false;
    }

    const attribute = model.rawAttributes[model.primaryKeyAttribute] || {};

    return (
      !(attribute.type instanceof DataTypes.INTEGER) ||
      /^\d+$/u.test(String(value))
    );
  };

  /**
   * A row by primary key, never by public identifier
   *
   * @param {*} value A primary key
   * @param {object} [options] findByPk options
   * @returns {Promise<?object>} The row or null
   */
  Model.findByKey = function findByKey(value, options) {
    if (!castable(this, value)) {
      return Promise.resolve(null);
    }

    return findByPk.call(this, value, options);
  };

  /**
   * A row by public identifier
   *
   * @param {*} value An external id (a uuid)
   * @param {object} [options] findOne options
   * @returns {Promise<?object>} The row or null
   */
  Model.findByExternalId = function findByExternalId(value, options) {
    return this.findOne({
      ...options,
      where: {
        ...((options && options.where) || {}),
        [EXTERNAL_ID]: normalizeExternalId(value),
      },
    });
  };

  /**
   * A row by the identifier the outside world holds
   *
   * @param {*} value An external id (or a primary key, on a model that has
   *   no external id or an application that opted out of the strict lookup)
   * @param {object} [options] findByPk/findOne options
   * @returns {Promise<?object>} The row or null
   */
  Model.findById = function findById(value, options) {
    if (external && isUuid(value)) {
      return this.findByExternalId(value, options);
    }

    // The slug column, and only the slug column. A model that has a name
    // takes the whole non-uuid space with it, `externalIds.lookup: "any"`
    // included -- the stricter of the two rules is the one to keep, and it
    // is the same one on every adapter (./slug.js)
    if (named) {
      return this.findBySlug(value, options);
    }

    if (!external || resolvesKeys(henri)) {
      return this.findByKey(value, options);
    }

    return Promise.resolve(null);
  };

  /**
   * A row by the name a person reads, on a model that declared one
   *
   * @param {*} value A slug
   * @param {object} [options] findOne options
   * @returns {Promise<?object>} The row or null
   */
  Model.findBySlug = function findBySlug(value, options) {
    if (!named || typeof value !== 'string' || value === '') {
      return Promise.resolve(null);
    }

    return this.findOne({
      ...options,
      where: {
        ...((options && options.where) || {}),
        [SLUG]: value.toLowerCase(),
      },
    });
  };

  Model.findByPk = Model.findByKey;

  return Model;
};

/**
 * The `slug` column filled on every write Sequelize runs a hook for.
 *
 * The two hooks are the ones `validations` uses and for the same reason:
 * `beforeValidate` covers `create`, `save`, `instance.update`, `upsert`
 * and the mass `Model.update`, and `beforeBulkCreate` is the one it does
 * not reach. A mass update naming the source of a model that follows it is
 * refused rather than written, because one hook runs for the whole write
 * and no row is named by it (./slug.js).
 *
 * @param {object} Model A Sequelize model
 * @param {object} declaration The compiled declaration (./slug.js)
 * @returns {object} The model
 */
const slugged = (Model, declaration) => {
  const name = Model.name;

  /**
   * The error a slug that cannot be a url segment gets, in the shape
   * Sequelize answers a validation failure with
   *
   * @param {string} message What is wrong with it
   * @param {*} value The slug
   * @returns {Error} A SequelizeValidationError
   */
  const failure = (message, value) =>
    validationError(name, { [SLUG]: message }, { [SLUG]: value });

  /**
   * Fills or checks the slug of one record about to be written
   *
   * @param {object} record The Sequelize instance
   * @param {object} [options] The write options, whose `fields` decides
   *   which columns the statement names: a column henri filled in a hook
   *   is not one the caller listed, so it is added here or it is set in
   *   memory and never written
   * @returns {void}
   * @throws {Error} When the slug cannot be a url, or there is nothing to
   *   build one from
   */
  const apply = (record, options) => {
    const written = () => {
      if (
        options &&
        Array.isArray(options.fields) &&
        !options.fields.includes(SLUG)
      ) {
        options.fields.push(SLUG);
      }
    };
    const given = record.get(SLUG);

    // A slug the application wrote itself always wins, and the only thing
    // asked of it is whether it can be one path segment
    if (
      record.changed(SLUG) &&
      typeof given !== 'undefined' &&
      given !== null &&
      given !== ''
    ) {
      const wanted =
        typeof given === 'string' ? given.trim().toLowerCase() : given;
      const wrong = slugProblem(wanted, declaration);

      if (wrong) {
        throw failure(wrong, given);
      }

      record.set(SLUG, wanted);
      written();

      return;
    }

    if (
      !record.isNewRecord &&
      !(declaration.on === 'change' && record.changed(declaration.from))
    ) {
      return;
    }

    const source = record.get(declaration.from);
    const slug = slugFor(declaration, source, record.get(EXTERNAL_ID));

    if (slug === '') {
      throw emptySlug(name, declaration, source);
    }

    record.set(SLUG, slug);
    written();
  };

  Model.addHook('beforeValidate', 'henriSlugs', (record, options) =>
    apply(record, options)
  );
  Model.addHook('beforeBulkCreate', 'henriSlugs', (records, options) => {
    for (const record of records) {
      apply(record, options);
    }
  });

  const update = Model.update.bind(Model);

  /**
   * The mass update, refused when it would regenerate many slugs at once
   *
   * @param {object} values The values
   * @param {object} [options] The options (`where`)
   * @returns {Promise<*>} What Sequelize answers
   */
  Model.update = async (values, options) => {
    if (declaration.on === 'change' && writesSource(declaration, values)) {
      throw massSlug(name, declaration, 'update', 'update(attrs)');
    }

    return update(values, options);
  };

  return Model;
};

/**
 * The two halves of the public identifier on a model that carries one: the
 * primary key stops leaving the server (`toJSON()`, and everything built on
 * it, answers with `externalId` instead), and the public identifier is
 * written once, on the insert, so the urls of a record never move.
 *
 * @param {object} Model A Sequelize model
 * @returns {object} The model
 */
const publicId = (Model) => {
  /**
   * The row as JSON, without its primary key
   *
   * @returns {object} A plain object
   */
  Model.prototype.toJSON = function toJSON() {
    return withoutInternalIds(this.get({ plain: true }));
  };

  Model.addHook('beforeUpdate', 'henriExternalId', (record) => {
    if (record.changed(EXTERNAL_ID)) {
      record.set(EXTERNAL_ID, record.previous(EXTERNAL_ID));
      record.changed(EXTERNAL_ID, false);
    }
  });

  Model.addHook('beforeBulkUpdate', 'henriExternalId', (options = {}) => {
    const values = options.attributes || {};

    if (EXTERNAL_ID in values) {
      delete values[EXTERNAL_ID];
      options.fields = (options.fields || []).filter(
        (field) => field !== EXTERNAL_ID
      );
    }
  });

  return Model;
};

/**
 * The `ValidationError` shape Sequelize already answers with, built from
 * what `./validations.js` said is wrong
 *
 * @param {string} model The model's global id
 * @param {object} problems `{ field: message }`
 * @param {object} values The values being written
 * @returns {Error} A SequelizeValidationError
 */
const validationError = (model, problems, values) =>
  new ValidationError(
    `${model} validation failed: ${Object.entries(problems)
      .map(([field, message]) => `${field}: ${message}`)
      .join(', ')}`,
    Object.entries(problems).map(
      ([field, message]) =>
        new ValidationErrorItem(
          message,
          'Validation error',
          field,
          values ? values[field] : undefined,
          null,
          'henriValidates'
        )
    )
  );

/**
 * The fields an `increment`/`decrement` names, however it names them
 *
 * @param {*} fields A field, a list of them, or `{ field: by }`
 * @returns {Array<string>} The field names
 */
const namesOf = (fields) => {
  if (Array.isArray(fields)) {
    return fields;
  }

  return typeof fields === 'string' ? [fields] : Object.keys(fields || {});
};

/**
 * What a model's `validates` block declared, on every Sequelize write path
 * that carries attributes.
 *
 * Sequelize's own validation is not one thing: `create`, `save`, `update`
 * and the mass `Model.update` validate; `bulkCreate` does not unless the
 * caller says so; `upsert` validates only the columns it was given; and
 * `increment`/`decrement` run no hook at all. Rather than reason about
 * which of them Sequelize covers, henri runs the shared rules itself in
 * the two hooks that see attributes -- `beforeValidate`, which every write
 * but a bulk insert goes through, and `beforeBulkCreate`, which is that
 * one -- so a declaration means the same thing on every one of them and
 * the same thing it means on the other two adapters. The three writes no
 * hook reaches are wrapped below rather than left to be missed.
 *
 * Registered before the encryption and user hooks, so what a `maxLength`
 * measures is the plaintext a person wrote rather than its envelope or its
 * hash.
 *
 * @param {object} Model A Sequelize model
 * @param {object} rules The compiled rules (./validations.js)
 * @returns {object} The model
 */
const validations = (Model, rules) => {
  const name = Model.name;

  /**
   * Runs the rules, or throws
   *
   * @param {object} values The values being written
   * @param {boolean} partial Is this an update, naming only some fields?
   * @param {*} record The record, for a rule that asked for one
   * @returns {void}
   * @throws {Error} A SequelizeValidationError
   */
  const check = (values, partial, record) => {
    const problems = problemsOf(rules, values, { partial, record });

    if (problems) {
      throw validationError(name, problems, values);
    }
  };

  // `beforeValidate` is the one hook that runs ahead of Sequelize's own
  // validators, which is where henri's rules have to be for the message a
  // person reads to be the same sentence on all three adapters. It covers
  // `create`, `save`, `instance.update`, `upsert` and the mass
  // `Model.update`; `bulkCreate` is the one it does not reach.
  Model.addHook('beforeValidate', 'henriValidates', (record, options = {}) => {
    // Sequelize validates a second time on an update, after the `before`
    // hooks have run -- by then an encrypted field holds its envelope and
    // a password its hash, and a `maxLength` would be measuring those.
    // henri checks what the application wrote, once
    if (options.henriValidates) {
      return;
    }

    options.henriValidates = true;

    const after = record.get();
    // A create names every column (Sequelize leaves `skip` empty); every
    // other path names some of them, and the rest are left alone
    const partial =
      !record.isNewRecord ||
      (Array.isArray(options.skip) && options.skip.length > 0);

    if (!partial) {
      check(after, false, after);

      return;
    }

    const written = {};

    for (const field of record.changed() || []) {
      written[field] = after[field];
    }

    check(written, true, after);
  });

  Model.addHook('beforeBulkCreate', 'henriValidates', (records, options) => {
    // Sequelize's `bulkCreate` does not validate unless it is told to, so
    // an `enum` was written straight past on this one path. henri's rules
    // run here whatever it decides, and Sequelize's own run from now on
    options.validate = true;

    for (const record of records) {
      check(record.get(), false, record.get());
    }
  });

  const update = Model.update.bind(Model);

  /**
   * The mass update, refused when a rule asked for the record
   *
   * @param {object} values The values
   * @param {object} [options] The options (`where`)
   * @returns {Promise<*>} What Sequelize answers
   */
  Model.update = async (values, options) => {
    const fields = wantsRecord(rules, values);

    if (fields.length > 0) {
      throw massWrite(name, 'update', 'update(attrs)', fields);
    }

    return update(values, options);
  };

  for (const what of ['decrement', 'increment']) {
    const original = Model[what].bind(Model);

    /**
     * The same call, refused when henri cannot check what it writes
     *
     * @param {*} fields The fields to change
     * @param {object} [options] The options
     * @returns {Promise<*>} What Sequelize answers
     */
    Model[what] = async (fields, options) => {
      const ruled = namesOf(fields).filter((field) => rules[field]);

      if (ruled.length > 0) {
        throw uncheckedWrite(
          name,
          what,
          `Read the record, change ${ruled.join(' and ')} on it and save it, which is checked; or take the rules off ${ruled.join(' and ')}.`
        );
      }

      return original(fields, options);
    };
  }

  return Model;
};

module.exports = { lookup, paginate, publicId, slugged, validations };
