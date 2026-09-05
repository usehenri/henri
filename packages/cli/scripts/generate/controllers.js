/**
 * Source of the controllers written by `henri generate scaffold|crud`.
 *
 * Every function receives the resource names: doc = 'Post' (model global),
 * lower = 'post' (data key of one document), plural = 'posts' (controller,
 * routes and pages), keys = the attributes a request may set and api = the
 * model API of the store the resource lives in ('mongoose' for the disk and
 * mongoose adapters, 'sequelize' for mysql, postgresql and mssql, 'drizzle'
 * for the drizzle adapter; see scripts/adapters.js). The output goes through
 * prettier, so the indentation here does not matter.
 *
 * The shape is the rails one: a `before` block loads the record of `:id` once
 * for the actions that need it (a hook that answers ends the request), and
 * `new` returns instead of rendering (henri renders the page of the action
 * with what it returns).
 *
 * JSON clients get HAL: `res.collection()` for the index, `res.resource()`
 * for one document (201 + Location on create, 204 on destroy). Browsers get
 * the pages and redirects (scaffold only). `res.negotiate({ html, json })`
 * picks one from the Accept header.
 *
 * Two things do not need a flavour: `Model.paginate()` answers the same
 * `{ records, page, perPage, total, pages }` on the three model APIs, and
 * `henri.model.errors()` normalizes what any of them throws on an invalid
 * write, so the index and the 422 are written once for all of them.
 */

const DEFAULT_API = 'mongoose';

/**
 * The api of a resource, `mongoose` when it is not one we know
 *
 * @param {object} opts { api }
 * @returns {string} mongoose, sequelize or drizzle
 */
const apiOf = ({ api }) => (FLAVOURS[api] ? api : DEFAULT_API);

/**
 * Pick the fragment of an api
 *
 * @param {string} part The fragment name (helpers, load, create, ...)
 * @param {object} opts { doc, lower, plural, keys, api }
 * @returns {string} The source code
 */
const of = (part, opts) => FLAVOURS[apiOf(opts)][part](opts);

// --- the helpers every flavour shares --------------------------------------

const fields = ({ keys }) => `
// Attributes a request may set (see req.permit)
const FIELDS = ${JSON.stringify(keys)};
`;

const validationHelper = ({ doc }) => `
/**
 * Answer a failed validation with a 422 and one message per field
 *
 * @param {object} res Express response
 * @param {Error} error The error thrown by ${doc}
 * @returns {object} The response
 */
const invalid = (res, error) => {
  // Same { field: message } whatever the store threw, null when the error
  // is not a validation failure
  const errors = henri.model.errors(error);

  if (!errors) {
    throw error;
  }

  return res.boom.badData(error.message, { errors });
};
`;

/**
 * The paginated query of an index action: one call for the page and the
 * counters `res.collection()` wants, on every adapter
 *
 * @param {object} opts { doc, plural }
 * @returns {string} The source code
 */
const page = ({ doc, plural }) => `
    // One query for the page and its counters: the page and the size come
    // from ?page=2&per_page=50, bounded by config.api.maxPerPage
    const { records: ${plural}, page, perPage, total } = await ${doc}.paginate(
      req.pagination()
    );
`;

/**
 * The `before` hook loading the record of `:id`, around the lookup of a
 * flavour
 *
 * @param {object} opts { doc, lower }
 * @param {string} lookup The source code setting `req.<lower>`
 * @returns {string} The source code
 */
const loadHelper = ({ doc, lower }, lookup) => `
/**
 * Loads the ${lower} of \`:id\` into \`req.${lower}\`, the way rails'
 * before_action does. A hook that answers ends the request: the actions
 * below only ever run with a record.
 *
 * @param {object} req Express request
 * @param {object} res Express response
 * @returns {Promise<object|undefined>} The 404 answer, or nothing
 */
const load${doc} = async (req, res) => {
  ${lookup}

  if (!req.${lower}) {
    return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
  }
};
`;

// --- mongoose (disk, mongoose) ---------------------------------------------

