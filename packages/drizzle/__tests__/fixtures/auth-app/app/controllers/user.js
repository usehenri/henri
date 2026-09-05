/* global User */
// The demo's user controller (packages/demo/app/controllers/user.js) with a
// JSON profile, so the login flow of core runs on the drizzle store
module.exports = {
  admin: async (req, res) =>
    res.json({ ok: true, user: henri.user.publicUser(req.user) }),

  create: async (req, res) => {
    const data = req.permit('email', 'password', 'name', 'age', 'gender');

    if (!data.email || !data.password) {
      return res.boom.badRequest('email and password are required');
    }

    data.email = String(data.email).trim().toLowerCase();

    if (await henri.user.findByEmail(data.email)) {
      return res.boom.conflict('The user already exists');
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
    res.json({ user: henri.user.publicUser(req.user) }),
};
