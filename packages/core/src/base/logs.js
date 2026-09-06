/**
 * Structured logs: the same lines `pen` writes, as objects a machine reads.
 *
 * `pen` is a pretty printer -- aligned module names, colours, a pencil,
 * relative timings -- and it is the right thing in a terminal. Everywhere
 * else the formatting is what destroys the line: the timestamp, the level,
 * the module name and the request id all exist in the process and are
 * spent on alignment, so nothing can index them, query them or alert on
 * them. This module is the other rendering of the same call: one JSON
 * object per line, on stdout, with those fields as fields.
 *
 * ## The line
 *
 * ```json
 * {"time":"2026-09-06T12:00:00.000Z","level":"info","module":"router",
 *  "requestId":"9f3c...","msg":"GET /tasks","data":[{"page":2}]}
 * ```
 *
 * - `time` -- ISO 8601, UTC. The pretty format prints a local clock time and
 *   a relative `+3ms`, neither of which sorts or merges across machines.
 * - `level` -- pen's own levels, unchanged: `error`, `warn`, `info`,
 *   `verbose`, `debug`, `silly`.
 * - `module` -- the first argument of every `pen` call, which is what the
 *   pretty format pads and colours.
 * - `requestId` -- `base/request-id.js` already threads it through `pen`
 *   through an AsyncLocalStorage; the pretty format prints eight characters
 *   of it, and this prints all of it. Absent outside a request.
 * - `msg` -- every string-ish argument, joined with a space.
 * - `data` -- every object argument, **masked** (see below). Always a list,
 *   even for one object: the shape of a field never depends on how many
 *   arguments a call site passed.
 * - `err` -- the first Error argument: `name`, `message`, `code` (henri's,
 *   when it carries one), `stack`, and its `cause` chain up to four deep,
 *   which is what a boot failure is made of.
 *
 * Nothing else. No hostname, no pid, no version: whatever runs the process
 * knows those better than henri does, and a collector that has to reconcile
 * henri's guess at a hostname with its own is worse off than one that never
 * got it.
 *
 * ## Masking
 *
 * Every object argument goes through the redactor of `base/redact.js` --
 * `config.filterParameters` as substrings, the fields the models marked
 * `personal` exactly -- at every depth, before it is serialized. That is
 * not a nicety: a structured logger is a machine for faithfully serializing
 * whatever object it was handed, and the pretty format used to summarize
 * that object into a line nobody parsed. Turning summaries into fields is
 * the whole risk of this feature, so the masking is applied here, once, on
 * the way in, and `__tests__/logs.spec.js` proves a filtered parameter and a
 * personal field never reach a line.
 *
 * A *message* is not masked, in either format: henri does not write most of
 * them and cannot know what a call site put in a string. Fields are what
 * changes when the output becomes structured, so fields are what this
 * governs.
 *
 * ## Choices worth naming
 *
 * - **stdout, both levels.** An `error` line does not go to stderr. Two
 *   streams interleave in an order nobody can rely on, and a collector
 *   reading one of them would lose half the story; `level` is a field.
 * - **No dependency.** pino and winston are the obvious answers and they
 *   bring transports, serializers, redaction engines and a version to
 *   follow into ten published packages. What is actually needed is this
 *   file: build an object, mask it, `JSON.stringify` it.
 * - **Colours are stripped**, because half of henri's own call sites pass
 *   chalk-formatted arguments and an escape sequence inside a JSON string
 *   is a field nobody can match on.
 *
 * @module base/logs
 */

const { currentRequestId } = require('./request-id');

/** What `config.logs.format` accepts (mirrored in `base/config-schema.js`) */
const FORMATS = Object.freeze(['auto', 'json', 'pretty']);

/**
 * The colour sequences chalk writes. Built with the constructor so the
 * escape character stays out of a literal (and out of the linter's way).
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

/** How far the `cause` chain of an error is followed */
const MAX_CAUSE = 4;

/** The keys of a line, in the order they are written */
const KEYS = Object.freeze([
  'time',
  'level',
  'module',
  'requestId',
  'msg',
  'data',
  'err',
]);

/**
 * A string without the terminal colours
 *
 * @param {*} value anything
 * @returns {string} the value as a string, without escape sequences
 */
