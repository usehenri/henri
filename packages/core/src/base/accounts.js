/**
 * The account flows: registration, password reset and address confirmation.
 *
 * henri already mounted sessions, `POST /login` and `POST /logout`, and the
 * store already gave the user model its `email`, `password` and `roles`.
 * What was left to every application was the rest of the story, which is
 * exactly where hand-rolled authentication goes wrong: tokens that never
 * expire, resets that leave the thief's session signed in, confirmation
 * links that leak in a `Referer`, and answers that tell an attacker which
 * addresses are registered.
 *
 * Each flow is two things: a **service** on `henri.accounts`, which is where
 * the rules live, and an **endpoint** the user module mounts when
 * `config.user` asks for it. An application either turns the endpoints on
 * and writes pages against them, or calls the service from its own
 * controllers; `henri generate authentication` writes the pages, the routes
 * and the tests either way.
 *
 * ```json
 * {
 *   "user": {
 *     "model": "user",
 *     "signup": { "fields": ["name"] },
 *     "passwordReset": true,
 *     "confirmation": { "required": true }
 *   }
 * }
 * ```
 *
 * The tokens are signed rather than stored (see `base/tokens.js`), so a
 * database leak hands over no working links and nothing has to be expired by
 * a cron job.
 */
const debug = require('debug')('henri:accounts');

const { respond } = require('./auth');
const { EXTERNAL_ID, hasExternalId } = require('./external-id');
const tokens = require('./tokens');

/** What a token is allowed to do; it is part of what the token signs */
const PURPOSE = Object.freeze({
  confirmation: 'confirmation',
  emailChange: 'email-change',
  reset: 'password-reset',
});

/** The mailer an application overrides to change these messages */
const MAILER = 'auth';

/**
 * The answer of a reset request and of a confirmation resend. It is the same
 * sentence whether or not the address has an account, because it has to be.
 */
const SENT =
  'If that address has an account, a message with a link is on its way.';

/**
 * The shape of an address henri accepts. Deliberately the same loose test the
 * adapters validate the column with: a stricter one here would answer 422 for
 * an address that is nonetheless in the database, which is the enumeration
 * leak this flow exists to avoid.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `1h`, `30m`, `3d`, `45s`, `250ms`, or a number of milliseconds */
const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)?$/i;

/** How long a unit lasts, in milliseconds */
const UNITS = new Map([
  ['ms', 1],
  ['s', 1000],
  ['m', 60000],
  ['h', 3600000],
  ['d', 86400000],
  ['w', 604800000],
]);

/** The defaults of each block of `config.user` */
const DEFAULTS = Object.freeze({
  confirmation: Object.freeze({
    after: '/',
    emailPath: '/account/email',
    enabled: false,
    expiresIn: 3 * 86400000,
    path: '/confirm',
    requirePassword: true,
    required: false,
  }),
  passwordReset: Object.freeze({
    after: '/',
    enabled: false,
    expiresIn: 3600000,
    login: true,
    path: '/password',
  }),
  signup: Object.freeze({
    after: '/',
    enabled: false,
    fields: Object.freeze([]),
    login: true,
    path: '/signup',
  }),
});

/**
 * A duration in milliseconds
 *
 * @param {(number|string)} value `3600000`, `'1h'`, `'30m'`
 * @param {number} fallback what to answer when the value makes no sense
 * @returns {number} milliseconds
 */
function duration(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  const match = typeof value === 'string' && DURATION.exec(value.trim());

  if (!match) {
    return fallback;
  }

  const amount = Number(match[1]) * UNITS.get((match[2] || 'ms').toLowerCase());

  return amount > 0 ? amount : fallback;
}

/**
 * Normalizes an address the way the store does before writing it
 *
 * @param {*} email anything
 * @returns {string} trimmed and lowercased, empty when it is not a string
 */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * One block of the account configuration
 *
 * `true` turns a flow on with its defaults, `false` (and nothing at all)
 * leaves it off, an object turns it on unless it says `enabled: false`.
 *
 * @param {string} name the block name (for the error message)
 * @param {*} raw what the configuration holds
 * @param {object} defaults the defaults of the block
 * @returns {object} the settings
 * @throws {TypeError} when the block is neither a boolean nor an object
 */
