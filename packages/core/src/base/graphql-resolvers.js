/**
 * The resolvers of a generated GraphQL definition.
 *
 * `base/graphql-schema.js` says what the type is; this is what answers it.
 * The two are one feature and they are two files because only the first has
 * to run without a booted application (`henri graphql`, `henri doctor`).
 *
 * Three rules hold for every function here, and they are the reason a
 * generated resolver is worth having at all:
 *
 * 1. **It asks a policy, always.** `show` for a record, `index` plus
 *    `policy.scope(user)` for a list, `create` / `update` / `destroy` for a
 *    mutation. Policies fail closed (`base/policies.js`), so a model with
 *    no `app/policies/<model>.js` answers an empty page and a null record
 *    rather than its table.
 * 2. **A refusal and a row that is not there are the same answer.** Both
 *    are `null`, the way `Model.findById()` answers the same `null` for an
 *    unknown uuid and for a primary key. A GraphQL error saying "you may
 *    not read this one" is a lookup oracle.
 * 3. **Nothing leaves without going through the two functions every other
 *    answer goes through**: `henri.model.publish()` (the foreign keys
 *    become the `externalId` of the row they name, the internal ids go) and
 *    `henri.privacy.strip()` (the fields marked `personal: { expose: false }`
 *    go, at every depth). A generated resolver is not a second way out of
 *    the building.
 *
 * The one place the three ORMs differ is writing, and the difference is a
 * method name: a Drizzle and a Sequelize record answer `update()` and
 * `destroy()`, a Mongoose document answers `set()`/`save()` and
 * `deleteOne()`. That is asked of the record rather than of a table of
 * adapter names, so a fourth adapter answering either pair works.
 *
 * @module base/graphql-resolvers
 */

const { fail } = require('./errors');
const { isPlainObject } = require('./privacy');

/** The GraphQL extensions of a refusal a client caused */
const FORBIDDEN = Object.freeze({ code: 'FORBIDDEN' });

/** The GraphQL extensions of an argument henri could not use */
const BAD_INPUT = Object.freeze({ code: 'BAD_USER_INPUT' });

/**
 * An error a resolver answers with, carrying both codes: henri's, which
 * names the failure in the catalogue, and GraphQL's, which is what a client
 * reads in `extensions.code`.
 *
 * @param {string} code henri's error code
 * @param {string} message what went wrong
 * @param {object} extensions the GraphQL extensions (`{ code }`)
 * @param {string} [hint] what to do about it
 * @returns {Error} the error, to throw
 */
function refusal(code, message, extensions, hint) {
  const error = fail(code, message);

  error.extensions = { ...extensions, henri: code };

  if (hint) {
    error.hint = hint;
  }

  return error;
}

/**
 * The ORM model of a global id, the way `3.privacy.js` finds one
 *
 * @param {object} henri the henri instance
 * @param {string} name the global id (`Memo`)
 * @returns {*} the ORM model
 * @throws when no store holds it
 */
function modelOf(henri, name) {
  const stores = (henri.model && henri.model.stores) || {};

  for (const store of Object.values(stores)) {
    const models = typeof store.getModels === 'function' && store.getModels();

    if (models && models[name]) {
      return models[name];
    }
  }

  if (global[name]) {
    return global[name];
  }

  // Can only happen if a model left the application between the moment the
  // schema was built and the moment a query arrived, which a reload rebuilds
  throw new Error(`${name} is not a model of this application`);
}

/**
 * The user of a resolver's context (`{ req, res }`), or null
 *
 * @param {*} context the resolver context
 * @returns {*} the user, or null
 */
function userOf(context) {
  return (context && context.req && context.req.user) || null;
}

/**
 * The request of a resolver's context, or null
 *
 * @param {*} context the resolver context
 * @returns {?object} the request
 */
function requestOf(context) {
  return (context && context.req) || null;
}

