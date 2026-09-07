const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const debug = require('debug')('henri:flags');

const { duration } = require('./cache');
const { fail } = require('./errors');
const { hasExternalId } = require('./external-id');
const { nearest } = require('./config-validate');

/**
 * Feature flags: what a flag is, who it is on for, and where that is kept.
 *
 * Rails applications flip features constantly and `flipper` is what they
 * flip them with. It is worth reading before writing anything here, and
 * worth being explicit about what of it henri takes:
 *
 * - **kept**: a flag is on for everyone, off for everyone, on for a named
 *   set of people, on for a stable percentage of them, or on for a group
 *   the application describes in code. Those five answers are the feature;
 *   a boolean would not have been worth a module.
 *   The vocabulary is kept too (`enable`, `disable`), because an operator
 *   who has used flipper should not have to learn a second one.
 * - **kept**: the percentage is *of actors*, hashed per flag, so the same
 *   person gets the same answer forever and two flags at ten percent are
 *   not on for the same ten percent of people.
 * - **dropped**: `percentage_of_time`, which answers differently on two
 *   requests of the same page load. It is a sampling knob wearing a flag's
 *   clothes, and a feature that flickers within one session is a bug
 *   report henri would have caused.
 * - **dropped**: flipper's expression gates (`Flipper::Expression`), a
 *   small rule language stored as JSON. henri already has a place for a
 *   rule: it is a function, in `config/flags.js`, in the language the rest
 *   of the application is written in.
 * - **dropped**: creating a flag by flipping it. In flipper any name is a
 *   flag the moment you enable it, which is how an application ends up
 *   with four hundred of them and no list. Here a flag is **declared**
 *   (see below) and a name nothing declares is an error on both sides --
 *   the code that asks and the command line that flips.
 * - **dropped**: the web UI, the metrics and the event stream. A flag
 *   surface that also measures is an A/B testing product, and this is not
 *   one (`guides/feature-flags.md` says so out loud).
 *
 * ## Declared, in `config/flags.js`
 *
 * One file, next to `config/routes.js`, listing every flag the application
 * has:
 *
 * ```js
 * module.exports = {
 *   // the short form: the name, and what it answers until somebody flips it
 *   checkout: false,
 *
 *   newEditor: {
 *     default: false,
 *     description: 'The rewritten proposal editor',
 *     // reaches the page as `flags.newEditor`; without this it does not
 *     expose: true,
 *     // the group gate: henri asks it last, and only for a `true`
 *     group: (user) => Boolean(user) && user.roles.includes('staff'),
 *   },
 * };
 * ```
 *
 * **A name nothing declares is a failure, not a `false`.** It is the same
 * position `req.permit()`, the `params` block, the `answers` block and the
 * `filters` block take, and here it is the difference between two bugs: a
 * typo that answers `false` forever is a feature that never ships and
 * nobody can see why, and a typo that throws is a stack trace in
 * development, in the test suite, and on the first request that reaches
 * it. The loud one is cheaper. It cuts the other way for the command line
 * -- `henri flags:on serch` refuses rather than writing state nothing will
 * ever read -- and both messages name the closest declared flag.
 *
 * henri cannot check the names at boot, because they are in the code
 * rather than in a file it reads, so the check is at the call. The cost is
 * that removing a flag is two deploys (stop reading it, then undeclare
 * it), which is what removing a route costs too.
 *
 * ## Who a flag is on for
 *
 * The state henri keeps per flag is three things -- a boolean, a set of
 * actors and a percentage -- and the declaration adds a fourth, the group.
 * They are a union, asked in this order, and the first `true` wins:
 *
 * 1. `boolean === true`: on for everyone. Nothing below is asked.
 * 2. the actor is in the **set**: on for them.
 * 3. the actor's **bucket** is under the percentage: on for them.
 * 4. `boolean === false`: off. The group cannot reopen it -- this is the
 *    kill switch, and a kill switch a group can argue with is not one.
 * 5. the **group** says `true`.
 * 6. otherwise the **declared default**.
 *
 * `disable(name)` writes that `false` *and* clears the set and the
 * percentage, the way flipper's `disable` does: during an incident "turn
 * it off" has to mean off, not "off except for the forty people somebody
 * added in March". Adding an actor afterwards is a new decision and works,
 * because the reset already happened.
 *
 * ## The bucket, and why it is a hash
 *
 * A percentage rollout is only useful if it is **stable**: the same person
 * must get the same answer on every request, on every process, after every
 * restart, or the feature flickers. So the bucket is computed, never
 * stored: `sha256(flag + NUL + actor)`, the first four bytes as a fraction
 * of 2^32, on when it lands under the percentage.
 *
 * Two details are load-bearing.
 *
 * **The flag name is in the hash.** Without it every flag at ten percent
 * would be on for exactly the same ten percent of people: one cohort would
 * receive every experiment the application ever runs, which is both a bad
 * sample and a bad time for them.
 *
 * **The identifier is hashed whole, and it is the `externalId`.** That
 * identifier is a uuid v7 (`base/references.js`), and a uuid v7 is
 * *time-ordered*: its leading bits are the millisecond it was minted in.
 * Bucketing on any prefix of it -- the first hex characters, a cheap
 * checksum of the head, `parseInt(id, 16) % 100` -- would roll the feature
 * out **by signup date**: the first cohort would be everyone who arrived
 * in one window, which is the population least like the average user and
 * exactly the one already most tolerant of breakage. sha256 over the whole
 * id destroys that order, and `__tests__/flags.spec.js` proves it by
 * bucketing ten thousand ids minted in sequence and checking every tenth
 * of the sequence, not just the total.
 *
 * The primary key is never an actor. It does not leave the server
 * (`Model.findById()` will not even take one), and a flag store full of
 * them would be the one place it did.
 *
 * ## Where the state lives, and what a poll is for
 *
 * A flag has to mean the same thing in every process, which is what
 * `config.shared` is for (`base/shared.js`). With one, the state is there.
 * Without one it is a file (`.henri/flags.json`), which is one machine
 * rather than one process -- `henri flags:on` in a shell reaching the
 * server running next to it is the whole point of the command, and a
 * memory that only the writing process can see would make the command a
 * no-op that prints success. `memory` is the third answer, for a suite
 * (it is the default under `NODE_ENV=test`, because a test run boots many
 * applications at once and they must not share a switch).
 *
 * Whichever it is, **the boot line says so** and says its limit.
 *
 * Reading is not a round trip. Every process holds the whole state in
 * memory and re-reads it on a timer (`config.flags.refresh`, ten seconds),
 * so a flag read costs a `Map` lookup and a hash, and the staleness window
 * is that interval: a flip reaches every process within `refresh`, and the
 * process that flipped it sees it at once. `henri.cache` would have been
 * the other way to do it and is deliberately not used -- its answer to a
 * backend that is down is a miss, and a miss here would silently revert
 * every flag to its declared default in the middle of an incident.
 *
 * That is the rule this file is built around: **a store that cannot be
 * read does not flip anything.** A failed poll keeps the snapshot it has,
 * reports it at most once a minute, and changes no answer. The flags stop
 * *moving* while the backend is down; they do not move *back*.
 */

