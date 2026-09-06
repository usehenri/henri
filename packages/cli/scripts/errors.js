/**
 * Errors with a stable exit code and a machine readable code, so scripts
 * and coding agents can tell what went wrong without parsing the message.
 * `henri <command> --json` prints them as
 * `{ "error": { "command", "message", "hint", "code", "exitCode" } }`.
 *
 * The `code` is one of henri's own, from the catalogue of
 * `@usehenri/core/error-codes.json`: the same names the framework raises at
 * runtime, so a boot failure keeps its code all the way to the shell instead
 * of collapsing into `FAILED`. The exit status is the coarse one, five
 * numbers a shell can branch on.
 */

const { catalogue, exitOf, isCode } = require('@usehenri/core/errors');

/**
 * Exit codes of the henri command line (see `henri help`)
 */
const EXIT_CODES = [
  { code: 0, description: 'success', name: 'OK' },
  {
    code: 1,
    description:
      'the command failed (also: henri doctor found problems, the tests failed)',
    name: 'FAILED',
  },
  {
    code: 2,
    description: 'usage error: unknown command, missing or invalid argument',
    name: 'USAGE',
  },
  {
    code: 3,
    description:
      'not a henri application: run the command from the root of the app',
    name: 'NOT_A_PROJECT',
  },
  {
    code: 4,
    description:
      'an interactive prompt was needed but stdin is not a terminal: pass the flag',
    name: 'NEEDS_TTY',
  },
];

/**
 * The short names the command line used before the codes had a namespace.
 * `new CliError('USAGE', ...)` still reads as it did at a call site; the
 * error carries the catalogue's name.
 */
const ALIASES = {
  CHECKS_FAILED: 'HENRI_CLI_CHECKS_FAILED',
  CONFIG_INVALID: 'HENRI_CONFIG_INVALID',
  EXISTS: 'HENRI_CLI_EXISTS',
  FAILED: 'HENRI_CLI_FAILED',
  NEEDS_TTY: 'HENRI_CLI_NEEDS_TTY',
  NOT_A_PROJECT: 'HENRI_CLI_NOT_A_PROJECT',
  NOT_INSTALLED: 'HENRI_CLI_NOT_INSTALLED',
  USAGE: 'HENRI_CLI_USAGE',
};

/**
 * Every henri error code, with the exit status it leaves the shell with
 */
const CODES = Object.fromEntries(
  catalogue.codes.map((entry) => [entry.code, exitOf(entry.code)])
);

/**
 * The catalogue name of a code, whatever a call site called it
 *
 * @param {*} code a code, or one of the legacy short names
 * @returns {string} the henri code (HENRI_CLI_FAILED for anything unknown)
 */
const nameOf = (code) => {
  const named = ALIASES[code] || code;

  return isCode(named) ? named : 'HENRI_CLI_FAILED';
};

/**
 * A command failure with a code, an exit code and a hint
 *
 * @class CliError
 * @extends {Error}
 */
class CliError extends Error {
  /**
   * @param {string} code A henri error code, or one of ALIASES
   * @param {string} message What went wrong
   * @param {object} [options] Options
   * @param {string} [options.hint] What to do about it
   * @param {Error} [options.cause] The underlying error
   */
  constructor(code, message, { hint = null, cause = undefined } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CliError';
    this.code = nameOf(code);
    this.exitCode = exitOf(this.code);
    this.hint = hint;
  }
}

/**
 * The first error of a `cause` chain that already carries a henri code
 *
 * A boot failure reaches the command line wrapped ("henri - unable to
 * execute init(): ..."), so the error that knows what went wrong -- the
 * ConfigurationError of `@usehenri/core`, for one -- is a cause away.
 *
 * @param {*} error What was thrown
 * @returns {?object} The error carrying the code, or null
 */
const coded = (error) => {
  const seen = new Set();
  let current = error;

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);

    if (isCode(current.code)) {
      return current;
    }

    current = current.cause;
  }

  return null;
};

/**
 * Coerce anything thrown into a CliError
 *
 * An error that already names one of the catalogue's codes keeps it, along
 * with its hint and its message, wherever it sits in the `cause` chain.
 *
 * @param {*} error What was thrown
 * @returns {CliError} The same error, or a wrapper around it
 */
const toCliError = (error) => {
  if (error instanceof CliError) {
    return error;
  }

  const known = coded(error);

  if (known) {
    const wrapped = new CliError(known.code, known.message, {
      cause: error instanceof Error ? error : undefined,
      hint: known.hint || null,
    });

    wrapped.problems = known.problems;

    return wrapped;
  }

  const message = (error && error.message) || String(error);

  return new CliError('FAILED', message, {
    cause: error instanceof Error ? error : undefined,
    hint: 'Run the command with --debug=henri:* for the details',
  });
};

module.exports = { ALIASES, CODES, CliError, EXIT_CODES, toCliError };