/**
 * One record by its public identifier, `null` for anything that does not
 * name one. A malformed identifier is not a different answer from an
 * unknown one: both are "there is no such record".
 *
 * @param {*} Model the ORM model
 * @param {*} id what the client sent
 * @returns {Promise<*>} the record, or null
 */
async function byId(Model, id) {
  try {
    return (await Model.findById(id)) || null;
  } catch (error) {
    if (
      error.name === 'CastError' ||
      error.name === 'SequelizeDatabaseError' ||
      error.name === 'SequelizeInvalidValueError'
    ) {
      return null;
    }

    throw error;
  }
}

/**
 * What leaves the server: published (the foreign keys as the `externalId`
 * of the row they name, the internal ids gone) and stripped (the fields
 * marked `personal: { expose: false }` gone).
 *
 * @param {object} henri the henri instance
 * @param {*} value a record or a list of them
 * @returns {Promise<*>} the value as it may be sent
 */
async function present(henri, value) {
  const published = henri.model ? await henri.model.publish(value) : value;

  return henri.privacy ? henri.privacy.strip(published) : published;
}

/**
 * May this user take this action, here?
 *
 * @param {object} henri the henri instance
 * @param {object} description the model's description
 * @param {string} action the action (`show`, `index`, `create`, ...)
 * @param {*} record the record, or null
 * @param {*} context the resolver context
 * @returns {Promise<boolean>} allowed or not
 */
function allowed(henri, description, action, record, context) {
  if (!henri.policies) {
    return Promise.resolve(false);
  }

  return henri.policies.can(userOf(context), action, record, {
    policy: description.identity,
    req: requestOf(context),
  });
}

/**
 * What the list a user may see is, as the policy says it.
 *
 * `policy.scope(user)` is henri's query seam and it is required here: a
 * generated list query has no controller to filter it, so a policy with no
 * scope would mean "every row", which is exactly what
 * `henri.policies.scope()` refuses to assume anywhere else.
 *
 * @param {object} henri the henri instance
 * @param {object} description the model's description
 * @param {*} context the resolver context
 * @returns {Promise<*>} the condition the policy answered
 * @throws HENRI_API_GRAPHQL_SCOPE_REQUIRED when the policy has no usable scope
 */
async function scopeOf(henri, description, context) {
  const policy = henri.policies && henri.policies.get(description.identity);
  const missing = refusal(
    'HENRI_API_GRAPHQL_SCOPE_REQUIRED',
    `the ${description.identity} policy must declare scope(user) for the generated ${description.queries.many} query`,
    FORBIDDEN,
    `Add it to app/policies/${description.identity}.js: scope(user) answers the condition the list is filtered by, and \`scope: () => ({})\` is how a policy says "everything"`
  );

  if (!policy || typeof policy.scope !== 'function') {
    throw missing;
  }

  const scope = await henri.policies.scope(
    userOf(context),
    description.identity,
    { req: requestOf(context) }
  );

  if (scope === null || typeof scope === 'undefined') {
    throw missing;
  }

  return scope;
}

/**
 * The condition a list query runs with: what the policy said, and what the
 * client asked for underneath it. The scope wins key by key -- a filter can
 * narrow a list, never widen it.
 *
 * @param {*} scope what the policy answered
 * @param {*} filter the `where` argument, or null
 * @returns {*} the condition
 * @throws HENRI_API_GRAPHQL_SCOPE_REQUIRED when the two cannot be merged
 */
function conditionOf(scope, filter) {
  const written = isPlainObject(filter) ? filter : null;

  if (!written || Object.keys(written).length === 0) {
    return scope;
  }

  if (!isPlainObject(scope)) {
    throw refusal(
      'HENRI_API_GRAPHQL_SCOPE_REQUIRED',
      'the policy scope is not a condition henri can narrow with a filter',
      FORBIDDEN,
      'A scope that is not a plain object is handed to the ORM as it is; drop the `where` argument, or answer a plain object from scope(user)'
    );
  }

  return { ...written, ...scope };
}