/** What `config.flags` looks like when the block leaves a key out */
const DEFAULTS = Object.freeze({
  enabled: true,
  refresh: 10000,
  store: null,
});

/**
 * The file the state goes in when nothing else is named.
 *
 * `.henri/` is where henri already keeps what it writes for an application
 * rather than what the application wrote (the scaffold's sqlite database,
 * the globals the linter reads), it is in the scaffold's `.gitignore`, and
 * `henri clean` empties it -- which is the right relationship: a flag is
 * runtime state of this deployment, not a file anybody edits or commits.
 */
const FILE = '.henri/flags.json';

/** What `config/flags.js` is called, from the application root */
const DECLARATIONS = 'config/flags.js';

/** The store names that are not a path */
const STORES = Object.freeze(['file', 'memory', 'shared']);

/** How often one store may report that it is unreadable (ms) */
const REPORT_EVERY = 60000;

/** The shortest poll worth having: below this it is a busy loop */
const MIN_REFRESH = 1000;

/**
 * A flag name: what a person types on a command line and reads in a diff.
 * Letters, digits and a single separator between them.
 */
const NAME = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/iu;

/** What the store holds for a flag nobody has flipped */
const EMPTY = Object.freeze({
  actors: Object.freeze([]),
  at: null,
  boolean: null,
  percentage: 0,
});

