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
 * JSON clients get HAL: `res.collection()` for the index, `res.resource()`
 * for one document (201 + Location on create, 204 on destroy). Browsers get
 * the pages and redirects (scaffold only). `res.negotiate({ html, json })`
 * picks one from the Accept header.
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
 * @param {string} part The fragment name (helpers, page, find, ...)
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
  if (error.name !== 'ValidationError') {
    throw error;
  }

  const errors = Object.fromEntries(
    Object.entries(error.errors || {}).map(([field, detail]) => [
      field,
      detail.message,
    ])
  );

  return res.boom.badData(error.message, { errors });
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
  destroy: ({ doc, lower }) => `
    const ${lower} = await byId(${doc}.findByIdAndDelete(req.params.id));

    if (!${lower}) {
      return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
    }
`,
  find: ({ doc, lower }) => `
    const ${lower} = await byId(${doc}.findById(req.params.id));

    if (!${lower}) {
      return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
    }
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
  page: ({ doc, plural }) => `
    // Page and size from ?page=2&per_page=50, bounded by config.api.maxPerPage
    const { page, perPage, skip, limit } = req.pagination();
    const [${plural}, total] = await Promise.all([
      ${doc}.find().skip(skip).limit(limit),
      ${doc}.countDocuments(),
    ]);
`,
  update: ({ doc, lower }) => `
    let ${lower};

    try {
      ${lower} = await byId(
        ${doc}.findByIdAndUpdate(req.params.id, req.permit(...FIELDS), {
          new: true,
          runValidators: true,
        })
      );
    } catch (error) {
      return invalid(res, error);
    }

    if (!${lower}) {
      return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
    }
`,
};

// --- drizzle ----------------------------------------------------------------
// The drizzle models answer to the Mongoose names too, but `find()` resolves
// to an array instead of a chainable query and a malformed id is already
// null, so the paginated query is a relation and there is no byId helper.

const drizzle = {
  create: mongoose.create,
  destroy: ({ doc, lower }) => `
    const ${lower} = await ${doc}.findByIdAndDelete(req.params.id);

    if (!${lower}) {
      return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
    }
`,
  find: ({ doc, lower }) => `
    // findById() answers null for a malformed id, no cast to guard
    const ${lower} = await ${doc}.findById(req.params.id);

    if (!${lower}) {
      return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
    }
`,
  helpers: (opts) => `${fields(opts)}${validationHelper(opts)}`,
  page: ({ doc, plural }) => `
    // Page and size from ?page=2&per_page=50, bounded by config.api.maxPerPage
    const { page, perPage, skip, limit } = req.pagination();
    const [${plural}, total] = await Promise.all([
      ${doc}.query().offset(skip).limit(limit),
      ${doc}.count(),
    ]);
`,
  update: ({ doc, lower }) => `
    let ${lower};

    try {
      ${lower} = await ${doc}.findByIdAndUpdate(
        req.params.id,
        req.permit(...FIELDS)
      );
    } catch (error) {
      return invalid(res, error);
    }

    if (!${lower}) {
      return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
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
  destroy: ({ doc, lower }) => `
    const ${lower} = await byId(req.params.id);

    if (!${lower}) {
      return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
    }

    await ${lower}.destroy();
`,
  find: ({ doc, lower }) => `
    const ${lower} = await byId(req.params.id);

    if (!${lower}) {
      return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
    }
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

/**
 * Answer a failed validation with a 422 and one message per field
 *
 * @param {object} res Express response
 * @param {Error} error The error thrown by ${doc}
 * @returns {object} The response
 */
const invalid = (res, error) => {
  if (!String(error.name).startsWith('Sequelize')) {
    throw error;
  }

  const errors = Object.fromEntries(
    (error.errors || []).map((detail) => [detail.path, detail.message])
  );

  return res.boom.badData(error.message, { errors });
};
`,
  page: ({ doc, plural }) => `
    // Page and size from ?page=2&per_page=50, bounded by config.api.maxPerPage
    const { page, perPage, skip, limit } = req.pagination();
    const [${plural}, total] = await Promise.all([
      ${doc}.findAll({ limit, offset: skip }),
      ${doc}.count(),
    ]);
`,
  update: ({ doc, lower }) => `
    const ${lower} = await byId(req.params.id);

    if (!${lower}) {
      return res.boom.notFound(\`${doc} \${req.params.id} not found\`);
    }

    try {
      await ${lower}.update(req.permit(...FIELDS));
    } catch (error) {
      return invalid(res, error);
    }
`,
};

const FLAVOURS = { drizzle, mongoose, sequelize };

// --- the actions ------------------------------------------------------------

const header = (opts) => `${of('helpers', opts)}
module.exports = {`;

const footer = () => `};`;

const index = (opts) => `
  index: async (req, res) => {
    ${of('page', opts)}
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
    ${of('page', opts)}
    return res.collection(${opts.plural}, { page, perPage, total });
  },`;

const newC = ({ plural }) => `
  new: async (req, res) => {
    res.render('/${plural}/new');
  },`;

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
  show: async (req, res) => {
    ${of('find', opts)}
    return res.negotiate({
      html: () => res.render('/${opts.plural}/show', { data: { ${opts.lower} } }),
      json: () => res.resource(${opts.lower}),
    });
  },`;

const edit = (opts) => `
  edit: async (req, res) => {
    ${of('find', opts)}
    return res.negotiate({
      html: () => res.render('/${opts.plural}/edit', { data: { ${opts.lower} } }),
      json: () => res.resource(${opts.lower}),
    });
  },`;

const update = (opts) => `
  update: async (req, res) => {
    ${of('update', opts)}
    return res.negotiate({
      html: () => res.redirect(\`/${opts.plural}/\${${opts.lower}.id}\`),
      json: () => res.resource(${opts.lower}),
    });
  },`;

const updateJson = (opts) => `
  update: async (req, res) => {
    ${of('update', opts)}
    return res.resource(${opts.lower});
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