const mongoose = {
  create: ({ doc, lower }) => `
    let ${lower};

    try {
      ${lower} = await ${doc}.create(req.permit(...FIELDS));
    } catch (error) {
      return invalid(res, error);
    }
`,
  destroy: ({ lower }) => `
    await req.${lower}.deleteOne();
`,
  helpers: (opts) => `${fields(opts)}
/**
 * Run a query by id, null when the id is malformed
 *
 * @param {Promise} query A mongoose query
 * @returns {Promise<object|null>} The document or null
 */
const byId = async (query) => {
  try {
    return await query;
  } catch (error) {
    if (error.name === 'CastError') {
      return null;
    }
    throw error;
  }
};
${validationHelper(opts)}`,
  load: (opts) =>
    loadHelper(
      opts,
      `req.${opts.lower} = await byId(${opts.doc}.findById(req.params.id));`
    ),
  update: ({ lower }) => `
    try {
      req.${lower}.set(req.permit(...FIELDS));
      await req.${lower}.save();
    } catch (error) {
      return invalid(res, error);
    }
`,
};

// --- drizzle ----------------------------------------------------------------
// The drizzle models answer to the Mongoose names too, but a malformed id is
// already null, so there is no byId helper to guard the cast.

const drizzle = {
  create: mongoose.create,
  destroy: ({ lower }) => `
    await req.${lower}.destroy();
`,
  helpers: (opts) => `${fields(opts)}${validationHelper(opts)}`,
  load: (opts) =>
    loadHelper(
      opts,
      `// findById() answers null for a malformed id, no cast to guard
  req.${opts.lower} = await ${opts.doc}.findById(req.params.id);`
    ),
  update: ({ lower }) => `
    try {
      await req.${lower}.update(req.permit(...FIELDS));
    } catch (error) {
      return invalid(res, error);
    }
`,
};

// --- sequelize (mysql, postgresql, mssql) -----------------------------------
// Sequelize has no findByIdAndUpdate/Delete: a row is loaded with findByPk
// then updated or destroyed, and its errors carry an array of items.

const sequelize = {
  create: ({ doc, lower }) => `
    let ${lower};

    try {
      ${lower} = await ${doc}.create(req.permit(...FIELDS));
    } catch (error) {
      return invalid(res, error);
    }
`,
  destroy: ({ lower }) => `
    await req.${lower}.destroy();
`,
  helpers: ({ doc, keys }) => `${fields({ keys })}
/**
 * Load a row by primary key, null when the id is malformed
 *
 * @param {*} id The id from the route
 * @returns {Promise<object|null>} The row or null
 */
const byId = async (id) => {
  try {
    return await ${doc}.findByPk(id);
  } catch (error) {
    if (error.name === 'SequelizeDatabaseError') {
      return null;
    }
    throw error;
  }
};

${validationHelper({ doc })}`,
  load: (opts) =>
    loadHelper(opts, `req.${opts.lower} = await byId(req.params.id);`),
  update: ({ lower }) => `
    try {
      await req.${lower}.update(req.permit(...FIELDS));
    } catch (error) {
      return invalid(res, error);
    }
`,
};

const FLAVOURS = { drizzle, mongoose, sequelize };

// --- the actions ------------------------------------------------------------

const header = (opts) => `${of('helpers', opts)}${of('load', opts)}
module.exports = {`;

const footer = () => `};`;

/**
 * The `before` block of a controller (henri's before_action)
 *
 * @param {object} opts { doc, actions }
 * @returns {string} The source code
 */
const before = ({ doc, actions }) => `
  // Runs before these actions, in this order (henri's before_action)
  before: { '${actions.join(',')}': load${doc} },`;

const index = (opts) => `
  index: async (req, res) => {
    ${page(opts)}
    // app/views/pages/${opts.plural}/index.js is the /${opts.plural} page for next.js
    const html = () =>
      res.render('/${opts.plural}', {
        data: { ${[opts.plural, 'page', 'perPage', 'total'].sort().join(', ')} },
      });

    // Browsers get the page, API clients a HAL collection
    return res.negotiate({
      html,
      json: () => res.collection(${opts.plural}, { page, perPage, total }),
    });
  },`;

const indexJson = (opts) => `
  index: async (req, res) => {
    ${page(opts)}
    return res.collection(${opts.plural}, { page, perPage, total });
  },`;

const newC = ({ plural }) => `
  // No answer, no res.render(): what an action returns is the data of its
  // own page, here app/views/pages/${plural}/new.js
  new: async () => ({}),`;

const create = (opts) => `
  create: async (req, res) => {
    ${of('create', opts)}
    // 201 with a Location header pointing at the new ${opts.lower}
    return res.negotiate({
      html: () => res.redirect(\`/${opts.plural}/\${${opts.lower}.id}\`),
      json: () => res.resource(${opts.lower}, { status: 201 }),
    });
  },`;

