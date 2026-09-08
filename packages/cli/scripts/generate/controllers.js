/**
 * Source of the controllers written by `henri generate scaffold|crud`.
 *
 * Every function receives the resource names: doc = 'Post' (model global),
 * lower = 'post' (data key of one document), plural = 'posts' (controller,
 * routes and pages), keys = the attributes a request may set, api = the
 * model API of the store the resource lives in ('mongoose' for the disk and
 * mongoose adapters, 'sequelize' for mysql, postgresql and mssql, 'drizzle'
 * for the drizzle adapter; see scripts/adapters.js) and renderer = the view
 * engine of the application ('inertia' or 'react'; see scripts/utils.js).
 * The output goes through prettier, so the indentation here does not matter.
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
 * The renderer only changes what a browser gets when a write fails. The
 * Inertia client follows a redirect and renders whatever page it lands on, so
 * an invalid form comes back as the same page rendered again after
 * `res.inertia.errors()`; the React forms read the `422` instead. API clients
 * get the same `422` either way.
 *
 * `:id` is the public identifier of the record, its `externalId`: a uuid on
 * every store. `Model.findById()` takes it and nothing else -- a primary key
 * in the url answers the same `null` an unknown uuid answers, which is the
 * 404 below -- and a redirect is built from `record.externalId`, never from
 * the numeric id, which does not leave the server.
 *
 * The model file is read back for more than the names: `hidden` is the
 * columns marked `personal: { expose: false }`, which the pages leave out
 * and FIELDS keeps -- henri strips them from every *answer* it builds, and
 * a write is not an answer -- and `hasEnums` says the model declares an
 * `enum` column, so `new` and `edit` send `Model.enums` for the `<select>`s
 * of the form. See `fieldsOf()` in ../generate.js.
 *
 * `accepted` is that same read pointing the other way: the type of every
 * attribute a request may set, plus the `enum` of a column that has one,
 * which is what the `params` block declares for `create` and `update`
 * (`base/params-schema.js`). A hidden column is typed there while it is on
 * no page -- what a request may set is not what an answer may carry -- and
 * a column that names another model (`references`) is typed nowhere at
 * all. `required` is deliberately not copied and the generated comment
 * argues it: this vocabulary means "the key was absent" by it and the
 * model means Rails' presence, so the same word would be two rules.
 *
 * A model that declared `options: { slug: ... }` has a second public name,
 * and the urls of this resource carry that one instead (`base/slug.js`):
 * `slug` is true in the resource, the redirects are built from
 * `record.slug`, and `findById()` resolves the slug and the `externalId`
 * both. It is still never the primary key. The generator reads the model
 * file back for this, so a resource written over a model that already has a
 * name gets the right urls with no flag at all.
 *
 * Two things do not need a flavour: `Model.paginate()` answers the same
 * `{ records, page, perPage, total, pages }` on the three model APIs, and
 * `henri.model.errors()` normalizes what any of them throws on an invalid
 * write, so the index and the 422 are written once for all of them.
 */

const DEFAULT_API = 'mongoose';

/**
 * The field a url of this resource is built from: the slug of a model that
 * declared one, its public identifier otherwise
 *
 * @param {object} opts { slug }
 * @returns {string} `slug` or `externalId`
 */
const identifierOf = ({ slug }) => (slug ? 'slug' : 'externalId');

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

// --- the renderer -----------------------------------------------------------

/**
 * Whether this controller renders Inertia pages: the `crud` generator writes
 * JSON only routes, so it opts out with `pages: false` whatever the renderer
 *
 * @param {object} opts { renderer, pages }
 * @returns {boolean} True for an Inertia scaffold
 */
const rendersInertia = ({ renderer, pages }) =>
  renderer === 'inertia' && pages !== false;

/**
 * The page file an action renders, as a comment writes it
 *
 * @param {object} opts { plural, renderer }
 * @param {string} view The page (index, new, ...)
 * @returns {string} A path under app/views
 */
const pageFile = ({ plural, renderer }, view) =>
  `app/views/pages/${plural}/${view}.${renderer === 'inertia' ? 'jsx' : 'js'}`;

// --- the helpers every flavour shares --------------------------------------

/** A field name as an object key: bare when it can be, quoted when not */
const keyOf = (name) =>
  /^[A-Za-z_$][\w$]*$/u.test(name) ? name : JSON.stringify(name);