/**
 * The `.gitignore` the file store leaves behind the first time, for an
 * application older than the line the scaffold now writes
 */
const GITIGNORE =
  "# henri's own runtime state. Never committed.\n*\n!.gitignore\n";

/** What a file this store cannot read answers with */
const UNUSABLE = 'HENRI_FLAGS_STORE_UNUSABLE';

/** The mode of the state file: it says who sees which feature */
const FILE_MODE = 0o600;

/** The mode of the directory it sits in */
const DIR_MODE = 0o700;

/**
 * Normalizes `config.flags`
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @param {object} [options={}] options
 * @param {boolean} [options.isTest=false] whether this is a test run
 * @param {boolean} [options.shared=false] whether config.shared names a backend
 * @returns {{enabled: boolean, refresh: number, store: string}} the settings
 * @throws {TypeError} when the block is not an object, or names no store
 */
function flagsConfig(config, { isTest = false, shared = false } = {}) {
  const has =
    Boolean(config) && typeof config.has === 'function' && config.has('flags');
  const raw = has ? config.get('flags') : null;

  if (raw !== null && typeof raw !== 'undefined') {
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw fail(
        'HENRI_CONFIG_INVALID',
        'config.flags must be an object ({ enabled, refresh, store }): the flags themselves are declared in config/flags.js'
      );
    }
  }

  const block = raw && typeof raw === 'object' ? raw : {};
  const settings = Object.assign({}, DEFAULTS, {
    enabled: block.enabled !== false,
    // Written the way every other duration henri takes is ('10s', 250),
    // and floored: a poll under a second is a busy loop asking a question
    // whose answer changes when a person types
    refresh: Math.max(
      MIN_REFRESH,
      duration(block.refresh, DEFAULTS.refresh) || DEFAULTS.refresh
    ),
    // Named, or the best answer henri can give: the shared backend when
    // there is one, a file when there is not, and this process alone in a
    // suite, where every file boots an application of its own
    store:
      typeof block.store === 'string' && block.store.trim() !== ''
        ? block.store.trim()
        : (isTest && 'memory') || (shared && 'shared') || 'file',
  });

  if (settings.store === 'shared' && !shared) {
    throw fail(
      'HENRI_CONFIG_INVALID',
      'config.flags.store is "shared" but config.shared names no backend: name one ({ "adapter": "redis", "url": "..." }), or point flags.store at a file'
    );
  }

  return settings;
}

/**
 * Turns what `config/flags.js` exported into the flags of an application.
 *
 * The short form is the name and its default (`checkout: false`); the long
 * one adds a description, whether the flag reaches a page, and the group.
 * Anything else is refused here rather than answering something surprising
 * later.
 *
 * @param {*} exported what the file exported
 * @returns {Map<string, object>} the declarations, by name
 * @throws {Error} HENRI_FLAGS_DECLARATION_INVALID on anything else
 */
function declarationsOf(exported) {
  const declared = new Map();

  if (exported === null || typeof exported === 'undefined') {
    return declared;
  }

  if (typeof exported !== 'object' || Array.isArray(exported)) {
    throw fail(
      'HENRI_FLAGS_DECLARATION_INVALID',
      `${DECLARATIONS} must export an object of flags ({ checkout: false }), but it exported ${
        Array.isArray(exported) ? 'an array' : typeof exported
      }`
    );
  }

  for (const [name, value] of Object.entries(exported)) {
    if (!NAME.test(name)) {
      throw fail(
        'HENRI_FLAGS_DECLARATION_INVALID',
        `"${name}" is not a flag name: letters and digits, with a single - _ or . between them (checkout, new-editor, billing.v2)`
      );
    }

    if (typeof value === 'boolean') {
      declared.set(name, {
        default: value,
        description: null,
        expose: false,
        group: null,
        name,
      });
      continue;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw fail(
        'HENRI_FLAGS_DECLARATION_INVALID',
        `the flag "${name}" must be true, false, or an object ({ default, description, expose, group }), but it is ${
          Array.isArray(value) ? 'an array' : typeof value
        }`
      );
    }

    if (
      typeof value.default !== 'undefined' &&
      typeof value.default !== 'boolean'
    ) {
      throw fail(
        'HENRI_FLAGS_DECLARATION_INVALID',
        `the default of "${name}" must be true or false: a flag answers one of two things, and the third would be an undeclared state`
      );
    }

    if (
      typeof value.group !== 'undefined' &&
      value.group !== null &&
      typeof value.group !== 'function'
    ) {
      throw fail(
        'HENRI_FLAGS_DECLARATION_INVALID',
        `the group of "${name}" must be a function of the actor ((user) => Boolean(user) && user.roles.includes('staff'))`
      );
    }

    declared.set(name, {
      default: value.default === true,
      description:
        typeof value.description === 'string' && value.description.trim() !== ''
          ? value.description.trim()
          : null,
      expose: value.expose === true,
      group: typeof value.group === 'function' ? value.group : null,
      name,
    });
  }

  return declared;
}

