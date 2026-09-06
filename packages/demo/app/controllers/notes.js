// A rails-shaped controller: a `before` hook loads the record once for every
// action that needs it, and the actions return their data instead of calling
// res.render() (henri renders /notes/<action> with what they return).
const notes = new Map();

let sequence = 0;

/**
 * Loads the note of `:id`, answering a 404 when there is none. A hook that
 * answers ends the request: the action never runs.
 *
 * @param {object} req Express request
 * @param {object} res Express response
 * @returns {Promise<object|void>} The 404 answer, or nothing
 */
const loadNote = async (req, res) => {
  const note = notes.get(String(req.params.id));

  if (!note) {
    return res.boom.notFound(`Note ${req.params.id} not found`);
  }

  req.note = note;
};

module.exports = {
  before: {
    // Every action of the controller
    all: (req, res, next) => {
      res.set('X-Notes', 'loaded');
      next();
    },
    // ... and only these ones
    'show,archive': loadNote,
  },

  // What each action accepts, checked and coerced before it runs: `?limit=2`
  // reaches the action as the number 2 and `?limit=banana` never reaches it
  params: {
    create: { title: { maxLength: 40, required: true, type: 'string' } },
    search: {
      exact: { default: false, type: 'boolean' },
      limit: { default: 10, max: 50, min: 1, type: 'integer' },
      // eslint-disable-next-line id-length -- `?q=` is the search parameter
      q: { maxLength: 60, type: 'string' },
    },
  },

  // eslint-disable-next-line sort-keys -- the hooks come first, like in rails
  archive: async (req, res) => {
    req.note.archived = true;

    return res.resource(req.note);
  },

  create: async (req, res) => {
    const note = Object.assign(
      { archived: false, id: String(++sequence) },
      req.permit('title')
    );

    notes.set(note.id, note);
    req.flash('notice', `Note ${note.id} saved`);

    return res.negotiate({
      html: () => res.redirect('/notes'),
      json: () => res.resource(note, { status: 201 }),
    });
  },

  // No res.render(), no res.json(): what the action returns is the data of
  // the /notes page
  index: async () => ({ notes: [...notes.values()] }),

  // A collection route (get /notes/search). `req.permit()` with no field is
  // everything the declaration above accepted, in the shape it declared: the
  // limit is a number and `exact` is a boolean, whatever the url said
  search: async (req) => {
    const accepted = req.permit();
    const term = String(accepted.q || '');
    const matches = (title) =>
      accepted.exact ? title === term : title.includes(term);

    return {
      notes: [...notes.values()]
        .filter((note) => matches(String(note.title || '')))
        .slice(0, accepted.limit),
    };
  },

  show: async (req) => ({ note: req.note }),
};