function section(name, raw, defaults) {
  const settings = Object.assign({}, defaults);

  if (typeof raw === 'undefined' || raw === null || raw === false) {
    return settings;
  }

  if (raw === true) {
    return Object.assign(settings, { enabled: true });
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(
      `config.user.${name} must be a boolean or an object, got ${typeof raw}`
    );
  }

  for (const key of Object.keys(defaults)) {
    if (typeof raw[key] !== 'undefined') {
      settings[key] = raw[key];
    }
  }

  settings.enabled = raw.enabled !== false;

  if (typeof defaults.expiresIn !== 'undefined') {
    settings.expiresIn = duration(settings.expiresIn, defaults.expiresIn);
  }

  if (Array.isArray(settings.fields)) {
    settings.fields = settings.fields.filter(
      (field) =>
        typeof field === 'string' &&
        ![
          'confirmedAt',
          'email',
          'password',
          'passwordChangedAt',
          'roles',
        ].includes(field)
    );
  }

  return settings;
}

/**
 * The account settings of an application (`config.user`)
 *
 * @param {object} config henri's config module (anything with get/has)
 * @returns {{confirmation: object, passwordReset: object, signup: object}} the settings
 * @throws {TypeError} when a block has the wrong shape
 */
function accountsConfig(config) {
  const raw =
    config && typeof config.has === 'function' && config.has('user')
      ? config.get('user')
      : null;
  const user = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  return {
    confirmation: section(
      'confirmation',
      user.confirmation,
      DEFAULTS.confirmation
    ),
    passwordReset: section(
      'passwordReset',
      user.passwordReset,
      DEFAULTS.passwordReset
    ),
    signup: section('signup', user.signup, DEFAULTS.signup),
  };
}

/**
 * The public identifier of a user: the uuid every record carries, or the
 * primary key when the user model opted out of it
 *
 * @param {object} adapter the user adapter facade (see base/auth.js)
 * @param {object} user a user instance
 * @returns {?string} the identifier, or null
 */
function identify(adapter, user) {
  const plain = adapter.toPlain(user) || {};

  if (hasExternalId(plain)) {
    return String(plain[EXTERNAL_ID]);
  }

  const id = adapter.userId(user);

  return typeof id === 'undefined' || id === null ? null : String(id);
}

/**
 * A date as a stable string, for the seeds
 *
 * @param {*} value a Date, a string, or nothing
 * @returns {string} an ISO string, empty when there is no date
 */
function stamp(value) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/**
 * Persists a change on a user instance, whichever ORM it comes from
 *
 * Sequelize and drizzle instances update themselves, Mongoose documents are
 * assigned and saved. Both paths go through the adapter's own hooks, so the
 * password is hashed by the store and the roles stay protected.
 *
 * @param {object} user a user instance
 * @param {object} changes the fields to write
 * @returns {Promise<object>} the user
 */
async function persist(user, changes) {
  if (typeof user.update === 'function') {
    await user.update(changes);

    return user;
  }

  Object.assign(user, changes);
  await user.save();

  return user;
}

/**
 * The account services of an application, as `henri.accounts`
 *
 * @param {Henri} henri the henri instance
 * @returns {object} the service
 */
