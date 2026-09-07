const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const escapeHtml = require('escape-html');
const debug = require('debug')('henri:maintenance');

const { isLoopback } = require('../utils');
const { mint, verify } = require('./tokens');
const { seal } = require('./headers');
const { stamp } = require('./errors');

/**
 * Maintenance mode: how an application says "not right now".
 *
 * A migration that cannot run online, an incident, a data repair. All three
 * need the application closed for a while, and all three happen at a moment
 * when a deploy is the last thing anybody wants to attempt: the switch has
 * to be reachable from a shell, it has to reach every process, and it has
 * to be off again just as quickly.
 *
 * ## Where the switch lives
 *
 * Two places, and the boot line says which:
 *
 * - the **shared store** (`config.shared`, `base/shared.js`) when the
 *   application has one. It is already the answer to "state several
 *   processes must agree on", so a switch thrown once reaches every process
 *   on every machine.
 * - a **file** otherwise (`.henri/maintenance.json`), which reaches every
 *   process on *that* machine and nothing else. That is a real limit and
 *   the guide says so plainly: a deployment spread over several hosts
 *   either names a shared store or throws the switch on each host.
 *
 * `maintenance.switch` pins one of the two for an application that wants
 * the file even though it has Redis (a per-machine drain, say).
 *
 * ## How a running process notices
 *
 * Every process re-reads the switch at most once every `maintenance.poll`
 * milliseconds (one second), on the way into a request, and the reads are
 * deduplicated -- a burst of a thousand requests causes one read. So a
 * change is picked up by a running server within a second, without a
 * restart and without a deploy, which is the whole point of the feature.
 *
 * A read that fails does **not** close the application, and does not open
 * one either: the last known state stands and the failure is logged (at
 * most once every ten seconds). A Redis blip must not be able to take an
 * application down, and a switch that cannot be read is not a switch that
 * was thrown.
 *
 * ## What still answers
 *
 * `/livez` answers 200. Maintenance is deliberate: restarting the container
 * does not end it, it only loses the process that was doing the work. This
 * is the same answer the drain gives (`base/shutdown.js`), for the same
 * reason.
 *
 * `/readyz` also answers 200, with `maintenance: true` in the body, and
 * that is the decision worth writing down. Readiness means "send me
 * traffic", and during maintenance this process *wants* the traffic: it is
 * serving the 503 and the page on purpose. Answering 503 there instead
 * would take **every** backend out of the pool at the same instant, because
 * every process is in maintenance at once -- and then:
 *
 * - the visitor gets the load balancer's own error page rather than the
 *   message the operator wrote, which is the one thing maintenance mode
 *   exists to produce;
 * - the bypass stops working, because the operator's request is routed by
 *   the same load balancer that now has no backends;
 * - a rollout stalls, since new instances never turn ready -- and the
 *   rollout is often what ends the maintenance;
 * - a deployment that wired its liveness probe to `/healthz` (which answers
 *   readiness, see `base/health.js`) restarts the very processes doing the
 *   work.
 *
 * Draining is the opposite case and gets the opposite answer: it is about
 * *this* process going away while its peers stay up, so taking it out of
 * the pool is exactly right.
 *
 * `maintenance.readyz: "unavailable"` is there for the deployment that
 * genuinely wants to be pulled out of the pool -- an edge that serves its
 * own maintenance page, typically. It is a decision, not a default.
 *
 * ## How the operator gets through
 *
 * `henri maintenance:on` prints a url carrying a bypass token: an HMAC over
 * `config.secret` (`base/tokens.js`) seeded with the id of *this*
 * maintenance window, so it cannot be forged without the secret and it dies
 * the moment maintenance is turned off. Presenting it once sets an
 * `HttpOnly` cookie, so the rest of the visit goes through normally.
 *
 * It is deliberately not a header anybody can send and not a shared
 * password in a configuration file. `maintenance.bypass: "loopback"` adds
 * "and anything connecting from this machine", which is the operator with a
 * shell -- and which is wrong the moment a reverse proxy runs on that same
 * machine, since every request then arrives from the loopback. `henri
 * audit` reports exactly that combination.
 */