/**
 * One rule of a `params` block: the short form of a type on its own
 * (`done: 'boolean'` is `done: { type: 'boolean' }`), the object when the
 * column has values to name
 *
 * @param {object} field { enum, name, type }
 * @returns {string} The source line
 */
const ruleFor = ({ enum: values, name, type }) => {
  const key = keyOf(name);

  if (!values) {
    return `      ${key}: '${type}',`;
  }

  const listed = values.map((value) => `'${value.replace(/'/gu, "\\'")}'`);

  return `      ${key}: { enum: [${listed.join(', ')}], type: '${type}' },`;
};

/**
 * The paragraph naming what FIELDS permits and the `params` block does not
 * type, with the reason. Silence would be the wrong shape here: the block
 * is the boundary of the request, so a column missing from it has to say
 * why it is missing.
 *
 * @param {Array<string>} references Columns naming another model
 * @param {Array<string>} untyped Columns whose type henri does not have
 * @returns {string} The comment, or nothing at all
 */
const untypedNote = (references, untyped) => {
  const clauses = [];

  if (references.length > 0) {
    clauses.push(`  // - ${references.join(', ')} name${references.length > 1 ? '' : 's'} another model.
  //   henri publishes a foreign key as the \`externalId\` of the row it
  //   names, so only this application knows whether a request carries that
  //   or the column's own value -- which is why \`henri openapi\` leaves one
  //   untyped in a request body too.`);
  }

  if (untyped.length > 0) {
    clauses.push(`  // - ${untyped.join(', ')} carr${untyped.length > 1 ? 'y' : 'ies'} a type henri does not have.
  //   It came from an adapter, and there is no rule to write for it.`);
  }

  return clauses.length === 0
    ? ''
    : `
  //
  // Permitted by FIELDS and not declared here:
${clauses.join('\n')}`;
};

/**
 * The `params` block: what a request may hold, and what each of those is.
 *
 * One selector for both writes, because the two accept the same thing:
 * what separates them is `required`, which is not copied (see above). The
 * short form of a rule is used where it fits (`done: 'boolean'` is
 * `done: { type: 'boolean' }`). The comment it writes is the argument and
 * is meant to be read.
 *
 * `accepted` is FIELDS minus the columns that name another model and minus
 * the types henri does not have; when nothing is left there is no block,
 * rather than an empty one that reads like an oversight.
 *
 * @param {object} opts { accepted, doc, references, untyped }
 * @returns {string} The source code, or nothing at all
 */
const params = ({ accepted = [], doc, references = [], untyped = [] }) => {
  if (accepted.length === 0) {
    return '';
  }

  const rules = accepted.map(ruleFor).join('\n');
  const notTyped = untypedNote(references, untyped);
  const copied = accepted.some((field) => field.enum)
    ? `
  //
  // The \`enum\` is a copy and the model is the original. A page never
  // copies one -- \`new\` and \`edit\` send \`${doc}.enums\` -- but this block is
  // compiled before any model exists (a controller is runlevel 2, a model
  // 3), so a literal is the only thing that can be written here.`
    : '';

  return `
  // What a request may hold, and what each of those is: the fields FIELDS
  // permits, typed. The check runs behind the role and the policy guards
  // and ahead of the hooks above, so a request that does not match is a
  // 422 naming the field before anything is looked up.
  //
  // What is accepted is then written back where it came from, which is the
  // half that changes this file: a form, a query string and a path
  // parameter can only send text, so \`req.permit(...FIELDS)\` below hands
  // the action \`true\` rather than the string "true", and \`false\` rather
  // than "false" -- which every adapter stores as false and JavaScript
  // reads as truthy. A JSON body is checked and never parsed, so a client
  // that sends "true" there is refused rather than guessed at.
  //
  // What makes a *record* valid belongs on the model, where a job, a seed
  // and a console are held to it too. \`required\` is the one worth naming:
  // here it means "the key was absent", and on the model it means Rails'
  // presence -- the empty string a form posts for an untouched input
  // passes here and is refused there -- so a copy would read like the
  // model's rule and would not be it. What is worth adding is what only a
  // request knows: a \`maxLength\` so a megabyte of text is refused before
  // anything stores it, a \`min\`/\`max\` on a number, a field this action
  // takes that is no column at all (guides/controllers.md).${copied}${notTyped}
  //
  // Every other action declares nothing: the page and the size of a list
  // are \`req.pagination()\`'s, and \`:id\` is a path parameter the lookup
  // above already answers a 404 for -- the slug of a model that has one
  // included, which is not a uuid.
  params: {
    'create,update': {
${rules}
    },
  },`;
};

