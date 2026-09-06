// The pages of the account flows, and the speaker profile.
//
// Registration, the password reset and the address confirmation are henri's:
// `config.user.signup`, `passwordReset` and `confirmation` mount POST
// /signup, POST /password/forgot, GET /password/reset/:token, POST
// /password/reset, GET /confirm/:token, POST /confirm and POST
// /account/email. This application writes none of that: the tokens, the
// enumeration-safe answers and the session invalidation are the framework's
// job, and getting them wrong by hand is the whole reason they moved there.
//
// What is left here is what an application owns: which fields a signup form
// may set (`config.user.signup.fields`, which is `req.permit()` on the other
// side), and what the pages look like.

/** Attributes the profile form may set (not the email, not the password) */
const PROFILE = ['bio', 'company', 'name', 'phone'];

/**
 * `phone` is marked `personal: { expose: false }` in app/models/User.js, so
 * henri drops it from every answer it builds -- a page, an API resource, a
 * collection -- unless the render says this one may carry it. This page is
 * the person's own, and it is the only one that says so.
 */
const PRIVATE = ['phone'];

module.exports = {
  confirm: (req, res) =>
    res.render('/confirm', {
      data: { email: (req.user && req.user.email) || null },
    }),

  forgot: (req, res) => res.render('/password/forgot', { data: {} }),

  // The values a refused signup left in the flash come back through
  // `flash.values`; the messages per field arrive as `errors`
  new: (req, res) => {
    if (req.user) {
      return res.redirect('/account');
    }

    return res.render('/signup', {
      data: {
        fields: henri.accounts.settings.signup.fields,
        minLength: henri.accounts.policy().minLength,
      },
    });
  },

  reset: (req, res) =>
    res.render('/password/reset', {
      data: { minLength: henri.accounts.policy().minLength },
    }),

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
          confirmed: Boolean(req.user.confirmedAt),
          email: req.user.email,
          externalId: req.user.externalId,
          name: req.user.name,
          phone: req.user.phone,
          roles: req.user.roles,
        },
        counts: { proposals, reviews },
      },
      include: PRIVATE,
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
          account: {
            ...(await henri.model.publish(req.user)),
            ...req.permit(...PROFILE),
          },
          counts: null,
        },
        include: PRIVATE,
      });
    }

    req.flash('notice', 'Profile saved.');

    return res.redirect('/account');
  },
};