/** What an application gets without saying anything */
const DEFAULTS = Object.freeze({
  bypass: 'token',
  file: '.henri/maintenance.json',
  message: 'The application is closed for maintenance. Please try again soon.',
  page: 'app/views/maintenance.html',
  poll: 1000,
  readyz: 'ready',
  retryAfter: 300,
  switch: 'auto',
});

/** What `maintenance.bypass` accepts */
const BYPASSES = Object.freeze(['token', 'loopback']);

/** What `maintenance.readyz` accepts */
const READYZ = Object.freeze(['ready', 'unavailable']);

/** What `maintenance.switch` accepts */
const SWITCHES = Object.freeze(['auto', 'file', 'shared']);

/** The name of the cookie a presented token sets */
const COOKIE = 'henri.maintenance';

/** The query parameter a bypass token is presented in */
const PARAMETER = 'maintenance';

/** What the bypass token is signed for (`base/tokens.js`) */
const PURPOSE = 'maintenance';

/** The key the record is written under, in either backend */
const KEY = 'state';

/** How often one failure to read the switch may be reported (ms) */
const REPORT_EVERY = 10000;

/**
 * The longest a window lives in the shared store (ms).
 *
 * A key in Redis needs an expiry -- the backend takes one -- and a
 * maintenance nobody remembers to end is a worse outcome than one that
 * reopens by itself after a month. The file switch needs no equivalent: it
 * is a file in the application directory, where it is visible.
 */
const MAX_WINDOW = 30 * 24 * 60 * 60 * 1000;

/** How long a bypass token minted for an operator is good for (ms) */
const TOKEN_LIFETIME = 12 * 60 * 60 * 1000;

/**
 * Escape a value for html
 *
 * @param {*} value the value
 * @returns {string} the escaped string
 */
const escape = (value) => escapeHtml(String(value));

/**
 * A number that is zero or more, or the fallback
 *
 * @param {*} value the value
 * @param {number} fallback the fallback
 * @returns {number} a number, zero or more
 */
const positive = (value, fallback) => {
  if (value === null || typeof value === 'undefined' || value === '') {
    return fallback;
  }

  const asked = Number(value);

  return Number.isFinite(asked) && asked >= 0 ? asked : fallback;
};

/**
 * Whether a record read back means the application is closed
 *
 * @param {*} record what a backend answered
 * @returns {boolean} true when it is a live maintenance record
 */
const isOn = (record) =>
  Boolean(record) && typeof record === 'object' && record.on === true;

/**
 * Normalizes `config.maintenance`
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @returns {?object} the settings, null when maintenance is turned off
 * @throws {TypeError} when the block is not an object or holds a bad value
 */
function settings(config) {
  const has =
    Boolean(config) &&
    typeof config.has === 'function' &&
    config.has('maintenance');
  const raw = has ? config.get('maintenance') : null;

  if (raw === false) {
    return null;
  }

  const empty = raw === null || typeof raw === 'undefined';

  if (!empty && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new TypeError(
      'config.maintenance must be an object, or false to have no switch at all'
    );
  }

  const asked = empty ? {} : raw;

  for (const [key, allowed] of [
    ['bypass', BYPASSES],
    ['readyz', READYZ],
    ['switch', SWITCHES],
  ]) {
    if (
      typeof asked[key] !== 'undefined' &&
      !allowed.includes(String(asked[key]))
    ) {
      throw new TypeError(
        `config.maintenance.${key} must be one of ${allowed.join(', ')}`
      );
    }
  }

  return {
    bypass: String(asked.bypass || DEFAULTS.bypass),
    file: typeof asked.file === 'string' ? asked.file : DEFAULTS.file,
    message:
      typeof asked.message === 'string' && asked.message.trim() !== ''
        ? asked.message.trim()
        : DEFAULTS.message,
    page: typeof asked.page === 'string' ? asked.page : DEFAULTS.page,
    poll: positive(asked.poll, DEFAULTS.poll),
    readyz: String(asked.readyz || DEFAULTS.readyz),
    retryAfter: Math.max(
      1,
      Math.round(positive(asked.retryAfter, DEFAULTS.retryAfter))
    ),
    switch: String(asked.switch || DEFAULTS.switch),
  };
}

