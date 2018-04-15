module.exports = {
  create: async (req, res) => {
    try {
      const newUser = req.body;

      if (newUser.email && (await User.findOne({ email: newUser.email }))) {
        return res.status(500).json({ msg: `L'utilisateur existe déjà` });
      }
      const user = await User.create(req.body);

      return res.json({ status: 'ok', user });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(error);

      return res.status(500).json({ error, status: 'failed' });
    }
  },
};