/**
 * Reads `config/flags.js`, if the application has one.
 *
 * An application with no flags has no file, which is not a failure: it is
 * every application that has not needed one yet.
 *
 * @param {string} cwd the application directory
 * @returns {Map<string, object>} the declarations, by name
 * @throws {Error} when the file is there and does not hold flags
 */
function loadDeclarations(cwd) {
  const file = path.join(cwd, DECLARATIONS);

  if (!fs.existsSync(file)) {
    debug('no %s in %s', DECLARATIONS, cwd);

    return new Map();
  }

  // Re-read on a reload, like the routes: the file is the application's,
  // and it has just changed under us
  delete require.cache[require.resolve(file)];

  return declarationsOf(require(file));
}

/**
 * What the store holds for a flag, whatever it actually held.
 *
 * The value comes back from a file somebody may have edited or a Redis
 * anybody with the password can write, so nothing here trusts its shape: a
 * percentage that is not a number is no percentage, and an actor list that
 * is not a list of strings is no list.
 *
 * @param {*} raw what the store answered
 * @returns {{actors: Array<string>, at: ?number, boolean: ?boolean, percentage: number}} the state
 */
function stateOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return EMPTY;
  }

  const percentage = Number(raw.percentage);

  return {
    actors: Array.isArray(raw.actors)
      ? raw.actors.filter((one) => typeof one === 'string' && one !== '')
      : [],
    at: Number.isFinite(Number(raw.at)) ? Number(raw.at) : null,
    boolean: typeof raw.boolean === 'boolean' ? raw.boolean : null,
    percentage:
      Number.isFinite(percentage) && percentage > 0
        ? Math.min(100, percentage)
        : 0,
  };
}

/**
 * Is this state the same as no state at all? (what `reset()` leaves)
 *
 * @param {object} state a normalized state
 * @returns {boolean} true when nothing has been flipped
 */
function isEmpty(state) {
  return (
    state.boolean === null &&
    state.percentage === 0 &&
    state.actors.length === 0
  );
}

/**
 * Where an actor lands, for one flag: a number in [0, 1).
 *
 * Stable by construction -- it is a hash of two strings and nothing else,
 * so it does not depend on the process, the order the actors arrived in or
 * anything henri stores. See the header for why the flag name is in it and
 * why the identifier is hashed whole.
 *
 * @param {string} name the flag name
 * @param {string} actor the actor's public identifier
 * @returns {number} the bucket, in [0, 1)
 */
function bucket(name, actor) {
  const digest = crypto
    .createHash('sha256')
    .update(`${name} ${actor}`, 'utf8')
    .digest();

  return digest.readUInt32BE(0) / 2 ** 32;
}

/**
 * The public identifier of whoever is asking.
 *
 * A record uses its `externalId`, because that is the identifier that
 * leaves the server; a string is taken as one, for the applications whose
 * actor is a tenant or an account rather than a user. A number is refused,
 * and refused loudly, because a number is what a primary key looks like.
 *
 * @param {*} actor a record, a string, or null
 * @returns {?string} the identifier, or null for nobody
 * @throws {Error} HENRI_FLAGS_ACTOR_INVALID for anything else
 */
