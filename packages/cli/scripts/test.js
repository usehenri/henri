 
const { spawn } = require('child_process');
const path = require('path');

// Flags consumed by the henri cli itself (see index.js setGlobalEnv)
const HENRI_FLAGS = new Set([
  '--debug',
  '--force-build',
  '--inspect',
  '--production',
  '--skip-workers',
  '--wait',
]);

/**
 * Locate the vitest binary installed in the project
 *
 * @param {string} cwd project directory
 * @returns {string} absolute path of vitest's cli entry
 * @throws when vitest is not installed in the project
 */
const resolveVitest = (cwd) => {
  const manifest = require.resolve('vitest/package.json', { paths: [cwd] });
  const { bin } = require(manifest);

  return path.join(
    path.dirname(manifest),
    typeof bin === 'string' ? bin : bin.vitest
  );
};

/**
 * Everything after `test` on the command line, minus henri's own flags
 *
 * @returns {string[]} arguments handed to vitest
 */
const passthrough = () => {
  const argv = process.argv.slice(2);
  const index = argv.indexOf('test');

  return (index < 0 ? [] : argv.slice(index + 1)).filter(
    (arg) => !HENRI_FLAGS.has(arg.split('=')[0])
  );
};

/**
 * Runs the project's tests with vitest (NODE_ENV=test)
 *
 * @returns {Promise<void>} resolves when vitest exits; the process exits with
 * vitest's exit code
 */
const main = () => {
  const cwd = process.cwd();
  let vitest;

  try {
    vitest = resolveVitest(cwd);
  } catch {
    console.error(`
  vitest is not installed in this project.

  Add it with your package manager, along with the henri helpers:

    pnpm add -D vitest @usehenri/testing

  See https://github.com/usehenri/henri/tree/master/packages/testing
`);
    process.exit(1);
  }

  const args = passthrough();
  const watch = args.some((arg) => arg === '--watch' || arg === '-w');
  const command = watch
    ? args.filter((arg) => arg !== '--watch' && arg !== '-w')
    : ['run', ...args];

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [vitest, ...command], {
      cwd,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      console.error(`unable to start vitest: ${error.message}`);
      process.exit(1);
    });

    child.on('exit', (code, signal) => {
      resolve();
      process.exit(signal ? 1 : (code ?? 1));
    });
  });
};

module.exports = main;