/**
 * The values a mutation writes: the input, with every declared reference
 * resolved from the `externalId` it arrived as to the key the column holds.
 *
 * The identifier rule works in both directions. A foreign key leaves the
 * server as the target row's `externalId` (`base/references.js`), so that
 * is what comes back in; henri looks the row up and writes its key.
 *
 * @param {object} henri the henri instance
 * @param {object} description the model's description
 * @param {*} input what the client sent
 * @returns {Promise<object>} the values to write
 * @throws when a reference names no row
 */
async function valuesOf(henri, description, input) {
  const written = isPlainObject(input) ? input : {};
  const values = {};

  for (const field of description.input) {
    if (!Object.prototype.hasOwnProperty.call(written, field.name)) {
      continue;
    }

    const value = written[field.name];

    if (!field.reference || value === null || typeof value === 'undefined') {
      values[field.name] = value;
      continue;
    }

    const target = await byId(modelOf(henri, field.reference), value);

    if (!target) {
      throw refusal(
        'HENRI_API_GRAPHQL_UNKNOWN_REFERENCE',
        `${field.name}: no ${field.reference} has that id`,
        BAD_INPUT,
        'A reference is written with the externalId of the row it names, which is what henri publishes it as'
      );
    }

    values[field.name] =
      typeof target._id === 'undefined' || target._id === null
        ? target.id
        : target._id;
  }

  return values;
}

/**
 * Writes the values onto a record, whichever pair of methods it answers to
 *
 * @param {*} record the record
 * @param {object} values the values
 * @returns {Promise<*>} the saved record
 */
async function write(record, values) {
  if (typeof record.update === 'function') {
    await record.update(values);

    return record;
  }

  record.set(values);
  await record.save();

  return record;
}

/**
 * Removes a record, whichever method it answers to
 *
 * @param {*} record the record
 * @returns {Promise<void>} resolves when it is gone
 */
async function remove(record) {
  if (typeof record.destroy === 'function') {
    await record.destroy();

    return;
  }

  await record.deleteOne();
}

/**
 * The page a list query answers when there is nothing to answer with
 *
 * @param {number} page the page asked for
 * @param {number} perPage its size
 * @returns {object} an empty page
 */
function emptyPage(page, perPage) {
  return { page, pages: 0, perPage, records: [], total: 0 };
}

/**
 * The page arguments of a list query, bounded by `config.api`
 *
 * @param {object} args the query arguments
 * @param {object} settings `{ perPage, maxPerPage }`
 * @returns {{page: number, perPage: number}} the page
 */
function pageOf(args, settings) {
  const page = Number.isInteger(args.page) && args.page > 0 ? args.page : 1;
  const size =
    Number.isInteger(args.perPage) && args.perPage > 0
      ? args.perPage
      : settings.perPage;

  return { page, perPage: Math.min(size, settings.maxPerPage) };
}

/**
 * The resolvers of one generated description.
 *
 * @param {object} henri the henri instance
 * @param {object} description what `describe()` answered for one model
 * @param {object} settings `{ perPage, maxPerPage }` from `config.api`
 * @returns {object} the resolver map, mergeable with every other model's
 */
