const { fail } = require('./errors');

/**
 * Time zones: the zone of the application, the zone of a person, and the
 * zone a request is answered in. `1.time.js` is the module around this
 * file, and this header is the document.
 *
 * ## What was already true, measured
 *
 * This file was written after reading what henri actually stores, because
 * the answer decided the design. Every store henri has keeps a moment as a
 * moment, and the round trip was exercised with the process fixed to
 * `Pacific/Kiritimati` (UTC+14) and `Pacific/Niue` (UTC-11), writing under
 * one and reading under the other:
 *
 * | store                | column                        | instant | ms     |
 * | -------------------- | ----------------------------- | ------- | ------ |
 * | drizzle / sqlite     | `integer`, epoch milliseconds | kept    | yes    |
 * | drizzle / postgres   | `timestamp with time zone`    | kept    | yes    |
 * | drizzle / mysql      | `datetime(3)`                 | kept    | yes    |
 * | mongoose             | BSON date, int64 epoch ms     | kept    | yes    |
 * | sequelize / mssql    | `DATETIMEOFFSET`              | kept    | yes    |
 * | sequelize / sqlite   | `DATETIME`, text, `+00:00`    | kept    | yes    |
 * | sequelize / postgres | `timestamp with time zone`    | kept    | yes    |
 * | sequelize / mysql    | `DATETIME`                    | kept    | **no** |
 *
 * So **storage was never the problem** and this file does not touch it.
 *
 * The last row is the one measured defect, and it is not one an application
 * reaches: Sequelize asks for a bare `DATETIME` on MySQL, which is
 * `DATETIME(0)`, so `12:34:56.789` is stored as `12:34:56`. A MySQL store
 * is `@usehenri/drizzle` with the dialect chosen and gets `datetime(3)`;
 * Sequelize is behind `@usehenri/mssql` alone, where the column is a
 * `DATETIMEOFFSET`. It is a precision bug rather than a zone one, it reads
 * the same in every zone, and the suites that run the Sequelize adapter
 * against a MySQL server are what see it.
 *
 * The wire was not the problem either: a `Date` reaches `res.json()`
 * untouched (`base/references.js` and `base/privacy.js` both treat one as a
 * leaf) and `JSON.stringify` writes ISO-8601 with a `Z`. An Inertia or
 * React page therefore receives an unambiguous instant already.
 *
 * **What was broken is rendering on the server.** `Intl.DateTimeFormat`
 * with no `timeZone` resolves to the process's zone, so one instant --
 * `2026-03-08T10:00:00Z` -- printed as three different calendar days
 * depending on where the server happened to be deployed:
 *
 * ```text
 * TZ=UTC                 2026-03-08
 * TZ=Pacific/Kiritimati  2026-03-09
 * TZ=Pacific/Niue        2026-03-07
 * ```
 *
 * That is the off-by-one-day bug, and `TZ` is not a thing an application
 * chose. So the zone a server renders in stops being the deployment's and
 * becomes the application's, and it defaults to `UTC` rather than to
 * `process.env.TZ`: a value nobody set should be the same everywhere.
 *
 * ## A zone is not one thing
 *
 * There are two, and they are read from different places for the same
 * reason `config.i18n` has both:
 *
 * - **the application's**, `config.timeZone`, which is what a server
 *   renders in when nothing knows better. `UTC` unless it is set.
 * - **a person's**, which lives on their record, in the column
 *   `timeZone.from.user` names -- exactly where `i18n.from.user` puts their
 *   language, and read back by `henri.time.forUser(record)`.
 *
 * The person's zone is on the record and not only on the session because
 * **a mail's zone is the recipient's** (see `base/mail-message.js`). A
 * nightly digest, an administrator acting on somebody else's account and a
 * job retrying a delivery an hour later all produce a mail whose reader is
 * not whoever made the request, and two of those have no request at all. A
 * record is the one thing a job has. That is the same argument the locale
 * of a mail already makes, and it is the reason both live on the user.
 *
 * ## Where a request's zone comes from, and why it is visible
 *
 * `decide()` answers in one order and says which step answered:
 *
 * 1. `explicit` -- `req.setTimeZone()`
 * 2. `user` -- the column `timeZone.from.user` names on the signed-in user
 * 3. `query` -- `?tz=Europe/Paris` (`timeZone.from.query`)
 * 4. `cookie` -- the cookie `timeZone.from.cookie` names. henri **reads**
 *    it and never writes it, for the reason the locale cookie is only read
 * 5. `header` -- the header `timeZone.from.header` names
 * 6. `default` -- `config.timeZone`
 *
 * The answer is `req.timeZone` and the step is `req.timeZoneSource`, where
 * they can be read, logged and asserted, because a decision nobody can see
 * is a decision nobody can debug. That is `req.localeSource`'s rule.
 *
 * **Every step but the last is off unless the application turns it on.**
 * This is the one place the design differs from the locale's, and it is
 * deliberate: `Accept-Language` is a header browsers send, negotiated,
 * standard and meant for exactly this, and there is no such header for a
 * zone. What a browser can offer is `Intl.DateTimeFormat().resolvedOptions()
 * .timeZone`, which reaches a server only in a cookie or a header the
 * application's own script sets. henri will read either, and neither is a
 * guess it makes on its own.
 *
 * **A zone that arrived from a client is a display preference and never an
 * authorization input.** Anyone can send any header and set any cookie, so
 * a zone off the wire may decide how a moment is printed and must never
 * decide which records are returned, whether something is expired, or what
 * a signature covers. Nothing in henri reads `req.timeZone` for any of
 * those, and an application should not start.
 *
 * ## What this does not do
 *
 * It stores nothing and it changes no stored value. A zone is a
 * presentation concern: `createdAt` and `updatedAt` stay instants, the job
 * queue's BIGINT milliseconds stay milliseconds, the trail, the call log
 * and the version store keep their own, retention keeps comparing instants
 * to a cutoff, and nothing an `Idempotency-Key` or an ETag is computed from
 * has learned a zone. If a stored value ever moves because a person changed
 * their zone, this file is what went wrong.
 *
 * It also formats nothing that `Intl` formats. `format()` is one call to
 * `Intl.DateTimeFormat` with a `timeZone` filled in, and the options are
 * passed through unchanged. The zone is what henri knows and `Intl` cannot
 * guess; the formatting is `Intl`'s and stays there, which is the line
 * `base/i18n.js` already drew around numbers and dates.
 *
 * @module base/time
 */

