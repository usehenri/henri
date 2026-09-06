/**
 * The mails of the account flows: confirm an address, reset a password,
 * confirm a new address.
 *
 * This mailer ships with henri so a fresh application can reset a password
 * without writing a template first. It is an ordinary mailer: writing
 * `app/mailers/auth.js` replaces the actions it declares (the ones it does
 * not keep working), and writing `app/views/mailers/auth/reset.hbs` replaces
 * only the view. `henri generate authentication` writes both, so the usual
 * way to change the wording is to edit the copies in the application.
 *
 * Every action receives the public user (`{ externalId, email, roles }` plus
 * `config.user.public`) and the absolute url of the link.
 */
module.exports = {
  confirm(user, url) {
    return {
      data: { url, user },
      subject: 'Confirm your email address',
      to: user.email,
    };
  },

  emailChange(user, url) {
    return {
      data: { url, user },
      subject: 'Confirm your new email address',
      to: user.email,
    };
  },

  previews: {
    confirm: () => [
      { email: 'ada@example.com', name: 'Ada' },
      'https://example.com/confirm/h1.token.signature',
    ],
    emailChange: () => [
      { email: 'ada@example.com', name: 'Ada' },
      'https://example.com/confirm/h1.token.signature',
    ],
    reset: () => [
      { email: 'ada@example.com', name: 'Ada' },
      'https://example.com/password/reset/h1.token.signature',
    ],
  },

  reset(user, url) {
    return {
      data: { url, user },
      subject: 'Reset your password',
      to: user.email,
    };
  },
};