function resolversOf(henri, description, settings) {
  const { fields, model, mutations, name, queries } = description;
  const resolvers = { [name]: {} };

  // The public identifier and nothing else. A record whose model opted out
  // of `externalId` has the primary key as its identifier, and answers it
  resolvers[name].id = (record) =>
    typeof record.externalId === 'undefined' || record.externalId === null
      ? record.id
      : record.externalId;

  // A Date reaches GraphQL as an object; `String` would serialize it as
  // whatever the runtime's `toString()` says. The JSON answer holds ISO
  // 8601, so this does too
  for (const field of fields.filter((entry) => entry.date)) {
    resolvers[name][field.name] = (record) => {
      const value = record[field.name];

      return value instanceof Date ? value.toISOString() : value || null;
    };
  }

  if (queries) {
    resolvers.Query = {
      /**
       * One record by its public identifier, `null` when there is no such
       * record and when the policy refuses this one
       *
       * @param {*} parent the parent value (none)
       * @param {object} args `{ id }`
       * @param {*} context `{ req, res }`
       * @returns {Promise<*>} the record, or null
       */
      [queries.one]: async (parent, args, context) => {
        const record = await byId(modelOf(henri, model), args.id);

        if (!record) {
          return null;
        }

        return (await allowed(henri, description, 'show', record, context))
          ? present(henri, record)
          : null;
      },

      /**
       * A page of the records this user may see: the `index` rule, then the
       * condition `policy.scope(user)` answered, narrowed by `where`
       *
       * @param {*} parent the parent value (none)
       * @param {object} args `{ page, perPage, where }`
       * @param {*} context `{ req, res }`
       * @returns {Promise<object>} the page
       */
      [queries.many]: async (parent, args, context) => {
        const { page, perPage } = pageOf(args, settings);

        if (!(await allowed(henri, description, 'index', null, context))) {
          return emptyPage(page, perPage);
        }

        const where = conditionOf(
          await scopeOf(henri, description, context),
          args.where
        );
        const answer = await modelOf(henri, model).paginate({
          page,
          perPage,
          where,
        });

        return {
          ...answer,
          records: await present(henri, answer.records),
        };
      },
    };
  }

  if (Object.keys(mutations).length > 0) {
    resolvers.Mutation = {};
  }

  if (mutations.create) {
    /**
     * Creates a record, when the `create` rule allows it
     *
     * @param {*} parent the parent value (none)
     * @param {object} args `{ input }`
     * @param {*} context `{ req, res }`
     * @returns {Promise<*>} the record
     * @throws when the policy refuses
     */
    resolvers.Mutation[mutations.create] = async (parent, args, context) => {
      if (!(await allowed(henri, description, 'create', null, context))) {
        throw refusal(
          'HENRI_API_GRAPHQL_DENIED',
          `not allowed to create this ${description.identity}`,
          FORBIDDEN
        );
      }

      const values = await valuesOf(henri, description, args.input);

      return present(henri, await modelOf(henri, model).create(values));
    };
  }

  if (mutations.update) {
    /**
     * Updates a record, when the `update` rule allows it
     *
     * @param {*} parent the parent value (none)
     * @param {object} args `{ id, input }`
     * @param {*} context `{ req, res }`
     * @returns {Promise<*>} the record, or null
     */
    resolvers.Mutation[mutations.update] = async (parent, args, context) => {
      const record = await byId(modelOf(henri, model), args.id);

      if (
        !record ||
        !(await allowed(henri, description, 'update', record, context))
      ) {
        return null;
      }

      return present(
        henri,
        await write(record, await valuesOf(henri, description, args.input))
      );
    };
  }

  if (mutations.destroy) {
    /**
     * Removes a record, when the `destroy` rule allows it. It answers the
     * record it removed, published one last time
     *
     * @param {*} parent the parent value (none)
     * @param {object} args `{ id }`
     * @param {*} context `{ req, res }`
     * @returns {Promise<*>} the record, or null
     */
    resolvers.Mutation[mutations.destroy] = async (parent, args, context) => {
      const record = await byId(modelOf(henri, model), args.id);

      if (
        !record ||
        !(await allowed(henri, description, 'destroy', record, context))
      ) {
        return null;
      }

      const answer = await present(henri, record);

      await remove(record);

      return answer;
    };
  }

  return resolvers;
}

module.exports = {
  BAD_INPUT,
  FORBIDDEN,
  byId,
  conditionOf,
  emptyPage,
  modelOf,
  pageOf,
  present,
  refusal,
  resolversOf,
  scopeOf,
  valuesOf,
};
