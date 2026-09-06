// A mailer for the tests of @usehenri/core: one action rendering the derived
// text part, one shipping an authored one, and one bypassing the views.
module.exports = {
  confirm(user) {
    return {
      data: { token: 'abc123', user },
      subject: `Confirm ${user.email}`,
      to: user.email,
    };
  },

  defaults: {
    from: 'Henri <no-reply@example.com>',
  },

  digest(user, count) {
    return {
      data: { count, user },
      layout: false,
      subject: 'Your digest',
      to: user.email,
    };
  },

  plain(user) {
    return {
      html: '<p>Written by hand</p>',
      subject: 'No view',
      to: user.email,
    };
  },

  previews: {
    confirm: () => [{ email: 'ada@example.com', name: 'Ada' }],
    digest: () => [{ email: 'ada@example.com', name: 'Ada' }, 3],
  },
};
