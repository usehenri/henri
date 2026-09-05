// A namespaced controller: `namespace admin` maps admin/notes#index on
// /admin/notes
module.exports = {
  index: async (req, res) => res.json({ _links: {}, admin: true }),
};
