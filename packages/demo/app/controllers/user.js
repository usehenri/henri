module.exports = {
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

  profile: async (req, res) =>
    res.render('/index', { data: { artwork: await Artwork.find() } }),
};