function actorOf(actor) {
  if (actor === null || typeof actor === 'undefined') {
    return null;
  }

  if (typeof actor === 'string') {
    return actor === '' ? null : actor;
  }

  if (typeof actor === 'number' || typeof actor === 'bigint') {
    throw fail(
      'HENRI_FLAGS_ACTOR_INVALID',
      `${actor} is a primary key, and a primary key never leaves the server: pass the record itself, or its externalId`
    );
  }

  if (hasExternalId(actor)) {
    return actor.externalId;
  }

  throw fail(
    'HENRI_FLAGS_ACTOR_INVALID',
    'a flag actor is a record carrying an externalId, or the identifier itself as a string: this one carries neither (a model with `options: { externalId: false }` has no public identifier to bucket on)'
  );
}

/**
 * Is this flag on for this actor? (the six answers of the header)
 *
 * @param {object} declaration the flag, from config/flags.js
 * @param {object} state what the store holds for it
 * @param {?string} actor the actor's public identifier
 * @param {*} subject what the group is asked about (the record, or null)
 * @returns {boolean} on or off
 */
function decide(declaration, state, actor, subject) {
  if (state.boolean === true) {
    return true;
  }

  if (actor !== null && state.actors.includes(actor)) {
    return true;
  }

  if (
    actor !== null &&
    state.percentage > 0 &&
    bucket(declaration.name, actor) * 100 < state.percentage
  ) {
    return true;
  }

  // The kill switch. It is asked here rather than first because `disable()`
  // clears the two gates above, so the only way to reach this with one of
  // them open is somebody adding it afterwards, deliberately
  if (state.boolean === false) {
    return false;
  }

  if (declaration.group) {
    // Only `true` opens it, for the reason base/policies.js gives about a
    // rule returning a truthy string, and a group that throws is not a yes
    try {
      return declaration.group(subject) === true;
    } catch (error) {
      debug('the group of %s threw: %s', declaration.name, error.message);

      return declaration.default;
    }
  }

  return declaration.default;
}

/**
 * The state of every flag, in this process's memory and nowhere else.
 *
 * What a suite gets, and what an application gets when it asks for it: a
 * flag flipped here is flipped for this process, so `henri flags:on` in a
 * shell reaches nothing that is already running. The boot line says that.
 *
 * @class MemoryFlagStore
 */
class MemoryFlagStore {
  /**
   * Creates an instance of MemoryFlagStore.
   * @memberof MemoryFlagStore
   */
  constructor() {
    this.name = 'memory';
    this.shared = false;
    this.entries = new Map();
  }

  /**
   * What it is talking to, for the boot line
   *
   * @returns {string} a one-line description
   * @memberof MemoryFlagStore
   */
  describe() {
    return 'this process only';
  }

  /**
   * The state of the flags asked for
   *
   * @param {Array<string>} names the declared flag names
   * @returns {Promise<Map<string, object>>} the state, by name
   * @memberof MemoryFlagStore
   */
  async read(names) {
    return new Map(
      names
        .filter((name) => this.entries.has(name))
        .map((name) => [name, this.entries.get(name)])
    );
  }

  /**
   * Writes the state of one flag
   *
   * @param {string} name the flag name
   * @param {?object} state the state, or null to forget it
   * @returns {Promise<boolean>} done
   * @memberof MemoryFlagStore
   */
  async write(name, state) {
    state === null ? this.entries.delete(name) : this.entries.set(name, state);

    return true;
  }

  /**
   * Releases what it holds
   *
   * @returns {Promise<boolean>} done
   * @memberof MemoryFlagStore
   */
  async stop() {
    this.entries.clear();

    return true;
  }
}

/**
 * The state of every flag, in one JSON file.
 *
 * One machine rather than one process, which is what makes
 * `henri flags:on beta` in a terminal reach the `henri server` running in
 * the one next to it. It is not a database: the file is small, it is read
 * whole and written whole, and a write is a temporary file plus a rename,
 * so a reader never sees half of one.
 *
 * A poll stats the file first and parses nothing when the mtime has not
 * moved, so the steady state is one `stat` every `refresh`.
 *
 * @class FileFlagStore
 */
class FileFlagStore {
  /**
   * Creates an instance of FileFlagStore.
   *
   * @param {string} file the absolute path of the state file
   * @memberof FileFlagStore
   */
  constructor(file) {
    this.name = 'file';
    this.shared = false;
    this.file = file;
    this.stamp = null;
    this.held = new Map();
  }

  /**
   * What it is talking to, for the boot line
   *
   * @returns {string} a one-line description
   * @memberof FileFlagStore
   */
  describe() {
    return `${this.file}, this machine only`;
  }