const fields = (opts) => {
  const { hidden = [], keys } = opts;
  // A column marked `personal: { expose: false }` is dropped from every
  // answer henri builds -- but a write is not an answer, so it stays in the
  // list a request may set, and the comment says why it is still here
  const note =
    hidden.length === 0
      ? ''
      : `
//
// henri drops a field marked personal: { expose: false } from every answer
// it builds${opts.pages === false ? '' : ', and no page shows one'}. A write is not an answer, so ${
        hidden.length > 1 ? 'these are' : 'this one is'
      }
// still permitted here: ${hidden.join(', ')}`;

  return `
// Attributes a request may set (see req.permit)${note}
const FIELDS = ${JSON.stringify(keys)};
`;
};

/**
 * The `enums` a page of this resource is rendered with: the model's own
 * `{ column: [values] }`, which is what the <select> of an enum column
 * offers. Sent rather than written into the page, because a list copied
 * into a form is a copy of the schema that stops being true.
 *
 * @param {object} opts { doc, hasEnums }
 * @returns {string} `enums: Post.enums, ` or nothing at all
 */
const enumsData = ({ doc, hasEnums }) =>
  hasEnums ? `enums: ${doc}.enums, ` : '';

const validationHelper = (opts) =>
  rendersInertia(opts) ? inertiaValidation(opts) : jsonValidation(opts);

const jsonValidation = ({ doc }) => `
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

const inertiaValidation = ({ doc }) => `
/**
 * Answer a failed validation: a browser gets the form it submitted back with
 * one message per field, an API client a 422
 *
 * @param {object} res Express response
 * @param {Error} error The error thrown by ${doc}
 * @param {string} page The page to render again (its form shows the errors)
 * @param {object} [data] What that page needs to render
 * @returns {object} The response
 */
const invalid = (res, error, page, data = {}) => {
  // Same { field: message } whatever the store threw, null when the error
  // is not a validation failure
  const errors = henri.model.errors(error);

  if (!errors) {
    throw error;
  }

  return res.negotiate({
    // The Inertia client renders the page it gets back, and res.inertia
    // .errors() is what puts the messages under the fields of its form
    html: () => {
      res.inertia.errors(errors);

      return res.render(page, { data });
    },
    json: () => res.boom.badData(error.message, { errors }),
  });
};
`;

/**
 * The `invalid()` call of a failed write
 *
 * @param {object} opts { lower, plural, renderer, pages }
 * @param {string} view The page to render again (new or edit)
 * @returns {string} The source code
 */
const invalidCall = (opts, view) => {
  if (!rendersInertia(opts)) {
    return 'return invalid(res, error);';
  }

  // The page is rendered again with what it needs: the edit page its
  // record, and both pages the values their <select>s offer
  const record = view === 'edit' ? `${opts.lower}: req.${opts.lower} ` : '';
  const carried =
    record || enumsData(opts) ? `, { ${enumsData(opts)}${record}}` : '';

  return `return invalid(res, error, '/${opts.plural}/${view}'${carried});`;
};

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
const loadHelper = ({ doc, lower, slug }, lookup) => `
/**
 * Loads the ${lower} of \`:id\` into \`req.${lower}\`, the way rails'
 * before_action does. A hook that answers ends the request: the actions
 * below only ever run with a record.
 *${
   slug
     ? `
 * \`:id\` here is the slug of the ${lower} (\`options: { slug }\` on the
 * model): \`findById()\` resolves it, and the \`externalId\` next to it,
 * and never the primary key.
 *`
     : ''
 }
 * \`res.notFound()\` rather than \`res.boom.notFound()\`: a policy that
 * refuses this record answers the same 404, and the two have to be one
 * answer. The reason reaches a developer and is dropped in production,
 * because a 404 that says which of the two it is tells whoever asked that
 * the record exists -- which is the whole thing the 404 was for.
 *
 * @param {object} req Express request
 * @param {object} res Express response
 * @returns {Promise<object|undefined>} The 404 answer, or nothing
 */