function accounts(henri) {
  /** The deferred work started by the flows, so tests and stop() can wait */
  const pending = new Set();

  /**
   * The account settings, read again on every call so a reload is picked up
   *
   * @returns {object} `{ confirmation, passwordReset, signup }`
   */
  const settings = () => accountsConfig(henri.config);

  /**
   * The user lookup facade of the store owning the user model
   *
   * @returns {object} see base/auth.js userAdapter()
   */
  const adapter = () => henri.user.adapter();

  /**
   * The secret every token is signed with
   *
   * @returns {string} `config.secret`
   * @throws {Error} when the application has none
   */
  const secret = () => {
    if (!henri.config.has('secret')) {
      throw new Error('account tokens need a secret in your configuration');
    }

    return String(henri.config.get('secret'));
  };

  /**
   * The absolute url of a path, for the links inside the mails
   *
   * `config.url` is the canonical address of the application; without one
   * the running server's own url is used, which is right in development and
   * wrong behind a proxy, so production applications set it.
   *
   * @param {string} target a path (`/confirm/h1.xxx.yyy`)
   * @returns {string} the absolute url
   */
  const urlFor = (target) => {
    const base = henri.config.has('url')
      ? String(henri.config.get('url'))
      : (henri.server && henri.server.url) || '';

    return `${base.replace(/\/+$/, '')}${target}`;
  };

  /**
   * The fingerprint a token of that purpose is bound to.
   *
   * It is the state the action changes, so performing the action moves the
   * seed and every token minted against the old one stops verifying.
   *
   * @param {string} purpose one of PURPOSE
   * @param {object} user a user instance (with its password for a reset)
   * @returns {string} the seed
   */
  const seedFor = (purpose, user) => {
    const plain = adapter().toPlain(user) || {};

    if (purpose === PURPOSE.reset) {
      return `${stamp(plain.passwordChangedAt)}|${plain.password || ''}`;
    }

    return `${normalizeEmail(plain.email)}|${stamp(plain.confirmedAt)}`;
  };

  /**
   * The same user, with its password hash. The lookup by id deselects it, so
   * a reset seed needs a second read; nothing else does.
   *
   * @param {object} user a user instance
   * @returns {Promise<?object>} the user with its password
   */
  const withPassword = async (user) => {
    const plain = user ? adapter().toPlain(user) : null;

    if (!plain) {
      return null;
    }

    if (typeof plain.password === 'string' && plain.password.length > 0) {
      return user;
    }

    return henri.user.findByEmail(plain.email);
  };

  /**
   * Mints a token for a user
   *
   * @param {object} user a user instance
   * @param {string} purpose one of PURPOSE
   * @param {object} [options] `data` (signed alongside) and `expiresIn`
   * @returns {Promise<?string>} the token, or null when the user has no id
   */
  const tokenFor = async (user, purpose, options = {}) => {
    const subject = identify(adapter(), user);
    const source = await withPassword(user);

    if (!subject || !source) {
      return null;
    }

    const config = settings();
    const block =
      purpose === PURPOSE.reset ? config.passwordReset : config.confirmation;

    return tokens.mint({
      data: typeof options.data === 'undefined' ? null : options.data,
      expiresIn: options.expiresIn || block.expiresIn,
      purpose,
      secret: secret(),
      seed: seedFor(purpose, source),
      subject,
    });
  };

  /**
   * Verifies a token and loads the account it names
   *
   * @param {string} token the token
   * @param {string} purpose the purpose the caller expects
   * @returns {Promise<{ok: boolean, payload: ?object, reason: ?string, user: ?object}>} the answer
   */
  const consume = async (token, purpose) => {
    const claims = tokens.peek(token);
    const failed = (reason) => ({
      ok: false,
      payload: null,
      reason,
      user: null,
    });

    if (!claims || claims.purpose !== purpose) {
      return failed(claims ? 'purpose' : 'malformed');
    }

    const found = await henri.user.findById(claims.subject);

    if (!found) {
      return failed('unknown');
    }

    const user = await withPassword(found);

    if (!user) {
      return failed('unknown');
    }

    const checked = tokens.verify({
      purpose,
      secret: secret(),
      seed: seedFor(purpose, user),
      token,
    });

    return checked.ok
      ? { ok: true, payload: checked.payload, reason: null, user }
      : failed(checked.reason);
  };

  /**
   * Runs work after the answer has been written.
   *
   * Everything a reset request does once the address is known -- the lookup,
   * the token, the mail -- happens here, so the time the client measures
   * carries nothing about whether the account exists. Failures are logged;
   * they never reach the request, which is already gone.
   *
   * @param {string} what the flow, for the logs
   * @param {function} run the work
   * @returns {Promise<void>} resolves once the work settled
   */
  const later = (what, run) => {
    const task = new Promise((resolve) => setImmediate(resolve))
      .then(run)
      .catch((error) => {
        henri.pen.error('accounts', what, error.message);
        debug('%s failed: %o', what, error);
      });

    pending.add(task);
    task.finally(() => pending.delete(task));

    return task;
  };

  /**
   * The message of one of the account mails: the application's `auth` mailer
   * when it wrote one, henri's own otherwise.
   *
   * @param {string} action `confirm`, `emailChange` or `reset`
   * @param {Array} args what the action receives
   * @returns {object} a Message
   */
  const message = (action, args) => henri.mailers.message(MAILER, action, args);

  /**
   * Renders and delivers one of the account mails, through the queue when
   * the application has one (`deliverLater`), out of band otherwise. Either
   * way an SMTP timeout never blocks a request.
   *
   * @param {string} action `confirm`, `emailChange` or `reset`
   * @param {Array} args what the mailer action receives
   * @returns {Promise<*>} what the delivery answered
   */
  const mail = (action, args) => message(action, args).deliverLater();

  /**
   * The password policy, which the security floor owns. Older cores answer
   * with the minimum `encrypt()` enforces, so a flow always has something to
   * validate against.
   *
   * @returns {object} `{ minLength }` at least
   */
  const policy = () =>
    henri.user.passwordPolicy || { maxBytes: 72, minLength: 6 };

  /**
   * Checks a password against the policy
   *
   * @param {*} password the clear text password
   * @returns {{valid: boolean, errors: Array<object>}} the answer
   */
  const checkPassword = (password) => {
    if (typeof henri.user.validatePassword === 'function') {
      return henri.user.validatePassword(password);
    }

    const { maxBytes, minLength } = policy();

    if (typeof password !== 'string' || password.length === 0) {
      return {
        errors: [{ code: 'missing', message: 'is required' }],
        valid: false,
      };
    }

    if (password.length < minLength) {
      return {
        errors: [
          {
            code: 'too_short',
            message: `must be at least ${minLength} characters`,
            minLength,
          },
        ],
        valid: false,
      };
    }

    if (Buffer.byteLength(password, 'utf8') > maxBytes) {
      return {
        errors: [{ code: 'too_long', maxBytes, message: 'is too long' }],
        valid: false,
      };
    }

    return { errors: [], valid: true };
  };

  /**
   * Creates an account
   *
   * `roles` is never assignable here: the store drops it from a mass
   * assignment, and the permitted fields are `email`, `password` and
   * whatever `config.user.signup.fields` lists.
   *
   * @param {object} attributes the permitted attributes
   * @returns {Promise<{ok: boolean, errors: object, user: ?object}>} the answer
   */
  const register = async (attributes = {}) => {
    const config = settings();
    const email = normalizeEmail(attributes.email);
    const password = attributes.password;
    const errors = {};

    if (!email) {
      errors.email = 'is required';
    } else if (!EMAIL.test(email)) {
      errors.email = 'is not a valid email';
    }

    const checked = checkPassword(password);

    if (!checked.valid) {
      errors.password = checked.errors[0].message;
    }

    if (!errors.email && (await henri.user.findByEmail(email))) {
      errors.email = 'is already registered';
    }

    if (Object.keys(errors).length > 0) {
      return { errors, ok: false, user: null };
    }

    const values = { email, password };

    for (const field of config.signup.fields) {
      if (typeof attributes[field] !== 'undefined') {
        values[field] = attributes[field];
      }
    }

    if (config.confirmation.enabled) {
      values.confirmedAt = null;
    }

    let user = null;

    try {
      user = await henri._user.create(values);
    } catch (error) {
      const failures = henri.model.errors(error);

      if (!failures) {
        throw error;
      }

      return { errors: failures, ok: false, user: null };
    }

    if (config.confirmation.enabled) {
      later('confirmation mail', () => sendConfirmation(user));
    }

    return { errors: {}, ok: true, user };
  };

  /**
   * Mints a confirmation token and mails it
   *
   * @param {object} user a user instance
   * @returns {Promise<?string>} the token that was mailed
   */
  const sendConfirmation = async (user) => {
    const token = await tokenFor(user, PURPOSE.confirmation);

    if (!token) {
      return null;
    }

    await mail('confirm', [
      henri.user.publicUser(user),
      urlFor(`${settings().confirmation.path}/${token}`),
    ]);

    return token;
  };

  /**
   * Mints a reset token and mails it
   *
   * @param {object} user a user instance
   * @returns {Promise<?string>} the token that was mailed
   */
  const sendReset = async (user) => {
    const token = await tokenFor(user, PURPOSE.reset);

    if (!token) {
      return null;
    }

    await mail('reset', [
      henri.user.publicUser(user),
      urlFor(`${settings().passwordReset.path}/reset/${token}`),
    ]);

    return token;
  };

  /**
   * Asks for a password reset.
   *
   * Nothing here is awaited by the endpoint: the lookup and the mail run
   * after the answer was written, so a known address and an unknown one cost
   * the request exactly the same.
   *
   * @param {string} email the address
   * @returns {Promise<void>} resolves once the work settled
   */
  const requestPasswordReset = (email) =>
    later('password reset', async () => {
      const user = await henri.user.findByEmail(email);

      if (!user) {
        debug('no account for that address; nothing was sent');

        return;
      }

      await sendReset(user);
    });

  /**
   * Asks for the confirmation mail again
   *
   * @param {string} email the address
   * @returns {Promise<void>} resolves once the work settled
   */
  const requestConfirmation = (email) =>
    later('confirmation', async () => {
      const user = await henri.user.findByEmail(email);
      const plain = user ? adapter().toPlain(user) : null;

      if (!user || (plain && plain.confirmedAt)) {
        debug('nothing to confirm for that address');

        return;
      }

      await sendConfirmation(user);
    });

  /**
   * Changes a password from a reset token.
   *
   * The token dies with the password it was minted against, and
   * `passwordChangedAt` moves, which is what makes every other session of
   * that account stop deserializing (see the user module).
   *
   * @param {string} token the token from the mail
   * @param {string} password the new password
   * @returns {Promise<{ok: boolean, errors: object, reason: ?string, user: ?object}>} the answer
   */
  const resetPassword = async (token, password) => {
    const checked = checkPassword(password);

    if (!checked.valid) {
      return {
        errors: { password: checked.errors[0].message },
        ok: false,
        reason: 'password',
        user: null,
      };
    }

    const found = await consume(token, PURPOSE.reset);

    if (!found.ok) {
      return { errors: {}, ok: false, reason: found.reason, user: null };
    }

    const user = await persist(found.user, {
      password,
      passwordChangedAt: new Date(),
    });

    return { errors: {}, ok: true, reason: null, user };
  };

  /**
   * Confirms an address from a token.
   *
   * An `email-change` token carries the new address: that is when the change
   * takes effect, never before, so an address nobody proved they can read
   * never becomes the address of an account.
   *
   * @param {string} token the token from the mail
   * @returns {Promise<{ok: boolean, errors: object, reason: ?string, user: ?object}>} the answer
   */
  const confirm = async (token) => {
    const claims = tokens.peek(token);
    const purpose =
      claims && claims.purpose === PURPOSE.emailChange
        ? PURPOSE.emailChange
        : PURPOSE.confirmation;
    const found = await consume(token, purpose);

    if (!found.ok) {
      return { errors: {}, ok: false, reason: found.reason, user: null };
    }

    const changes = { confirmedAt: new Date() };

    if (purpose === PURPOSE.emailChange) {
      const email = normalizeEmail(
        found.payload.data && found.payload.data.email
      );

      if (!email || !EMAIL.test(email)) {
        return { errors: {}, ok: false, reason: 'malformed', user: null };
      }

      const taken = await henri.user.findByEmail(email);

      if (
        taken &&
        identify(adapter(), taken) !== identify(adapter(), found.user)
      ) {
        return {
          errors: { email: 'is already registered' },
          ok: false,
          reason: 'taken',
          user: null,
        };
      }

      changes.email = email;
    }

    return {
      errors: {},
      ok: true,
      reason: null,
      user: await persist(found.user, changes),
    };
  };

  /**
   * Asks for an address change: nothing is written, a link is mailed to the
   * new address and the account keeps the one it has until that link is
   * followed.
   *
   * @param {object} user the signed in user
   * @param {string} email the new address
   * @returns {Promise<{ok: boolean, errors: object}>} the answer
   */
  const requestEmailChange = async (user, email) => {
    const wanted = normalizeEmail(email);
    const plain = adapter().toPlain(user) || {};

    if (!wanted || !EMAIL.test(wanted)) {
      return { errors: { email: 'is not a valid email' }, ok: false };
    }

    if (wanted === normalizeEmail(plain.email)) {
      return { errors: { email: 'is already your address' }, ok: false };
    }

    const token = await tokenFor(user, PURPOSE.emailChange, {
      data: { email: wanted },
    });

    if (!token) {
      return { errors: { email: 'could not be changed' }, ok: false };
    }

    later('address change', () =>
      mail('emailChange', [
        Object.assign({}, henri.user.publicUser(user), { email: wanted }),
        urlFor(`${settings().confirmation.path}/${token}`),
      ])
    );

    return { errors: {}, ok: true };
  };

  /**
   * Is this account allowed in? `config.user.confirmation.required` keeps an
   * unconfirmed address out of a session.
   *
   * @param {object} user a user instance
   * @returns {boolean} true when the account may open a session
   */
  const allowed = (user) => {
    const config = settings();

    if (!config.confirmation.enabled || !config.confirmation.required) {
      return true;
    }

    return Boolean((adapter().toPlain(user) || {}).confirmedAt);
  };

  /**
   * Waits for the work the flows started after their answers
   *
   * @returns {Promise<boolean>} true once everything settled
   */
  const drain = async () => {
    while (pending.size > 0) {
      await Promise.all(Array.from(pending));
    }

    return true;
  };

  return {
    PURPOSE,
    allowed,
    checkPassword,
    confirm,
    consume,
    drain,
    identify: (user) => identify(adapter(), user),
    pending,
    policy,
    register,
    requestConfirmation,
    requestEmailChange,
    requestPasswordReset,
    resetPassword,
    sendConfirmation,
    sendReset,
    get settings() {
      return settings();
    },
    tokenFor,
    urlFor,
  };
}

