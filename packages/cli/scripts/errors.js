/**
 * Errors with a stable exit code and a machine readable code, so scripts
 * and coding agents can tell what went wrong without parsing the message.
 * `henri <command> --json` prints them as
 * `{ "error": { "command", "message", "hint", "code", "exitCode" } }`.
 */

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
 * Error codes: more specific than the exit codes, each mapped to one
 */
const CODES = {
  CHECKS_FAILED: 1,
  CONFIG_INVALID: 1,
  EXISTS: 1,
  FAILED: 1,
  NEEDS_TTY: 4,
  NOT_A_PROJECT: 3,
  NOT_INSTALLED: 1,
  USAGE: 2,
};

/**
 * A command failure with a code, an exit code and a hint
 *
 * @class CliError
 * @extends {Error}
 */
class CliError extends Error {
  /**
   * @param {string} code One of CODES (unknown codes exit with 1)
   * @param {string} message What went wrong
   * @param {object} [options] Options
   * @param {string} [options.hint] What to do about it
   * @param {Error} [options.cause] The underlying error
   */
  constructor(code, message, { hint = null, cause = undefined } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CliError';
    this.code = CODES[code] ? code : 'FAILED';
    this.exitCode = CODES[this.code];
    this.hint = hint;
  }
}

/**
 * The first error of a `cause` chain that already carries one of CODES
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

    if (typeof current.code === 'string' && CODES[current.code]) {
      return current;
    }

    current = current.cause;
  }

  return null;
};

/**
 * Coerce anything thrown into a CliError
 *
 * An error that already names one of CODES keeps it, along with its hint
 * and its message, wherever it sits in the `cause` chain.
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

module.exports = { CODES, CliError, EXIT_CODES, toCliError };