const load${doc} = async (req, res) => {
  ${lookup}

  if (!req.${lower}) {
    return res.notFound(\`${doc} \${req.params.id} not found\`);
  }
};
`;

// --- mongoose (disk, mongoose) ---------------------------------------------

const mongoose = {
  create: (opts) => `
    let ${opts.lower};

    try {
      ${opts.lower} = await ${opts.doc}.create(req.permit(...FIELDS));
    } catch (error) {
      ${invalidCall(opts, 'new')}
    }
`,
  destroy: ({ lower }) => `
    await req.${lower}.deleteOne();
`,
  helpers: (opts) => `${fields(opts)}
/**
 * Run a query by id, null when the id is malformed
 *
 * The id in the url is the \`externalId\` of the document (a uuid), but a
 * document id works too; anything else is not a document.
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
  // `update()` rather than `set()` then `save()`: henri adds it to a
  // Mongoose document (Mongoose 7 removed its own), and it is the call
  // that puts the attributes back when the store refuses the write, so
  // the record this action still holds never carries a refused value
  update: (opts) => `
    try {
      await req.${opts.lower}.update(req.permit(...FIELDS));
    } catch (error) {
      ${invalidCall(opts, 'edit')}
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
  update: (opts) => `
    try {
      await req.${opts.lower}.update(req.permit(...FIELDS));
    } catch (error) {
      ${invalidCall(opts, 'edit')}
    }
`,
};

// --- sequelize (mysql, postgresql, mssql) -----------------------------------
// Sequelize has no findByIdAndUpdate/Delete: a row is loaded with findById
// then updated or destroyed, and its errors carry an array of items.

const sequelize = {
  create: (opts) => `
    let ${opts.lower};

    try {
      ${opts.lower} = await ${opts.doc}.create(req.permit(...FIELDS));
    } catch (error) {
      ${invalidCall(opts, 'new')}
    }
`,
  destroy: ({ lower }) => `
    await req.${lower}.destroy();
`,
  helpers: (opts) => `${fields(opts)}
/**
 * Load a row by its public identifier, null when there is no such row
 *
 * The id in the url is the \`externalId\` of the row (a uuid). A primary
 * key does not name a row from outside: it answers the same \`null\` an
 * unknown uuid answers, and \`findByKey()\` is the lookup for one you hold.
 *
 * @param {*} id The id from the route
 * @returns {Promise<object|null>} The row or null
 */
const byId = async (id) => {
  try {
    return await ${opts.doc}.findById(id);
  } catch (error) {
    if (error.name === 'SequelizeDatabaseError') {
      return null;
    }
    throw error;
  }
};

${validationHelper(opts)}`,
  load: (opts) =>
    loadHelper(opts, `req.${opts.lower} = await byId(req.params.id);`),
  update: (opts) => `
    try {
      await req.${opts.lower}.update(req.permit(...FIELDS));
    } catch (error) {
      ${invalidCall(opts, 'edit')}
    }
`,
};

const FLAVOURS = { drizzle, mongoose, sequelize };

// --- the actions ------------------------------------------------------------

const header = (opts) => `${of('helpers', opts)}${of('load', opts)}
/** @type {import('@usehenri/core').Controller} */
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
    // ${pageFile(opts, 'index')} is the /${opts.plural} page
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

const newC = (opts) => `
  // No answer, no res.render(): what an action returns is the data of its
  // own page, here ${pageFile(opts, 'new')}${
    opts.hasEnums
      ? `.
  // ${opts.doc}.enums is { column: [values] } for every enum column of the
  // model: the form's <select>s offer that list rather than a copy of it`
      : ''
  }
  new: async () => ({ ${enumsData(opts)}}),`;

const create = (opts) => `
  create: async (req, res) => {
    ${of('create', opts)}
    // 201 with a Location header pointing at the new ${opts.lower}
    return res.negotiate({
      html: () => res.redirect(\`/${opts.plural}/\${${opts.lower}.${identifierOf(opts)}}\`),
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
        res.render('/${opts.plural}/edit', {
          data: { ${enumsData(opts)}${opts.lower}: req.${opts.lower} },
        }),
      json: () => res.resource(req.${opts.lower}),
    }),`;

const update = (opts) => `
  update: async (req, res) => {
    ${of('update', opts)}
    return res.negotiate({
      html: () =>
        res.redirect(\`/${opts.plural}/\${req.${opts.lower}.${identifierOf(opts)}}\`),
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
    params(opts),
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
const crud = (options) => {
  // `crud` routes answer JSON only: no page to render again, so the failed
  // validation is a 422 whatever the renderer of the application
  const opts = { ...options, pages: false };

  return [
    header(opts),
    before({ actions: ['update', 'destroy'], doc: opts.doc }),
    params(opts),
    indexJson(opts),
    createJson(opts),
    updateJson(opts),
    destroyJson(opts),
    footer(),
  ].join('\n');
};

module.exports = { crud, resources };