/**
 * The switch as a file in the application directory.
 *
 * It is written whole and moved into place, so a process reading it while
 * the command line writes it never sees half a record.
 *
 * @class FileSwitch
 */
class FileSwitch {
  /**
   * Creates an instance of FileSwitch.
   *
   * @param {string} file the absolute path of the record
   * @memberof FileSwitch
   */
  constructor(file) {
    this.file = file;
    this.where = 'file';
  }

  /**
   * Where the switch is, for the boot line
   *
   * @param {?string} [cwd=null] the application directory, to shorten it
   * @returns {string} a one-line description
   * @memberof FileSwitch
   */
  describe(cwd = null) {
    return cwd ? path.relative(cwd, this.file) : this.file;
  }

  /**
   * Reads the record
   *
   * @returns {Promise<?object>} the record, null when there is none
   * @throws when the file exists and cannot be read or parsed
   * @memberof FileSwitch
   */
  async read() {
    let content;

    try {
      content = await fs.promises.readFile(this.file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }

    const parsed = JSON.parse(content);

    return isOn(parsed) ? parsed : null;
  }

  /**
   * Writes the record, whole
   *
   * @param {object} record the record
   * @returns {Promise<object>} the record
   * @throws when the directory or the file cannot be written
   * @memberof FileSwitch
   */
  async write(record) {
    const temporary = `${this.file}.${process.pid}.tmp`;

    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    await fs.promises.writeFile(
      temporary,
      `${JSON.stringify(record, null, 2)}\n`,
      { mode: 0o600 }
    );
    await fs.promises.rename(temporary, this.file);

    return record;
  }

  /**
   * Removes the record
   *
   * @returns {Promise<boolean>} whether there was one
   * @throws when the file exists and cannot be removed
   * @memberof FileSwitch
   */
  async clear() {
    try {
      await fs.promises.unlink(this.file);

      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false;
      }

      throw error;
    }
  }
}

/**
 * The switch in the shared store (`config.shared`).
 *
 * It takes the store through `SharedStore#unguarded`, like the cache: the
 * failure policy of the guards does not apply here, because a backend that
 * does not answer must not be able to close an application by itself.
 *
 * @class SharedSwitch
 */
class SharedSwitch {
  /**
   * Creates an instance of SharedSwitch.
   *
   * @param {object} store what `shared.unguarded('maintenance')` answered
   * @param {string} name the adapter name, for the boot line
   * @memberof SharedSwitch
   */
  constructor(store, name) {
    this.store = store;
    this.name = name;
    this.where = 'shared';
  }

  /**
   * Where the switch is, for the boot line
   *
   * @returns {string} a one-line description
   * @memberof SharedSwitch
   */
  describe() {
    return this.name;
  }

  /**
   * Reads the record
   *
   * @returns {Promise<?object>} the record, null when there is none
   * @throws whatever the backend threw
   * @memberof SharedSwitch
   */
  async read() {
    const record = await this.store.get(KEY);

    return isOn(record) ? record : null;
  }

  /**
   * Writes the record
   *
   * @param {object} record the record
   * @returns {Promise<object>} the record
   * @throws whatever the backend threw
   * @memberof SharedSwitch
   */
  async write(record) {
    await this.store.set(KEY, record, MAX_WINDOW);

    return record;
  }