  /**
   * The state of the flags asked for, re-parsing the file only when it has
   * changed since the last read
   *
   * @param {Array<string>} names the declared flag names
   * @returns {Promise<Map<string, object>>} the state, by name
   * @throws whatever the filesystem threw, unless the file is simply absent
   * @memberof FileFlagStore
   */
  async read(names) {
    let stat;

    try {
      stat = await fsp.stat(this.file);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      // No file is no flips, which is a perfectly good answer and not a
      // failure: it is every application before the first `flags:on`
      this.stamp = null;
      this.held = new Map();

      return new Map();
    }

    const stamp = `${stat.mtimeMs}:${stat.size}`;

    if (stamp !== this.stamp) {
      this.held = await this.parse();
      this.stamp = stamp;
    }

    return new Map(
      names
        .filter((name) => this.held.has(name))
        .map((name) => [name, this.held.get(name)])
    );
  }

  /**
   * Everything the file holds, by name
   *
   * @returns {Promise<Map<string, object>>} the state
   * @memberof FileFlagStore
   */
  async parse() {
    const raw = await fsp.readFile(this.file, 'utf8');
    let held;

    try {
      held = JSON.parse(raw);
    } catch (error) {
      throw fail(
        'HENRI_FLAGS_STORE_UNUSABLE',
        `${this.file} is not readable as JSON: ${error.message}`,
        { cause: error }
      );
    }

    if (!held || typeof held !== 'object' || Array.isArray(held)) {
      throw fail(
        'HENRI_FLAGS_STORE_UNUSABLE',
        `${this.file} must hold an object of flag states, but it holds ${
          Array.isArray(held) ? 'an array' : typeof held
        }`
      );
    }

    return new Map(
      Object.entries(held).map(([name, state]) => [name, stateOf(state)])
    );
  }

  /**
   * Writes the state of one flag, leaving every other flag alone.
   *
   * It re-reads the file rather than trusting the snapshot, so two
   * terminals flipping two flags at once keep both.
   *
   * @param {string} name the flag name
   * @param {?object} state the state, or null to forget it
   * @returns {Promise<boolean>} done
   * @memberof FileFlagStore
   */
  async write(name, state) {
    const dir = path.dirname(this.file);
    const created = await fsp.mkdir(dir, { mode: DIR_MODE, recursive: true });

    if (created) {
      // Only a directory henri made itself, and never one that was already
      // there: an application pointing this at `config/` would otherwise
      // get a `.gitignore` holding `*` dropped into its configuration
      await fsp
        .writeFile(path.join(dir, '.gitignore'), GITIGNORE, { flag: 'wx' })
        .catch(() => {});
    }

    let held;

    try {
      held = await this.parse();
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === UNUSABLE) {
        // An unreadable file is replaced rather than appended to: what it
        // held could not be understood, and refusing every write until
        // somebody deletes it by hand helps nobody
        held = new Map();
      } else {
        throw error;
      }
    }

    state === null ? held.delete(name) : held.set(name, state);

    // Per call, not per process: two writes racing inside one process would
    // otherwise rename each other's half-written file into place
    const temporary = `${this.file}.${process.pid}.${crypto
      .randomBytes(4)
      .toString('hex')}.tmp`;
    const body = `${JSON.stringify(
      Object.fromEntries([...held.entries()].sort()),
      null,
      2
    )}\n`;

    await fsp.writeFile(temporary, body, { mode: FILE_MODE });
    // Atomic on the same filesystem: a reader sees the old file or the new
    // one, never a truncated one
    await fsp.rename(temporary, this.file);

    this.stamp = null;

    return true;
  }

  /**
   * Nothing is held open
   *
   * @returns {Promise<boolean>} done
   * @memberof FileFlagStore
   */
  async stop() {
    this.held = new Map();
    this.stamp = null;

    return true;
  }
}

/**
 * The state of every flag, on the backend `config.shared` names.
 *
 * One key per flag rather than one key for all of them, so two operators
 * flipping two flags in the same second keep both writes: the read, modify
 * and write of a single blob would lose one. Two operators flipping *the
 * same* flag is still last-writer-wins, which is what a switch should do.
 *
 * The store is taken `unguarded`, like the cache's: a flag read must not
 * be able to answer 503, and `config.shared.onError` is about counting,
 * which this is not. What a failure means here is in the module -- keep
 * the snapshot, report it, change nothing.
 *
 * @class SharedFlagStore
 */