/**
 * The endpoints of the account flows.
 *
 * They answer JSON to API clients and redirect browsers, the way `POST
 * /login` does: they run ahead of `res.render()`, and a form post should end
 * in a redirect anyway. What a page needs to show afterwards travels in the
 * flash: `errors` (a bag keyed by field, which the view options hand to the
 * renderers as `errors`), `values` and `notice`.
 *
 * @param {Henri} henri the henri instance
 * @returns {Express.Router} the router
 */
function router(henri) {
  const routes = henri.server.express.Router();
  const service = henri.accounts;

  /**
   * The settings of the flows
   *
   * @returns {object} `{ confirmation, passwordReset, signup }`
   */
  const settings = () => service.settings;

  /**
   * Answers a failed form post: JSON gets the errors, a browser is sent back
   * to the page with them in the flash
   *
   * @param {Express.Request} req the request
   * @param {Express.Response} res the response
   * @param {string} back where to send a browser
   * @param {object} errors the errors, keyed by field
   * @param {object} [values] what to put back in the form
   * @returns {*} the answer
   */
  const refuse = (req, res, back, errors, values = {}) => {
    req.flash('errors', errors);
    req.flash('values', values);

    return respond(res, {
      html: () => res.redirect(303, back),
      json: () =>
        res.boom.badData('the form could not be accepted', { errors }),
    });
  };

  /**
   * Opens a session for a user, with a fresh session id
   *
   * @param {Express.Request} req the request
   * @param {object} user the user
   * @returns {Promise<void>} resolves once the session holds the user
   */
  const signIn = (req, user) =>
    new Promise((resolve, reject) => {
      /**
       * Hands the user to passport once the session is new
       *
       * @returns {void} nothing
       */
      const login = () =>
        req.logIn(user, (error) => (error ? reject(error) : resolve()));

      if (req.session && typeof req.session.regenerate === 'function') {
        return req.session.regenerate((error) =>
          error ? reject(error) : login()
        );
      }

      return login();
    });

  if (settings().signup.enabled) {
    const { fields, path: signupPath } = settings().signup;

    routes.post(signupPath, async (req, res, next) => {
      try {
        const attributes = henri
          .params(req)
          .permit(['email', 'password'].concat(fields));
        const { after, login } = settings().signup;
        const values = Object.assign({}, attributes);

        delete values.password;

        const created = await service.register(attributes);

        if (!created.ok) {
          return refuse(req, res, signupPath, created.errors, values);
        }

        const me = henri.user.publicUser(created.user);

        if (login && service.allowed(created.user)) {
          await signIn(req, created.user);
        }

        return respond(res, {
          html: () => {
            req.flash(
              'notice',
              service.allowed(created.user)
                ? 'Welcome.'
                : 'Check your inbox to confirm your address.'
            );

            return res.redirect(303, after);
          },
          json: () => res.status(201).json({ user: me }),
        });
      } catch (error) {
        return next(error);
      }
    });
  }

  if (settings().passwordReset.enabled) {
    const base = settings().passwordReset.path;

    routes.post(`${base}/forgot`, (req, res) => {
      const email = String(henri.params(req).all().email || '').trim();

      if (!EMAIL.test(email)) {
        return refuse(
          req,
          res,
          `${base}/forgot`,
          { email: 'is not a valid email' },
          {}
        );
      }

      // The answer is written first and is the same either way; the lookup
      // and the mail happen after it, so nothing a client can measure says
      // whether the address has an account
      const answered = respond(res, {
        html: () => {
          req.flash('notice', SENT);

          return res.redirect(303, `${base}/forgot`);
        },
        json: () => res.status(202).json({ message: SENT, ok: true }),
      });

      service.requestPasswordReset(email);

      return answered;
    });

    routes.get(`${base}/reset/:token`, async (req, res, next) => {
      try {
        res.set('Cache-Control', 'no-store');
        res.set('Referrer-Policy', 'no-referrer');

        const token = String(req.params.token || '');
        const found = await service.consume(token, service.PURPOSE.reset);

        if (!found.ok) {
          return respond(res, {
            html: () => {
              req.flash('alert', 'That link is no longer valid.');

              return res.redirect(303, `${base}/forgot`);
            },
            json: () =>
              res.boom.badRequest('that link is no longer valid', {
                reason: found.reason,
              }),
          });
        }

        // The token leaves the url here: it goes into the session and the
        // form posts without it, so it cannot leak through a Referer or the
        // browser history
        if (req.session) {
          req.session.passwordResetToken = token;
        }

        return respond(res, {
          html: () => res.redirect(303, `${base}/reset`),
          json: () => res.json({ ok: true }),
        });
      } catch (error) {
        return next(error);
      }
    });

    routes.post(`${base}/reset`, async (req, res, next) => {
      try {
        res.set('Cache-Control', 'no-store');

        const params = henri.params(req).all();
        const token =
          (req.session && req.session.passwordResetToken) ||
          String(params.token || '');
        const { after, login } = settings().passwordReset;
        const changed = await service.resetPassword(token, params.password);

        if (!changed.ok) {
          return changed.reason === 'password'
            ? refuse(req, res, `${base}/reset`, changed.errors)
            : respond(res, {
                html: () => {
                  req.flash('alert', 'That link is no longer valid.');

                  return res.redirect(303, `${base}/forgot`);
                },
                json: () =>
                  res.boom.badRequest('that link is no longer valid', {
                    reason: changed.reason,
                  }),
              });
        }

        if (req.session) {
          delete req.session.passwordResetToken;
        }

        if (login) {
          await signIn(req, changed.user);
        }

        const me = henri.user.publicUser(changed.user);

        return respond(res, {
          html: () => {
            req.flash('notice', 'Your password was changed.');

            return res.redirect(303, login ? after : '/login');
          },
          json: () => res.json({ ok: true, user: login ? me : null }),
        });
      } catch (error) {
        return next(error);
      }
    });
  }

  if (settings().confirmation.enabled) {
    const { emailPath, path: base } = settings().confirmation;

    routes.get(`${base}/:token`, async (req, res, next) => {
      try {
        res.set('Cache-Control', 'no-store');
        res.set('Referrer-Policy', 'no-referrer');

        const { after } = settings().confirmation;
        const done = await service.confirm(String(req.params.token || ''));

        if (!done.ok) {
          return respond(res, {
            html: () => {
              req.flash('alert', 'That link is no longer valid.');

              return res.redirect(303, base);
            },
            json: () =>
              res.boom.badRequest('that link is no longer valid', {
                reason: done.reason,
              }),
          });
        }

        return respond(res, {
          html: () => {
            req.flash('notice', 'Your address is confirmed.');

            return res.redirect(303, after);
          },
          json: () =>
            res.json({ ok: true, user: henri.user.publicUser(done.user) }),
        });
      } catch (error) {
        return next(error);
      }
    });

    routes.post(base, (req, res) => {
      const params = henri.params(req).all();
      const email = String(
        params.email || (req.user && req.user.email) || ''
      ).trim();

      if (!EMAIL.test(email)) {
        return refuse(req, res, base, { email: 'is not a valid email' }, {});
      }

      const answered = respond(res, {
        html: () => {
          req.flash('notice', SENT);

          return res.redirect(303, base);
        },
        json: () => res.status(202).json({ message: SENT, ok: true }),
      });

      service.requestConfirmation(email);

      return answered;
    });

    routes.post(emailPath, async (req, res, next) => {
      try {
        const { requirePassword } = settings().confirmation;

        if (!req.user) {
          return respond(res, {
            html: () => res.redirect(303, henri.user.settings.loginPath),
            json: () => res.boom.unauthorized('Authentication required'),
          });
        }

        const params = henri.params(req).all();

        if (requirePassword) {
          const account = await henri.user.findByEmail(req.user.email);
          const hash = account && account.password;
          let ok = false;

          try {
            ok = Boolean(
              hash &&
              (await henri.user.compare(String(params.password || ''), hash))
            );
          } catch (error) {
            ok = false;
          }

          if (!ok) {
            return refuse(req, res, emailPath, {
              password: 'is not your current password',
            });
          }
        }

        const asked = await service.requestEmailChange(req.user, params.email);

        if (!asked.ok) {
          return refuse(req, res, emailPath, asked.errors);
        }

        return respond(res, {
          html: () => {
            req.flash(
              'notice',
              'Check the new address: it becomes yours once you follow the link.'
            );

            return res.redirect(303, emailPath);
          },
          json: () =>
            res.status(202).json({
              message:
                'the address changes once the link in the message is followed',
              ok: true,
            }),
        });
      } catch (error) {
        return next(error);
      }
    });
  }

  return routes;
}

module.exports = accounts;
module.exports.DEFAULTS = DEFAULTS;
module.exports.EMAIL = EMAIL;
module.exports.MAILER = MAILER;
module.exports.PURPOSE = PURPOSE;
module.exports.SENT = SENT;
module.exports.accountsConfig = accountsConfig;
module.exports.duration = duration;
module.exports.normalizeEmail = normalizeEmail;
module.exports.router = router;