  /**
   * Removes the record
   *
   * @returns {Promise<boolean>} whether there was one
   * @throws whatever the backend threw
   * @memberof SharedSwitch
   */
  async clear() {
    const had = await this.read();

    await this.store.delete(KEY);

    return Boolean(had);
  }
}

/**
 * The maintenance switch of an application.
 *
 * One of these is built by the server module and exposed as
 * `henri.maintenance`, whether or not maintenance is currently on: the
 * switch has to be readable at any moment by every process, which is the
 * difference between this and a deploy.
 *
 * @class Maintenance
 */
class Maintenance {
  /**
   * Creates an instance of Maintenance.
   *
   * @param {Henri} henri the henri instance
   * @param {?object} options the normalized settings, null when turned off
   * @param {?object} backend the switch backend, null when turned off
   * @memberof Maintenance
   */
  constructor(henri, options, backend) {
    this.henri = henri;
    this.settings = options;
    this.backend = backend;
    this.enabled = Boolean(options && backend);
    this.record = null;
    this.readAt = 0;
    this.reading = null;
    this.reportedAt = 0;
  }

  /**
   * Where the switch lives, for the boot line and `henri maintenance`
   *
   * @returns {string} `file` or `shared`, `none` when turned off
   * @memberof Maintenance
   */
  get where() {
    return this.backend ? this.backend.where : 'none';
  }

  /**
   * Whether the application is closed right now, without reading the switch
   *
   * @returns {boolean} true when it is
   * @memberof Maintenance
   */
  get closed() {
    return this.record !== null;
  }

  /**
   * What the switch is, in words
   *
   * @returns {string} a one-line description
   * @memberof Maintenance
   */
  describe() {
    if (!this.backend) {
      return 'no switch (config.maintenance is false)';
    }

    return this.backend.describe(this.henri && this.henri.cwd());
  }

  /**
   * Reads the switch once, at boot, and says where it is.
   *
   * A switch that cannot be read here is reported and the application
   * starts open, for the same reason a failed read later leaves the last
   * state standing.
   *
   * @returns {Promise<?object>} the record, null when the application is open
   * @memberof Maintenance
   */
  async start() {
    if (!this.enabled) {
      return null;
    }

    await this.refresh(true);

    const { pen } = this.henri;
    const every = `checked every ${this.settings.poll}ms`;

    if (this.record) {
      pen.warn(
        'maintenance',
        this.describe(),
        `ON since ${new Date(this.record.since).toISOString()}`,
        `${every}, henri maintenance:off ends it`
      );
    } else {
      pen.info('maintenance', this.describe(), `off, ${every}`);
    }

    return this.record;
  }

  /**
   * Lets go of whatever read is in flight
   *
   * @returns {Promise<boolean>} done
   * @memberof Maintenance
   */
  async stop() {
    this.reading = null;

    return true;
  }

  /**
   * Reports a switch that could not be read, at most once every ten
   * seconds: an outage that lasts an hour must not become the log
   *
   * @param {Error} error what the backend threw
   * @returns {boolean} whether it was logged this time
   * @memberof Maintenance
   */
  report(error) {
    const now = Date.now();

    debug('unable to read the switch: %s', error.message);

    if (now - this.reportedAt < REPORT_EVERY) {
      return false;
    }

    this.reportedAt = now;
    this.henri.pen.error(
      'maintenance',
      this.describe(),
      `unreadable, leaving the application ${
        this.record ? 'closed' : 'open'
      }: ${error.message}`
    );

    return true;
  }

