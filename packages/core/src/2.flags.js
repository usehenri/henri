const BaseModule = require('./base/module');

const debug = require('debug')('henri:flags');

const { check } = require('./base/arguments');
const { fail } = require('./base/errors');
const { manyProcesses } = require('./base/shared');
const {
  DECLARATIONS,
  REPORT_EVERY,
  actorOf,
  createFlagStore,
  decide,
  flagsConfig,
  loadDeclarations,
  stateOf,
  unknownFlag,
} = require('./base/flags');

/**
 * The feature flags module: `henri.flags`.
 *
 * What a flag is, who it is on for, how a percentage is bucketed and why
 * the state lives where it lives are all in `base/flags.js`, and its
 * header is the document. This is the module around it: where it sits in
 * the boot, the snapshot every read answers from, the poll that keeps the
 * snapshot honest, and the four writes an operator has.
 *
 * It runs at runlevel 2, right after the server module, for two reasons.
 * `config.shared` becomes `henri.shared` there, which is one of the three
 * places the state can live. And it is as early as a module can be, which
 * is what lets `henri flags` boot to level 2 and **flip a kill switch
 * without touching the database** -- the database being unreachable is one
 * of the reasons somebody reaches for a kill switch, and a command that
 * needed the models to turn a feature off would be missing exactly when
 * it was wanted.
 *
 * Every read is answered from `this.snapshot`, a `Map` this process holds:
 * no round trip, no promise chain to a backend, no cache to stampede. The
 * poll is the only thing that talks to the store, and **a poll that fails
 * changes no answer** -- it keeps what it has, says so at most once a
 * minute, and leaves the flags where they were. Flags stop moving while a
 * backend is down; they never move back.
 *
 * @class Flags
 * @extends {BaseModule}
 */
class Flags extends BaseModule {
  /**
   * Creates an instance of Flags.
   * @memberof Flags
   */
  constructor() {
    super();

    this.name = 'flags';
    this.runlevel = 2;
    this.needs = ['config'];
    // `henri.shared` is built by the server module, at the same runlevel
    this.after = ['server'];
    // A route may be declared behind a flag, and every request reads them
    this.before = ['router'];
    this.reloadable = true;
    this.henri = null;

    /** The flags of `config/flags.js`, by name */
    this.declared = new Map();
    /** What the store held, the last time it answered */
    this.snapshot = new Map();
    /** `config.flags`, normalized */
    this.settings = null;
    /** Where the state lives */
    this.store = null;
    /** The poll */
    this.timer = null;
    /** When the store was last unreadable, so an outage is not the log */
    this.reported = 0;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.stop = this.stop.bind(this);
    this.enabled = this.enabled.bind(this);
    this.exposed = this.exposed.bind(this);
    this.list = this.list.bind(this);
    this.enable = this.enable.bind(this);
    this.disable = this.disable.bind(this);
    this.percentage = this.percentage.bind(this);
    this.reset = this.reset.bind(this);
    this.refresh = this.refresh.bind(this);
  }

  /**
   * Module initialization
   *
   * @async
   * @returns {!string} The name of the module
   * @throws when config/flags.js does not hold flags, or the store is unusable
   * @memberof Flags
   */
  async init() {
    const { pen } = this.henri;

    this.settings = flagsConfig(this.henri.config, {
      isTest: this.henri.isTest,
      shared: Boolean(this.henri.shared),
    });
    this.declared = loadDeclarations(this.henri.cwd());

    if (this.declared.size === 0) {
      // Nothing to say and nothing to read: an application with no flags
      // pays for none of this, and never learns the module is there
      debug('no flags declared');

      return this.name;
    }

    if (!this.settings.enabled) {
      pen.info(
        'flags',
        'disabled',
        `${this.declared.size} declared, every one answering its default`
      );

      return this.name;
    }

    this.store = createFlagStore(this.henri, this.settings);

    // Once, before anything can ask: a request that arrives in the first
    // second must not read a flag henri has not looked up yet
    await this.load();
    this.watch();

    pen.info(
      'flags',
      this.store.name,
      `${this.declared.size} declared, ${this.store.describe()}`
    );
    this.warnUnshared();
    debug('%s: %o', this.store.name, this.settings);

    return this.name;
  }

  /**
   * Warns when a flag flipped from a shell cannot reach what is running.
   *
   * Only for the memory store, and only in production. A file is one
   * machine, which is a limit worth printing on the boot line and not
   * worth a warning on every single-server deployment; this process's
   * memory is a limit that makes `henri flags:on` a command that reports
   * success and does nothing.
   *
   * @returns {boolean} whether it warned
   * @memberof Flags
   */
  warnUnshared() {
    const { pen } = this.henri;

    if (this.store.name !== 'memory' || this.henri.isDev || this.henri.isTest) {
      return false;
    }

    const evidence = manyProcesses();

    pen.warn(
      'flags',
      `the state is in this process's memory${evidence ? `, and ${evidence}` : ''}`,
      'henri flags:on cannot reach a process that is already running: point config.flags.store at a file, or name a backend in config.shared'
    );

    return true;
  }

