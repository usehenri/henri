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

  // A collection route (get /notes/search)
  search: async (req) => ({
    notes: [...notes.values()].filter((note) =>
      String(note.title || '').includes(String(req.query.q || ''))
    ),
  }),

  show: async (req) => ({ note: req.note }),
};