const createJson = (opts) => `
  create: async (req, res) => {
    ${of('create', opts)}
    // 201 with a Location header pointing at the new ${opts.lower}
    return res.resource(${opts.lower}, { status: 201 });
  },`;

const show = (opts) => `
  // req.${opts.lower} comes from the before hook above
  show: async (req, res) =>
    res.negotiate({
      html: () =>
        res.render('/${opts.plural}/show', { data: { ${opts.lower}: req.${opts.lower} } }),
      json: () => res.resource(req.${opts.lower}),
    }),`;

const edit = (opts) => `
  edit: async (req, res) =>
    res.negotiate({
      html: () =>
        res.render('/${opts.plural}/edit', { data: { ${opts.lower}: req.${opts.lower} } }),
      json: () => res.resource(req.${opts.lower}),
    }),`;

const update = (opts) => `
  update: async (req, res) => {
    ${of('update', opts)}
    return res.negotiate({
      html: () => res.redirect(\`/${opts.plural}/\${req.${opts.lower}.id}\`),
      json: () => res.resource(req.${opts.lower}),
    });
  },`;

const updateJson = (opts) => `
  update: async (req, res) => {
    ${of('update', opts)}
    return res.resource(req.${opts.lower});
  },`;

const destroy = (opts) => `
  destroy: async (req, res) => {
    ${of('destroy', opts)}
    return res.negotiate({
      html: () => res.redirect('/${opts.plural}'),
      json: () => res.status(204).end(),
    });
  },`;

const destroyJson = (opts) => `
  destroy: async (req, res) => {
    ${of('destroy', opts)}
    return res.status(204).end();
  },`;

/**
 * A controller with the seven resources actions and html/json answers
 *
 * @param {object} opts { doc, lower, plural, keys, api }
 * @returns {string} The source code
 */
const resources = (opts) =>
  [
    header(opts),
    before({ actions: ['show', 'edit', 'update', 'destroy'], doc: opts.doc }),
    index(opts),
    newC(opts),
    create(opts),
    show(opts),
    edit(opts),
    update(opts),
    destroy(opts),
    footer(),
  ].join('\n');

/**
 * A json only controller with index, create, update and destroy
 *
 * @param {object} opts { doc, lower, plural, keys, api }
 * @returns {string} The source code
 */
const crud = (opts) =>
  [
    header(opts),
    before({ actions: ['update', 'destroy'], doc: opts.doc }),
    indexJson(opts),
    createJson(opts),
    updateJson(opts),
    destroyJson(opts),
    footer(),
  ].join('\n');

/**
 * The sample tasks controller of the inertia template, ported to the model
 * API of a store (the template ships the mongoose one)
 *
 * @param {object} opts { doc, lower, plural, api }
 * @returns {string} The source code
 */
const inertia = (opts) => {
  const { doc, plural } = opts;
  const api = apiOf(opts);
  const queries = {
    drizzle: {
      list: `${doc}.order('createdAt desc')`,
      remove: `await ${doc}.findByIdAndDelete(req.params.id);`,
    },
    mongoose: {
      list: `${doc}.find().sort({ createdAt: -1 }).lean()`,
      remove: `await ${doc}.deleteOne({ _id: req.params.id });`,
    },
    sequelize: {
      list: `${doc}.findAll({ order: [['createdAt', 'DESC']] })`,
      remove: `await ${doc}.destroy({ where: { id: req.params.id } });`,
    },
  }[api];

  return `
// Controllers receive express requests. \`res.render(route, { data })\` renders
// app/views/pages/<route>.jsx with \`data\` available through useHenri().
// The Inertia client follows redirects, so a form submission ends on the
// page the controller redirects to.
const list = () => ${queries.list};

module.exports = {
  index: async (req, res) => {
    res.render('/${plural}/index', { data: { ${plural}: await list() } });
  },

  create: async (req, res) => {
    try {
      await ${doc}.create({
        category: req.body.category,
        name: req.body.name,
      });

      return res.redirect('/${plural}');
    } catch (error) {
      // Rendering with errors: they show up in the <Form> render prop
      res.inertia.errors({ name: error.message });

      return res.render('/${plural}/index', { data: { ${plural}: await list() } });
    }
  },

  destroy: async (req, res) => {
    ${queries.remove}

    res.redirect('/${plural}');
  },
};
`;
};

module.exports = { crud, inertia, resources };
