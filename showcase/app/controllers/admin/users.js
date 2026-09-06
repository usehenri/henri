// Who is in the program committee.
//
// Roles are never mass assignable: `User.create(req.body)` and
// `user.update(req.body)` drop `roles` whatever the adapter, which is why
// promoting somebody goes through `User.setRoles()` in an action of its own,
// behind `roles: ['admin']`.

/** The roles this application knows about */
const ROLES = ['speaker', 'admin'];

module.exports = {
  index: async (req, res) => {
    const { records, page, perPage, total, pages } = await User.paginate({
      ...req.pagination(),
      order: 'name',
    });
    const counts = await Promise.all(
      records.map((user) => Proposal.count({ speakerId: user.id }))
    );
    const reviews = await Promise.all(
      records.map((user) => Review.count({ reviewerId: user.id }))
    );

    return res.render('/admin/users/index', {
      data: {
        page,
        pages,
        perPage,
        total,
        users: records.map((user, index) => ({
          company: user.company,
          email: user.email,
          id: user.id,
          name: user.name,
          proposals: counts[index],
          reviews: reviews[index],
          roles: user.roles || [],
        })),
      },
    });
  },

  role: async (req, res) => {
    const { role } = req.permit('role');
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.boom.notFound(`No user ${req.params.id}`);
    }

    if (!ROLES.includes(role)) {
      return res.boom.badData('unknown role', {
        errors: { role: `must be one of ${ROLES.join(', ')}` },
      });
    }

    if (String(user.id) === String(req.user.id) && role === 'speaker') {
      req.flash('alert', 'Demoting yourself would lock you out of here.');

      return res.redirect('/admin/users');
    }

    const roles = role === 'admin' ? ['speaker', 'admin'] : ['speaker'];

    await User.setRoles(user.id, roles);
    req.flash('notice', `${user.name} is now ${roles.join(' + ')}.`);

    return res.redirect('/admin/users');
  },
};
