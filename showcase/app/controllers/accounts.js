// Registration and the speaker profile. henri has no registration endpoint
// on purpose: creating a user is application code, and `req.permit()` is what
// keeps a form from granting itself a role (`roles` is dropped from a mass
// assignment whatever the adapter).

/** Attributes a signup form may set */
const SIGNUP = ['bio', 'company', 'email', 'name', 'password'];

/** Attributes the profile form may set (not the email, not the password) */
const PROFILE = ['bio', 'company', 'name'];

/**
 * Logs a user in, the way POST /login does (passport's req.logIn)
 *
 * @param {object} req Express request
 * @param {object} user The user instance
 * @returns {Promise<void>} Resolves once the session holds the user
 */
const logIn = (req, user) =>
  new Promise((resolve, reject) => {
    req.logIn(user, (error) => (error ? reject(error) : resolve()));
  });

module.exports = {
  create: async (req, res) => {
    const attributes = req.permit(...SIGNUP);
    const errors = {};

    if (!attributes.email) {
      errors.email = 'is required';
    }

    if (!attributes.password) {
      errors.password = 'is required';
    }

    if (
      attributes.email &&
      (await henri.user.findByEmail(String(attributes.email)))
    ) {
      errors.email = 'is already registered';
    }

    if (Object.keys(errors).length === 0) {
      try {
        const user = await User.create(attributes);

        await logIn(req, user);
        req.flash('notice', `Welcome, ${user.name}.`);

        return res.negotiate({
          html: () => res.redirect('/proposals/mine'),
          json: () =>
            res.status(201).json({ user: henri.user.publicUser(user) }),
        });
      } catch (error) {
        const failures = henri.model.errors(error);

        if (!failures) {
          throw error;
        }

        Object.assign(errors, failures);
      }
    }

    return res.negotiate({
      html: () => {
        res.inertia.errors(errors);

        return res.render('/signup', { data: { values: attributes } });
      },
      json: () =>
        res.boom.badData('the account could not be created', { errors }),
    });
  },

  new: (req, res) => {
    if (req.user) {
      return res.redirect('/account');
    }

    return res.render('/signup', { data: { values: {} } });
  },

  show: async (req, res) => {
    const [proposals, reviews] = await Promise.all([
      Proposal.count({ speakerId: req.user.id }),
      Review.count({ reviewerId: req.user.id }),
    ]);

    return res.render('/account', {
      data: {
        account: {
          bio: req.user.bio,
          company: req.user.company,
          email: req.user.email,
          id: req.user.id,
          name: req.user.name,
          roles: req.user.roles,
        },
        counts: { proposals, reviews },
      },
    });
  },

  update: async (req, res) => {
    try {
      await req.user.update(req.permit(...PROFILE));
    } catch (error) {
      const errors = henri.model.errors(error);

      if (!errors) {
        throw error;
      }

      res.inertia.errors(errors);

      return res.render('/account', {
        data: {
          account: { ...req.user.toJSON(), ...req.permit(...PROFILE) },
          counts: null,
        },
      });
    }

    req.flash('notice', 'Profile saved.');

    return res.redirect('/account');
  },
};