/** The zone everything falls back to when the application names none */
const DEFAULT_ZONE = 'UTC';

/** What a resolved zone is remembered as, so a lookup is not a try/catch */
const RESOLVED = new Map();

/** How many zone names are remembered before the cache stops growing */
const MAX_RESOLVED = 600;

/**
 * The canonical name of a zone, or null when `Intl` will not take it.
 *
 * `Intl` is the authority and henri ships no list of its own: a zone
 * database that is a year old is worse than no list, and the runtime's is
 * the one that will format. It accepts more than the canonical names --
 * `us/eastern` and `america/new_york` both resolve -- and the canonical
 * form is what comes back, so an application that stored `US/Eastern` gets
 * `America/New_York` and everything downstream compares equal.
 *
 * @param {*} value the zone
 * @returns {?string} the canonical name, or null
 */
const canonical = (value) => {
  if (typeof value !== 'string' || !value) {
    return null;
  }

  if (RESOLVED.has(value)) {
    return RESOLVED.get(value);
  }

  let resolved;

  try {
    resolved = new Intl.DateTimeFormat('en', {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    // A zone Intl refuses is not a zone henri can render in. Null is the
    // answer, and what the caller does about it is the caller's: the
    // configuration fails the boot, a request falls back
    resolved = null;
  }

  RESOLVED.size < MAX_RESOLVED && RESOLVED.set(value, resolved);

  return resolved;
};

/**
 * Is this a zone this runtime can format in?
 *
 * @param {*} value the zone
 * @returns {boolean} yes or no
 */
const isZone = (value) => canonical(value) !== null;

/**
 * One `from` step: a name to read, or false for a step that is off
 *
 * @param {*} value what the configuration said
 * @returns {(string|false)} the name, or false
 */
const step = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : false;

/**
 * `config.timeZone`, normalized.
 *
 * A string is the shorthand for `{ default: <string> }`, the way
 * `config.user` takes a model name or an object. Absent means `UTC`, which
 * is a zone rather than a silence: something has to render, and a value
 * nobody set should not come from the deployment.
 *
 * @param {*} config the henri configuration (or a plain object)
 * @returns {object} the settings
 * @throws when the zone named is not one `Intl` knows
 */
const timeConfig = (config) => {
  const reader = config && typeof config.get === 'function';
  let raw;

  if (reader) {
    raw = config.has('timeZone') ? config.get('timeZone') : undefined;
  } else {
    raw = config ? config.timeZone : undefined;
  }

  const given =
    typeof raw === 'string'
      ? { default: raw }
      : (raw && typeof raw === 'object' && raw) || {};
  const from =
    (given.from && typeof given.from === 'object' && given.from) || {};
  const asked =
    typeof given.default === 'string' && given.default.trim()
      ? given.default.trim()
      : null;
  const zone = asked === null ? DEFAULT_ZONE : canonical(asked);

  if (zone === null) {
    // A zone the runtime cannot format in would answer every render with
    // the fallback and nobody would know: the boot is where that is said
    throw fail(
      'HENRI_TIME_ZONE_UNKNOWN',
      `timeZone is "${asked}" and this runtime has no such zone`
    );
  }

  const sources = {
    cookie: step(from.cookie),
    header: step(from.header),
    query: step(from.query),
    user: step(from.user),
  };

  return {
    // Whether the application said anything at all: what the boot line and
    // the view payload are gated on, never what `zone` answers
    configured: typeof raw !== 'undefined',
    default: zone,
    from: sources,
    // Whether a request or a person can be in a zone of their own, which is
    // what mounting the middleware costs an application that cannot
    personal: Object.values(sources).some((value) => value !== false),
  };
};

/**
 * The zones of an application: the one it renders in, the one a person is
 * in, and the one a request was answered in.
 *
 * @class Zones
 */
class Zones {
  /**
   * Creates an instance of Zones.
   *
   * @param {object} options `henri` and the normalized `settings`
   * @memberof Zones
   */
  constructor({ henri, settings }) {
    this.henri = henri;
    this.settings = settings;

    /**
     * What a render carries when no middleware ran: one frozen object,
     * built once, so an application with no per-person zone pays an
     * assignment of a shared value rather than an allocation per request
     */
    this.fallbackView = Object.freeze({
      source: 'default',
      zone: settings.default,
    });
  }

  /**
   * The zone this application renders in
   *
   * @returns {string} the zone
   * @memberof Zones
   */
  get zone() {
    return this.settings.default;
  }

  /**
   * Which zone a request is in, and which step decided it
   *
   * @param {object} req the request
   * @returns {{source: string, zone: string}} the decision
   * @memberof Zones
   */
  decide(req) {
    const { from } = this.settings;

    if (req && isZone(req._timeZone)) {
      return { source: 'explicit', zone: canonical(req._timeZone) };
    }

    if (from.user && req && req.user) {
      const said = canonical(req.user[from.user]);

      if (said) {
        return { source: 'user', zone: said };
      }
    }

    if (from.query && req && req.query) {
      const said = canonical(req.query[from.query]);

      if (said) {
        return { source: 'query', zone: said };
      }
    }

    if (from.cookie && req && req.cookies) {
      const said = canonical(req.cookies[from.cookie]);

      if (said) {
        return { source: 'cookie', zone: said };
      }
    }

    if (from.header && req && typeof req.get === 'function') {
      const said = canonical(req.get(from.header));

      if (said) {
        return { source: 'header', zone: said };
      }
    }

    return { source: 'default', zone: this.settings.default };
  }

  /**
   * The zone a person's record says they read in.
   *
   * The one call that turns a recipient into a zone, and the reason a mail
   * sent from a job is in the right one: a job has no request, so it asks
   * the record. Answers null when the application named no column, when
   * the record holds nothing, or when what it holds is not a zone.
   *
   * @param {*} user the user record
   * @returns {?string} the zone, or null
   * @memberof Zones
   */
  forUser(user) {
    const column = this.settings.from.user;

    if (!column || !user || typeof user !== 'object') {
      return null;
    }

    return canonical(user[column]);
  }

  /**
   * One instant, written for a person to read.
   *
   * `Intl.DateTimeFormat` with the `timeZone` filled in and every other
   * option passed through unchanged. henri invents no option and no format
   * of its own: what it adds is the zone, which is the one thing `Intl`
   * cannot guess and the application knows.
   *
   * A zone it will not take falls back to the application's rather than
   * throwing, because this is called from inside a render and a page that
   * fails to answer over a mistyped zone is worse than one that says the
   * time in UTC. The two calls that *do* throw are the boot and
   * `req.setTimeZone()`, which are both a person's mistake at a moment
   * they can act on it.
   *
   * @param {*} value a Date, an ISO string or epoch milliseconds
   * @param {object} [options={}] `zone`, `locale`, and Intl's own options
   * @returns {string} the formatted moment, or '' when there is no moment
   * @memberof Zones
   */
  format(value, options = {}) {
    const { locale, zone, ...intl } = options || {};

    // `new Date(null)` is the epoch and `new Date('')` is invalid: a
    // nullable column holding nothing must not print 1970, which is what
    // the helper this replaced did
    if (value === null || typeof value === 'undefined' || value === '') {
      return '';
    }

    const when = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(when.getTime())) {
      return '';
    }

    const wanted = canonical(zone || intl.timeZone);

    return new Intl.DateTimeFormat(
      locale || undefined,
      Object.assign({}, intl, { timeZone: wanted || this.settings.default })
    ).format(when);
  }

  /**
   * What a rendered answer carries about the zone: the zone it was decided
   * to be, and which step decided
   *
   * @param {?object} decided `{ source, zone }`, or nothing
   * @returns {object} `{ source, zone }`
   * @memberof Zones
   */
  view(decided) {
    return decided && decided.zone
      ? { source: decided.source, zone: decided.zone }
      : this.fallbackView;
  }
}

/**
 * The middleware that decides the zone of a request.
 *
 * Mounted only when a `from` step is on, which is what keeps an
 * application whose pages are all in one zone from paying for one: there
 * is no middleware in its stack, not even one that returns.
 *
 * @param {object} henri the henri instance
 * @returns {function} the express middleware
 */
const middleware = (henri) => {
  const { time } = henri;

  return (req, res, next) => {
    const decided = time.decide(req);

    /**
     * Says what a shared cache has to key on.
     *
     * A zone read off a cookie, a header or the signed-in user makes two
     * people's answers differ, and a cache that was not told would hand
     * one visitor's clock to the next.
     *
     * @param {string} source which step decided
     * @returns {boolean} done
     */
    const vary = (source) => {
      if (res.headersSent) {
        return false;
      }

      (source === 'cookie' || source === 'user') && res.vary('Cookie');
      source === 'header' && res.vary(time.settings.from.header);

      return true;
    };

    req.timeZone = decided.zone;
    req.timeZoneSource = decided.source;

    /**
     * Says what zone this request is answered in, from here on
     *
     * @param {string} zone the zone
     * @returns {string} the zone, canonical
     */
    req.setTimeZone = (zone) => {
      const said = canonical(zone);

      if (!said) {
        throw fail(
          'HENRI_TIME_ZONE_UNKNOWN',
          `req.setTimeZone(${JSON.stringify(zone)}): this runtime has no such zone`
        );
      }

      req._timeZone = said;
      req.timeZone = said;
      req.timeZoneSource = 'explicit';
      vary('explicit');

      return said;
    };

    vary(decided.source);

    return next();
  };
};

module.exports = {
  DEFAULT_ZONE,
  Zones,
  canonical,
  isZone,
  middleware,
  timeConfig,
};