  /**
   * Re-reads the switch, at most one read at a time.
   *
   * Every caller waiting on a read in flight gets that read's answer, so a
   * burst of requests costs one round trip and not one each.
   *
   * @param {boolean} [force=false] read even when the last one is fresh
   * @returns {Promise<?object>} the record, null when the application is open
   * @memberof Maintenance
   */
  async refresh(force = false) {
    if (!this.enabled) {
      return null;
    }

    if (!force && Date.now() - this.readAt < this.settings.poll) {
      return this.record;
    }

    if (!this.reading) {
      this.reading = Promise.resolve()
        .then(() => this.backend.read())
        .then(
          (record) => {
            this.record = record;
            this.readAt = Date.now();
            this.reading = null;

            return record;
          },
          (error) => {
            // The last known state stands: a backend that cannot answer has
            // no business closing an application, or reopening one
            this.readAt = Date.now();
            this.reading = null;
            this.report(error);

            return this.record;
          }
        );
    }

    return this.reading;
  }

  /**
   * What the switch said the last time it was read
   *
   * @returns {?object} the record, null when the application is open
   * @memberof Maintenance
   */
  current() {
    return this.record;
  }

  /**
   * Closes the application
   *
   * @param {object} [options={}] options
   * @param {?string} [options.by] who threw the switch, for the record
   * @param {?string} [options.message] what the visitor is told
   * @param {?number} [options.retryAfter] the `Retry-After`, in seconds
   * @returns {Promise<object>} the record, with the bypass token
   * @throws {Error} HENRI_MAINTENANCE_UNAVAILABLE when it cannot be written
   * @memberof Maintenance
   */
  async on({ by = null, message = null, retryAfter = null } = {}) {
    this.assertEnabled();

    const record = {
      by,
      id: crypto.randomBytes(16).toString('hex'),
      message:
        typeof message === 'string' && message.trim() !== ''
          ? message.trim()
          : this.settings.message,
      on: true,
      retryAfter: Math.max(
        1,
        Math.round(positive(retryAfter, this.settings.retryAfter))
      ),
      since: Date.now(),
    };

    try {
      await this.backend.write(record);
    } catch (error) {
      throw stamp(
        new Error(
          `unable to close the application: the switch (${this.describe()}) could not be written: ${error.message}`,
          { cause: error }
        ),
        'HENRI_MAINTENANCE_UNAVAILABLE'
      );
    }

    this.record = record;
    this.readAt = Date.now();

    return Object.assign({}, record, { token: this.token(record) });
  }

  /**
   * Opens the application again
   *
   * @returns {Promise<boolean>} whether it was closed
   * @throws {Error} HENRI_MAINTENANCE_UNAVAILABLE when it cannot be cleared
   * @memberof Maintenance
   */
  async off() {
    this.assertEnabled();

    let had;

    try {
      had = await this.backend.clear();
    } catch (error) {
      throw stamp(
        new Error(
          `unable to open the application: the switch (${this.describe()}) could not be cleared: ${error.message}`,
          { cause: error }
        ),
        'HENRI_MAINTENANCE_UNAVAILABLE'
      );
    }

    this.record = null;
    this.readAt = Date.now();

    return had;
  }

  /**
   * What the switch says, read fresh: `henri maintenance:status`
   *
   * @returns {Promise<object>} the state, with a bypass token when closed
   * @throws {Error} HENRI_MAINTENANCE_UNAVAILABLE when it cannot be read
   * @memberof Maintenance
   */
  async status() {
    if (!this.enabled) {
      return {
        bypass: DEFAULTS.bypass,
        enabled: false,
        on: false,
        poll: 0,
        switch: this.describe(),
        where: this.where,
      };
    }

    let record;

    try {
      record = await this.backend.read();
    } catch (error) {
      throw stamp(
        new Error(
          `unable to read the switch (${this.describe()}): ${error.message}`,
          { cause: error }
        ),
        'HENRI_MAINTENANCE_UNAVAILABLE'
      );
    }

    this.record = record;
    this.readAt = Date.now();

    const state = {
      bypass: this.settings.bypass,
      enabled: true,
      on: record !== null,
      poll: this.settings.poll,
      switch: this.describe(),
      where: this.where,
    };

    if (!record) {
      return state;
    }

    return Object.assign(state, {
      by: record.by || null,
      id: record.id,
      message: record.message,
      retryAfter: record.retryAfter,
      since: record.since,
      token: this.token(record),
    });
  }