  /**
   * Reads the whole state from the store into the snapshot.
   *
   * The one place that talks to the store, and the one place that decides
   * what a store that will not answer means: nothing. The snapshot stays
   * exactly as it was.
   *
   * @async
   * @returns {Promise<boolean>} whether the store answered
   * @memberof Flags
   */
  async load() {
    if (!this.store) {
      return false;
    }

    const names = [...this.declared.keys()];

    try {
      this.snapshot = await this.store.read(names);

      return true;
    } catch (error) {
      this.report(error);

      return false;
    }
  }

  /**
   * Says the store could not be read, at most once a minute
   *
   * @param {Error} error what the store threw
   * @returns {boolean} whether it was said this time
   * @memberof Flags
   */
  report(error) {
    const now = Date.now();

    debug('unreadable: %s', error.message);

    if (now - this.reported < REPORT_EVERY) {
      return false;
    }

    this.reported = now;
    this.henri.pen.error(
      'flags',
      this.store.name,
      `unreadable, keeping the flags where they are: ${error.message}`
    );

    return true;
  }

  /**
   * Starts the poll, unless there is nothing to poll.
   *
   * The memory store is this process, so it is never behind and there is
   * nothing to ask. The timer is unreferenced: a poll must not be the
   * reason a process refuses to exit.
   *
   * @returns {boolean} whether a poll was started
   * @memberof Flags
   */
  watch() {
    if (this.store.name === 'memory') {
      return false;
    }

    this.timer = setInterval(() => this.load(), this.settings.refresh);
    this.timer.unref();

    return true;
  }

  /**
   * The flag of a name, or a failure naming the closest declared one
   *
   * @param {string} name the flag name
   * @param {string} asked what to say was asking
   * @returns {object} the declaration
   * @throws {Error} HENRI_FLAGS_UNKNOWN when nothing declares it
   * @memberof Flags
   */
  declaration(name, asked) {
    const found = this.declared.get(name);

    if (!found) {
      throw unknownFlag(name, [...this.declared.keys()], asked);
    }

    return found;
  }

  /**
   * What the store holds for a flag, or the empty state
   *
   * @param {string} name the flag name
   * @returns {object} the state
   * @memberof Flags
   */
  state(name) {
    return stateOf(this.snapshot.get(name));
  }

  /**
   * Is this flag on for this actor?
   *
   * The one way to ask, wherever the answer is needed: a controller, a
   * `before` hook, a view's data, a job. `req.flag()` is the same question
   * with `req.user` already filled in.
   *
   * @param {string} name the flag name, as declared in config/flags.js
   * @param {*} [actor=null] a record carrying an externalId, or the id itself
   * @returns {Promise<boolean>} on or off
   * @throws {Error} when nothing declares that name, or the actor has no id
   * @memberof Flags
   */
  async enabled(name, actor = null) {
    check('henri.flags.enabled', [name, actor]);

    const declaration = this.declaration(name, 'henri.flags.enabled()');

    if (!this.settings.enabled) {
      return declaration.default;
    }

    return decide(declaration, this.state(name), actorOf(actor), actor);
  }

  /**
   * The flags a page is allowed to know about, resolved for this actor.
   *
   * Only the ones whose declaration says `expose: true`, which is the
   * whole point of that key: the names of the features an application has
   * not shipped yet are not something every response should carry to every
   * browser. `5.router.js` puts this in the view options as `flags`.
   *
   * @param {*} [actor=null] a record carrying an externalId, or the id itself
   * @returns {Promise<object>} `{ [name]: boolean }`, empty when none is exposed
   * @memberof Flags
   */
  async exposed(actor = null) {
    check('henri.flags.exposed', [actor]);

    const answer = {};

    for (const [name, declaration] of this.declared) {
      if (declaration.expose) {
        answer[name] = await this.enabled(name, actor);
      }
    }

    return answer;
  }

  /**
   * Every flag, what it is and what has been done to it: the table
   * `henri flags` prints.
   *
   * The group is reported as a boolean rather than as itself -- it is a
   * function, and a listing is data.
   *
   * @returns {Promise<Array<object>>} one entry per declared flag
   * @memberof Flags
   */
  async list() {
    return [...this.declared.values()].map((declaration) => {
      const state = this.state(declaration.name);

      return {
        actors: state.actors,
        at: state.at,
        boolean: state.boolean,
        default: declaration.default,
        description: declaration.description,
        // What a flag answers for somebody henri knows nothing about, which
        // is the only summary that is true of every reader at once
        everyone: decide(declaration, state, null, null),
        expose: declaration.expose,
        group: Boolean(declaration.group),
        name: declaration.name,
        percentage: state.percentage,
      };
    });
  }

