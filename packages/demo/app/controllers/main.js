let counter = 0;

module.exports = {
  // Answers something different every time: replayed answers are told apart
  echo: async (req, res) =>
    res.json({
      _links: { self: { href: req.originalUrl } },
      body: req.body,
      sequence: ++counter,
    }),

  // The `root` route of config/routes.js
  home: async (req, res) =>
    res.render('/', { data: { artwork: await Artwork.find() } }),

  limited: async (req, res) => res.json({ _links: {}, ok: true }),

  list: async (req, res) => {
    await Artwork.create({ title: 'hello', year: 1912 });
    res.render('/', { data: { artwork: await Artwork.find() } });
  },

  version: async (req, res) =>
    res.json({ _links: {}, version: req.apiVersion }),
};