class SharedFlagStore {
  /**
   * Creates an instance of SharedFlagStore.
   *
   * @param {object} store what `shared.unguarded('flags')` answered
   * @param {string} label what to call the backend
   * @memberof SharedFlagStore
   */
  constructor(store, label) {
    this.name = label;
    this.shared = true;
    this.store = store;
  }

  /**
   * What it is talking to, for the boot line
   *
   * @returns {string} a one-line description
   * @memberof SharedFlagStore
   */
  describe() {
    return 'shared with every process';
  }

  /**
   * The state of the flags asked for, one key each
   *
   * @param {Array<string>} names the declared flag names
   * @returns {Promise<Map<string, object>>} the state, by name
   * @throws whatever the backend threw
   * @memberof SharedFlagStore
   */
  async read(names) {
    const held = await Promise.all(
      names.map(async (name) => [name, await this.store.get(name)])
    );

    return new Map(
      held
        .filter(([, value]) => typeof value !== 'undefined' && value !== null)
        .map(([name, value]) => [name, stateOf(value)])
    );
  }

  /**
   * Writes the state of one flag.
   *
   * No expiry: a flag that turned itself back on after a fortnight would
   * be the worst failure this module could have.
   *
   * @param {string} name the flag name
   * @param {?object} state the state, or null to forget it
   * @returns {Promise<boolean>} done
   * @memberof SharedFlagStore
   */
  async write(name, state) {
    if (state === null) {
      await this.store.delete(name);
    } else {
      await this.store.set(name, state);
    }

    return true;
  }

  /**
   * Releases whatever the backend store holds
   *
   * @returns {Promise<boolean>} done
   * @memberof SharedFlagStore
   */
  async stop() {
    if (typeof this.store.shutdown === 'function') {
      await this.store.shutdown();
    }

    return true;
  }
}

/**
 * Builds the store `config.flags.store` names
 *
 * @param {Henri} henri the henri instance
 * @param {object} settings the normalized `config.flags`
 * @returns {object} the store
 * @throws {Error} when `shared` is asked for and there is no backend
 */
function createFlagStore(henri, settings) {
  const { store } = settings;

  if (store === 'memory') {
    return new MemoryFlagStore();
  }

  if (store === 'shared') {
    if (!henri.shared) {
      throw fail(
        'HENRI_FLAGS_STORE_UNUSABLE',
        'config.flags.store is "shared" but there is no shared backend: name one in config.shared ({ "adapter": "redis", "url": "..." })'
      );
    }

    return new SharedFlagStore(
      henri.shared.unguarded('flags'),
      henri.shared.name
    );
  }

  return new FileFlagStore(
    path.resolve(henri.cwd(), store === 'file' ? FILE : store)
  );
}

/**
 * The message for a flag name nothing declares, naming the near miss
 *
 * @param {string} name what was asked for
 * @param {Array<string>} known the declared names
 * @param {string} [asked='henri.flags.enabled()'] where it was asked
 * @returns {Error} the failure to throw
 */
function unknownFlag(name, known, asked = 'henri.flags.enabled()') {
  const close = nearest(String(name), known);
  const list =
    known.length > 0
      ? `this application declares ${known.join(', ')}`
      : `this application declares none: add it to ${DECLARATIONS}`;

  return fail(
    'HENRI_FLAGS_UNKNOWN',
    `${asked} asked for "${name}", which is not a declared flag -- ${
      close ? `did you mean "${close}"? Otherwise ${list}` : list
    }`
  );
}

module.exports = {
  DECLARATIONS,
  DEFAULTS,
  EMPTY,
  FILE,
  FileFlagStore,
  GITIGNORE,
  MIN_REFRESH,
  MemoryFlagStore,
  NAME,
  REPORT_EVERY,
  STORES,
  SharedFlagStore,
  actorOf,
  bucket,
  createFlagStore,
  decide,
  declarationsOf,
  flagsConfig,
  isEmpty,
  loadDeclarations,
  stateOf,
  unknownFlag,
};
