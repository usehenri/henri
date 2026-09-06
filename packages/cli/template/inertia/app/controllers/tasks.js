// Controllers receive express requests. `res.render(route, { data })` renders
// app/views/pages/<route>.jsx with `data` available through useHenri().
// The Inertia client follows redirects, so a form submission ends on the
// page the controller redirects to.
const list = () => Task.find().sort({ createdAt: -1 }).lean();

/** @type {import('@usehenri/core').Controller} */
module.exports = {
  index: async (req, res) => {
    res.render('/tasks/index', { data: { tasks: await list() } });
  },

  create: async (req, res) => {
    try {
      await Task.create({
        category: req.body.category,
        name: req.body.name,
      });

      return res.redirect('/tasks');
    } catch (error) {
      // Rendering with errors: they show up in the <Form> render prop
      res.inertia.errors({ name: error.message });

      return res.render('/tasks/index', { data: { tasks: await list() } });
    }
  },

  destroy: async (req, res) => {
    await Task.deleteOne({ _id: req.params.id });

    res.redirect('/tasks');
  },
};
