const { spawn } = require('child_process');
const path = require('path');

/**
 * Run a henri command in a child process and capture its output
 *
 * Arguments are passed as an array (no shell), so nothing in them is
 * interpreted. The caller validates them anyway (see server.js).
 *
 * @param {string} cwd The application directory
 * @param {Array<string>} args The command line (ex: ['routes', '--json'])
 * @param {object} [options] Options
 * @param {number} [options.timeout=120000] Kill the command after this (ms)
 * @param {object} [options.env] Extra environment variables
 * @returns {Promise<{status: number|null, stdout: string, stderr: string, timedOut: boolean}>} The result
 */
const runCli = (cwd, args, { timeout = 120000, env = {} } = {}) =>
  new Promise((resolve) => {
    const runner = path.join(__dirname, 'run-cli.js');
    const child = spawn(process.execPath, [runner, ...args], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);

    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ status: null, stderr: error.message, stdout, timedOut });
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stderr, stdout, timedOut });
    });
  });

/**
 * Parse the JSON a `--json` command printed on stdout, or the error
 * envelope it printed on stderr
 *
 * @param {{status: number|null, stdout: string, stderr: string, timedOut: boolean}} result The command result
 * @returns {{ok: boolean, data: object|null, error: object|null, output: string}} The parsed result
 */
const parseJson = (result) => {
  const parse = (text) => {
    const trimmed = text.trim();

    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  };

  const error = parse(result.stderr);
  const data = parse(result.stdout);

  if (result.timedOut) {
    return {
      data,
      error: { code: 'TIMEOUT', message: 'the command timed out' },
      ok: false,
      output: result.stderr,
    };
  }

  if (result.status === 0 && data !== null) {
    return { data, error: null, ok: true, output: result.stderr };
  }

  return {
    data,
    error: (error && error.error) || {
      code: 'FAILED',
      exitCode: result.status,
      message:
        result.stderr.trim() || result.stdout.trim() || 'the command failed',
    },
    ok: false,
    output: result.stderr,
  };
};

module.exports = { parseJson, runCli };
