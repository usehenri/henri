// Controllers are plain objects of `(req, res)` functions, wired by
// config/routes.js. Models are globals: `Task` comes from app/models/Task.js.
// The annotation is what gives `req` and `res` completion in an editor.

/** @type {import('@usehenri/core').Controller} */
module.exports = {
  home: async (req, res) => {
    res.render('/', { data: { tasks: await Task.find() } });
  },
};