  /**
   * Refuses when the application has no switch at all
   *
   * @returns {boolean} true
   * @throws {Error} HENRI_MAINTENANCE_DISABLED
   * @memberof Maintenance
   */
  assertEnabled() {
    if (!this.enabled) {
      throw stamp(
        new Error(
          'this application has no maintenance switch: config.maintenance is false'
        ),
        'HENRI_MAINTENANCE_DISABLED'
      );
    }

    return true;
  }

  /**
   * The bypass token of a window.
   *
   * The id of the window is the seed, so ending the maintenance is what
   * invalidates every token minted for it -- the property `base/tokens.js`
   * gives a password reset link, for the same reason.
   *
   * @param {object} record the record
   * @returns {?string} the token, null without a secret to sign it with
   * @memberof Maintenance
   */
  token(record) {
    const secret = this.henri.config.get('secret', true);

    if (typeof secret !== 'string' || secret === '') {
      return null;
    }

    return mint({
      expiresIn: TOKEN_LIFETIME,
      purpose: PURPOSE,
      secret,
      seed: record.id,
      subject: record.id,
    });
  }

  /**
   * Whether a request gets through a closed application
   *
   * @param {object} req the request
   * @param {object} record the record of the window
   * @returns {?string} how it got through, null when it does not
   * @memberof Maintenance
   */
  bypasses(req, record) {
    if (
      this.settings.bypass === 'loopback' &&
      isLoopback(req.socket && req.socket.remoteAddress)
    ) {
      return 'loopback';
    }

    const secret = this.henri.config.get('secret', true);

    if (typeof secret !== 'string' || secret === '') {
      return null;
    }

    const presented = [
      req.query && req.query[PARAMETER],
      req.cookies && req.cookies[COOKIE],
    ].filter((value) => typeof value === 'string' && value !== '');

    for (const token of presented) {
      const { ok } = verify({
        purpose: PURPOSE,
        secret,
        seed: record.id,
        token,
      });

      if (ok) {
        return 'token';
      }
    }

    return null;
  }

  /**
   * The page a browser is shown.
   *
   * An application supplies its own by putting an html file where
   * `maintenance.page` points (`app/views/maintenance.html`). It is read as
   * it is -- the view engine is not involved and may not even be loaded --
   * with `{{message}}`, `{{retryAfter}}` and `{{since}}` replaced by the
   * escaped values of the window.
   *
   * @param {object} record the record
   * @returns {string} the html
   * @memberof Maintenance
   */
  page(record) {
    const values = {
      message: record.message,
      retryAfter: record.retryAfter,
      since: new Date(record.since).toISOString(),
    };
    const file = path.resolve(this.henri.cwd(), this.settings.page);

    try {
      if (fs.existsSync(file)) {
        return fs
          .readFileSync(file, 'utf8')
          .replace(/\{\{\s*(message|retryAfter|since)\s*\}\}/gu, (all, key) =>
            escape(values[key])
          );
      }
    } catch (error) {
      debug('unable to read %s: %s', file, error.message);
    }

    return builtinPage(values);
  }

  /**
   * Answers a request that did not get through: the page for a browser, the
   * envelope henri writes everywhere else (`base/http.js`)
   *
   * @param {object} res the response
   * @param {object} record the record
   * @returns {*} whatever express answered
   * @memberof Maintenance
   */
  answer(res, record) {
    const since = new Date(record.since).toISOString();
    const body = {
      code: 'HENRI_MAINTENANCE_ON',
      data: { retryAfter: record.retryAfter, since },
      error: 'Service Unavailable',
      message: record.message,
      statusCode: 503,
    };

    // Never cached: a proxy that kept a 503 would go on refusing traffic
    // after the window ended, which is an outage the operator did not ask
    // for and cannot see from a shell
    res.set('Cache-Control', 'no-store');
    res.set('Retry-After', String(record.retryAfter));
    res.status(503);

    return res.format({
      html: () => res.type('html').send(this.page(record)),
      // The envelope henri writes itself, like base/boom.js
      json: () => seal(res).json(body),
      // Escaped as well: static analyzers treat every send() as an html sink
      // eslint-disable-next-line sort-keys
      default: () =>
        res
          .type('txt')
          .send(
            escape(
              `503 Service Unavailable\nHENRI_MAINTENANCE_ON\n${record.message}\n`
            )
          ),
    });
  }

