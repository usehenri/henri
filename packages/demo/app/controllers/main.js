let counter = 0;

module.exports = {
  // Answers something different every time: replayed answers are told apart
  echo: async (req, res) =>
    res.json({
      _links: { self: { href: req.originalUrl } },
      body: req.body,
      sequence: ++counter,
    }),

  // What the i18n middleware decided, and what a controller does with it
  hello: async (req, res) =>
    res.render('/hello', {
      data: {
        count: Number(req.query.count || 2),
        greeting: req.t('greeting', { name: req.query.name || 'Ada' }),
        locale: req.locale,
        name: req.query.name || 'Ada',
        source: req.localeSource,
      },
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
