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

  // The locale of a mail is the recipient's: `for` is the record, and
  // config.i18n.from.user names the column henri reads it from. It works
  // from a job, where there is no request to ask (see guides/i18n.md)
  greet(user) {
    return {
      data: { name: user.name },
      for: user,
      subject: 'Hello',
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
    greet: () => [{ email: 'ada@example.com', locale: 'fr', name: 'Ada' }],
  },
};