  /**
   * The middleware: the one thing maintenance puts on the request path.
   *
   * It is mounted after the health endpoints and before everything an
   * application does, so a closed application opens no session, counts no
   * rate limit and touches no store to answer.
   *
   * @returns {function} express middleware
   * @memberof Maintenance
   */
  middleware() {
    return async (req, res, next) => {
      if (!this.enabled) {
        return next();
      }

      let record = this.record;

      if (Date.now() - this.readAt >= this.settings.poll) {
        record = await this.refresh();
      }

      if (!record) {
        return next();
      }

      const through = this.bypasses(req, record);

      if (through === null) {
        return this.answer(res, record);
      }

      // Presenting the token once is enough: the rest of the visit carries
      // the cookie, which stops working when the window ends
      if (through === 'token' && req.query && req.query[PARAMETER]) {
        res.cookie(COOKIE, req.query[PARAMETER], {
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: this.henri.isProduction,
        });
      }

      res.set('X-Henri-Maintenance', 'bypass');

      return next();
    };
  }
}

/**
 * The page henri shows when the application supplies none
 *
 * @param {object} values `{ message, retryAfter, since }`
 * @returns {string} the html
 */
function builtinPage({ message, retryAfter }) {
  const minutes = Math.max(1, Math.ceil(Number(retryAfter) / 60));

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>We will be right back</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fafafa;color:#222}
main{max-width:32rem;padding:2rem;text-align:center}
h1{font-size:1.5rem;margin:0 0 .75rem}
p{margin:0 0 .5rem;line-height:1.6;color:#555}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}p{color:#aaa}}
</style>
</head>
<body><main>
<h1>We will be right back</h1>
<p>${escape(message)}</p>
<p><small>Please try again in about ${escape(minutes)} minute(s).</small></p>
</main></body>
</html>
`;
}

/**
 * Builds the maintenance switch of an application.
 *
 * The shared store is preferred when there is one, because a switch that
 * only reaches one machine is a switch an operator has to remember to throw
 * again. `maintenance.switch` overrides that either way.
 *
 * @param {Henri} henri the henri instance
 * @returns {Maintenance} the switch, disabled when `maintenance` is false
 * @throws {TypeError} when `config.maintenance` holds a value henri refuses
 */
function createMaintenance(henri) {
  const options = settings(henri.config);

  if (!options) {
    return new Maintenance(henri, null, null);
  }

  const shared = henri.shared || null;
  let wanted = options.switch;

  if (wanted === 'auto') {
    wanted = shared ? 'shared' : 'file';
  }

  if (wanted === 'shared') {
    if (!shared) {
      throw new TypeError(
        'config.maintenance.switch is "shared" but config.shared names no backend'
      );
    }

    return new Maintenance(
      henri,
      options,
      new SharedSwitch(shared.unguarded('maintenance'), shared.name)
    );
  }

  return new Maintenance(
    henri,
    options,
    new FileSwitch(path.resolve(henri.cwd(), options.file))
  );
}

module.exports = {
  BYPASSES,
  COOKIE,
  DEFAULTS,
  FileSwitch,
  KEY,
  MAX_WINDOW,
  Maintenance,
  PARAMETER,
  PURPOSE,
  READYZ,
  REPORT_EVERY,
  SWITCHES,
  SharedSwitch,
  TOKEN_LIFETIME,
  builtinPage,
  createMaintenance,
  isOn,
  settings,
};