  /**
   * Writes a flag's state, and makes this process see it at once
   *
   * @param {string} name the flag name
   * @param {?object} state the state, or null to forget it
   * @returns {Promise<boolean>} done
   * @memberof Flags
   */
  async put(name, state) {
    if (!this.store) {
      throw fail(
        'HENRI_FLAGS_STORE_UNUSABLE',
        `config.flags.enabled is false, so there is nowhere to write "${name}": every flag answers its declared default until that block says otherwise`
      );
    }

    await this.store.write(name, state);

    // The writer does not wait for its own poll: a script that flips a flag
    // and then reads it back has to see what it just wrote
    state === null
      ? this.snapshot.delete(name)
      : this.snapshot.set(name, state);

    return true;
  }

  /**
   * Turns a flag on: for everybody, or for one actor.
   *
   * `enable(name)` is the switch; `enable(name, user)` adds that person to
   * the set the flag is on for and leaves everybody else alone.
   *
   * @param {string} name the flag name
   * @param {*} [actor=null] a record carrying an externalId, or the id itself
   * @returns {Promise<boolean>} done
   * @throws {Error} when nothing declares that name
   * @memberof Flags
   */
  async enable(name, actor = null) {
    check('henri.flags.enable', [name, actor]);
    this.declaration(name, 'henri.flags.enable()');
    // A write merges onto what is there, so it reads first rather than
    // trusting a snapshot that is up to `refresh` old: two operators adding
    // an actor a second apart both land. Racing on the same flag inside one
    // round trip is still last writer wins, which is what a switch does
    await this.load();

    const state = this.state(name);
    const who = actorOf(actor);

    if (who === null) {
      return this.put(
        name,
        Object.assign({}, state, { at: Date.now(), boolean: true })
      );
    }

    return this.put(
      name,
      Object.assign({}, state, {
        actors: [...new Set([...state.actors, who])].sort(),
        at: Date.now(),
      })
    );
  }

  /**
   * Turns a flag off: for everybody, or for one actor.
   *
   * `disable(name)` is the kill switch, and it is a **reset** -- the actor
   * set and the percentage go with it, so "off" means off rather than "off
   * except for whoever was added in March". `disable(name, user)` takes
   * that one person out of the set and touches nothing else.
   *
   * @param {string} name the flag name
   * @param {*} [actor=null] a record carrying an externalId, or the id itself
   * @returns {Promise<boolean>} done
   * @throws {Error} when nothing declares that name
   * @memberof Flags
   */
  async disable(name, actor = null) {
    check('henri.flags.disable', [name, actor]);
    this.declaration(name, 'henri.flags.disable()');
    await this.load();

    const state = this.state(name);
    const who = actorOf(actor);

    if (who === null) {
      return this.put(name, {
        actors: [],
        at: Date.now(),
        boolean: false,
        percentage: 0,
      });
    }

    return this.put(
      name,
      Object.assign({}, state, {
        actors: state.actors.filter((one) => one !== who),
        at: Date.now(),
      })
    );
  }

  /**
   * Turns a flag on for a stable share of the actors.
   *
   * The same person keeps the same answer as the number goes up, so a
   * rollout only ever adds people (see the bucket in `base/flags.js`).
   * Zero clears the gate rather than turning anything off.
   *
   * @param {string} name the flag name
   * @param {number} percent 0 to 100
   * @returns {Promise<boolean>} done
   * @throws {Error} when nothing declares that name
   * @memberof Flags
   */
  async percentage(name, percent) {
    check('henri.flags.percentage', [name, percent]);
    this.declaration(name, 'henri.flags.percentage()');
    await this.load();

    return this.put(
      name,
      Object.assign({}, this.state(name), {
        at: Date.now(),
        percentage: percent,
      })
    );
  }

  /**
   * Forgets everything that was done to a flag: it answers its declared
   * default again, and its group is asked again
   *
   * @param {string} name the flag name
   * @returns {Promise<boolean>} done
   * @throws {Error} when nothing declares that name
   * @memberof Flags
   */
  async reset(name) {
    check('henri.flags.reset', [name]);
    this.declaration(name, 'henri.flags.reset()');

    return this.put(name, null);
  }

  /**
   * Re-reads the store now instead of at the next poll.
   *
   * What a test calls after flipping a flag in another process, and what
   * `henri flags` calls before printing. A read never needs it: the
   * snapshot is at most `config.flags.refresh` old on its own.
   *
   * @returns {Promise<boolean>} whether the store answered
   * @memberof Flags
   */
  async refresh() {
    return this.load();
  }

  /**
   * Re-reads `config/flags.js` and the store.
   *
   * The declarations are the application's code and it has just changed;
   * the state is not, and is only re-read because it is free to.
   *
   * @async
   * @returns {Promise<string>} the name of the module
   * @memberof Flags
   */
  async reload() {
    this.declared = loadDeclarations(this.henri.cwd());

    if (this.store) {
      await this.load();
    }

    return this.name;
  }

  /**
   * Stops the poll and releases the store
   *
   * @async
   * @returns {Promise<boolean>} done
   * @memberof Flags
   */
  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.store) {
      await this.store.stop();
    }

    return true;
  }
}

module.exports = Flags;
module.exports.DECLARATIONS = DECLARATIONS;