const strip = (value) => String(value).replace(ANSI, '');

/**
 * Which format this instance writes in
 *
 * `auto` -- the default -- is json in production and pretty everywhere
 * else. Production is the only environment where nobody is watching the
 * terminal: the output goes to a collector, and the fields are worth more
 * than the alignment. Everywhere else a person is reading, and the pretty
 * format is why `pen` exists.
 *
 * The environment decides it, not the terminal: a format that changes with
 * whether stdout happens to be a tty is one nobody can rely on, and the
 * cases are not what a tty check would guess -- a container writes to a
 * pipe and so does a development server behind a process manager.
 *
 * @param {*} henri the henri instance (or anything with config/isProduction)
 * @returns {string} `json` or `pretty`
 */
function formatOf(henri) {
  const config = henri && henri.config;
  const chosen =
    config &&
    typeof config.has === 'function' &&
    typeof config.get === 'function' &&
    config.has('logs.format')
      ? config.get('logs.format')
      : 'auto';

  if (chosen === 'json' || chosen === 'pretty') {
    return chosen;
  }

  return henri && henri.isProduction ? 'json' : 'pretty';
}

/**
 * An error as fields
 *
 * @param {Error} error the error
 * @param {number} [depth=0] how far down the cause chain we are
 * @returns {object} `{ name, message, code, stack, cause }`
 */
function errorOf(error, depth = 0) {
  const found = {
    message: strip(error.message || String(error)),
    name: error.name || 'Error',
  };

  // The code is the stable name of the failure (`base/errors.js`), which is
  // what an operator searches for and what an alert groups on
  if (typeof error.code === 'string') {
    found.code = error.code;
  }

  if (typeof error.henriCode === 'string') {
    found.henriCode = error.henriCode;
  }

  if (typeof error.stack === 'string') {
    found.stack = strip(error.stack);
  }

  if (error.cause instanceof Error && depth < MAX_CAUSE) {
    found.cause = errorOf(error.cause, depth + 1);
  }

  return found;
}

/**
 * One log line, as an object
 *
 * @param {object} options the call
 * @param {Array} [options.args=[]] the arguments of the `pen` call
 * @param {string} [options.level='info'] the level
 * @param {string} [options.name='henri'] the module name
 * @param {function} [options.redact] the masking (see `base/redact.js`)
 * @param {Date} [options.time] when it happened
 * @returns {object} the line
 */
function entry({
  args = [],
  level = 'info',
  name = 'henri',
  redact = (value) => value,
  time = new Date(),
} = {}) {
  const parts = [];
  const data = [];
  let failure = null;

  for (const arg of args) {
    if (arg instanceof Error) {
      // The first error is the one with the stack; a second is a message
      if (failure) {
        parts.push(strip(arg.message));
      } else {
        failure = arg;
      }
      continue;
    }

    if (arg !== null && typeof arg === 'object') {
      data.push(redact(arg));
      continue;
    }

    if (arg !== null && arg !== undefined) {
      parts.push(strip(arg));
    }
  }

  // Written in the order they are read, which is why this is not a literal
  const line = {};

  line.time = time.toISOString();
  line.level = level;
  line.module = strip(name).trim();

  const id = currentRequestId();

  if (id) {
    line.requestId = id;
  }

  line.msg = parts.join(' ');

  if (data.length > 0) {
    line.data = data;
  }

  if (failure) {
    line.err = errorOf(failure);
  }

  return line;
}

/**
 * A line, as the string that is printed
 *
 * A value that cannot be serialized (a getter that throws, a `toJSON` that
 * does) costs the fields, never the line: something always comes out, and
 * it says why it is short.
 *
 * @param {object} line what `entry()` built
 * @returns {string} one line of json
 */
function serialize(line) {
  try {
    return JSON.stringify(line);
  } catch (error) {
    return JSON.stringify({
      level: line.level,
      module: line.module,
      msg: '[unserializable log line]',
      time: line.time,
    });
  }
}

module.exports = {
  ANSI,
  FORMATS,
  KEYS,
  entry,
  errorOf,
  formatOf,
  serialize,
  strip,
};
