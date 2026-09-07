module.exports = {
  // The other side of a relation: the memos naming this user, which the
  // Memo model declared (`ownerId: { ref: 'User' }`). Every one of them is
  // asked `show` against app/policies/memo.js before it is embedded, so a
  // memo this person may not read is absent rather than hinted at (see
  // base/embeds.js)
  embeds: { memos: { memos: { limit: 2, through: 'Memo.ownerId' } } },

  // eslint-disable-next-line sort-keys -- the declaration comes first
  admin: async (req, res) =>
    res.json({ ok: true, user: henri.user.publicUser(req.user) }),

  create: async (req, res) => {
    // Only these fields can be mass-assigned: anything else sent in the body
    // (roles, timestamps, ...) is ignored
    const data = req.permit('email', 'password', 'name', 'age', 'gender');

    if (!data.email || !data.password) {
      return res.boom.badRequest('email and password are required');
    }

    data.email = String(data.email).trim().toLowerCase();

    if (await henri.user.findByEmail(data.email)) {
      return res.boom.conflict(`L'utilisateur existe déjà`);
    }

    try {
      const user = await User.create(data);

      return res.status(201).json({
        status: 'ok',
        user: henri.user.publicUser(user),
      });
    } catch (error) {
      return res.boom.badData(error.message);
    }
  },

  // A user and the memos they wrote, in one answer. `subject` is not
  // needed here: the record itself is what the relation hangs off.
  //
  // `?who=` is deliberately open to any member, because it is what shows
  // the per-record question: asking for somebody else's record answers
  // that record and an **empty** list, since app/policies/memo.js lets
  // only the author read a memo and every embedded record is asked
  memos: async (req, res) => {
    const who = req.query.who
      ? await User.findById(String(req.query.who))
      : req.user;

    if (!who) {
      return res.notFound(`User ${req.query.who} not found`);
    }

    return res.resource(who, { embed: ['memos'] });
  },

  profile: async (req, res) =>
    res.render('/index', { data: { artwork: await Artwork.find() } }),

  // The dangerous export, and the one that proves the gate: a user row is
  // where every `personal: { expose: false }` column of this application
  // lives (`gender`, `phone`, `nationalId`, and the password the adapter
  // adds), and none of them is in the file. `scope: false` says out loud
  // that this export is everybody, which the route's `roles` is what
  // guards (see base/csv.js)
  report: async (req, res) =>
    res.csv(User, { filename: 'people', scope: false }),
};
