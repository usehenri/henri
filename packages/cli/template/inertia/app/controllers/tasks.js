// Controllers receive express requests. `res.render(route, { data })` renders
// app/views/pages/<route>.jsx with `data` available through useHenri().
// The Inertia client follows redirects, so a form submission ends on the
// page the controller redirects to.
const list = () => Tasks.find().sort({ createdAt: -1 }).lean();

module.exports = {
  index: async (req, res) => {
    res.render('/tasks/index', { data: { tasks: await list() } });
  },

  create: async (req, res) => {
    try {
      await Tasks.create({
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
    await Tasks.deleteOne({ _id: req.params.id });

    res.redirect('/tasks');
  },
};
