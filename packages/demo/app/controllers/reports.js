// Everything in here answers through `res.json()`, the one call that used to
// leave the server without the two passes `res.render()` and `res.resource()`
// have always run (see base/answers.js).
//
// `hand` declares nothing: it is the controller the survey was about, and the
// floor is what stops it -- `gender`, `phone` and `nationalId` are marked
// `personal: { expose: false }` on the user model and never reach the wire,
// whatever this action puts in the object.
//
// `digest` declares what it answers, which buys three things a floor cannot:
// the rows are Memo records, so `ownerId` leaves as the owner's `externalId`
// even though these are objects a controller built; `secret` is not declared,
// so it does not leave; and `henri openapi` describes the 200.
module.exports = {
  answers: {
    digest: {
      rows: { model: 'Memo', type: 'array' },
      total: { required: true, type: 'integer' },
    },
    // A column of the user model under a name of its own: henri cannot see
    // that `who` holds an address, so the declaration says it
    profile: {
      age: { from: 'User.age', type: 'integer' },
      who: { from: 'User.email', type: 'string' },
    },
    // The declared way to carry a field the model marked `expose: false`,
    // and the mirror of `res.resource(record, { include })`
    sensitive: {
      gender: { expose: true, from: 'User.gender', type: 'string' },
    },
  },

  digest: async (req, res) => {
    const memos = await Memo.find();

    return res.json({
      rows: memos.map((memo) => ({
        ownerId: memo.ownerId,
        title: memo.title,
      })),
      secret: 'undeclared',
      total: memos.length,
    });
  },

  hand: async (req, res) => {
    const user = await User.findByKey(req.user.id || req.user._id);

    return res.json({
      rows: [
        {
          email: user.email,
          gender: user.gender,
          id: user.id || user._id,
          nationalId: user.nationalId,
          phone: user.phone,
        },
      ],
      total: 1,
    });
  },

  profile: async (req, res) =>
    res.json({ age: req.user.age, who: req.user.email }),

  // The records themselves rather than a copy of their fields: those carry
  // their model, so the floor alone drops the primary key and publishes the
  // foreign keys, declaration or not
  records: async (req, res) => res.json({ rows: await Memo.find() }),

  sensitive: async (req, res) => res.json({ gender: req.user.gender }),
};
