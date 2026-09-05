const fs = require('fs-extra');
const path = require('path');

const { CliError } = require('./errors');
const { validInstall } = require('./utils');

/**
 * What `henri clean` may remove
 */
const CANDIDATES = [
  '.tmp',
  '.henri',
  'logs',
  'node_modules',
  'app/views/.cache',
  'app/views/.next',
];

/**
 * Remove build artifacts and caches
 *
 * Interactive in a terminal; with --all (or -y, --yes) or a list of
 * folders, nothing is asked. Fails fast when stdin is not a terminal and
 * no flag was given.
 *
 * @param {object} [args] CLI arguments
 * @return {Promise<void>} Resolves when done
 * @throws {CliError} USAGE for an unknown folder, NEEDS_TTY without a terminal
 */
const main = async (args = {}) => {
  validInstall({ fatal: true });

  const json = args.json === true;
  const existing = getExistingDirectories();
  const wanted = args._.map(String);

  for (const dir of wanted) {
    if (!CANDIDATES.includes(dir)) {
      throw new CliError('USAGE', `"${dir}" is not something henri cleans`, {
        hint: `Folders henri clean can remove: ${CANDIDATES.join(', ')}`,
      });
    }
  }

  const selected = await select(args, existing, wanted);

  for (const dir of selected) {
    if (!json) {
      console.log(`> Deleting ${dir}`);
    }
    remove(dir);
  }

  if (json) {
    console.log(JSON.stringify({ removed: selected }, null, 2));
  } else if (selected.length === 0) {
    console.log(
      existing.length === 0 ? 'Nothing to clean.' : 'Nothing removed.'
    );
  }
};

/**
 * Which existing folders to remove: the ones listed, all of them, or the
 * ones picked in the terminal
 *
 * @param {object} args CLI arguments
 * @param {Array<string>} existing Candidates that exist
 * @param {Array<string>} wanted Folders listed on the command line
 * @returns {Promise<Array<string>>} The folders to remove
 * @throws {CliError} NEEDS_TTY when a prompt is needed without a terminal
 */
const select = async (args, existing, wanted) => {
  if (wanted.length > 0) {
    return existing.filter((dir) => wanted.includes(dir));
  }

  if (args.all === true || args.yes === true) {
    return existing;
  }

  if (existing.length === 0) {
    return [];
  }

  if (!process.stdin.isTTY) {
    throw new CliError(
      'NEEDS_TTY',
      'henri clean needs a terminal to ask which folders to remove',
      {
        hint: `Pass --all, or list the folders: henri clean ${existing.join(' ')}`,
      }
    );
  }

  const { checkbox } = require('@inquirer/prompts');

  try {
    return await checkbox({
      choices: existing.map((dir) => ({ name: dir, value: dir })),
      message: 'Choose folders to delete',
    });
  } catch (error) {
    // Ctrl+C in the prompt
    throw new CliError('FAILED', error.message, { cause: error });
  }
};

/**
 * Get the existing directories
 *
 * @returns {Array<string>} The candidates that exist
 */
const getExistingDirectories = () =>
  CANDIDATES.filter((dir) => fs.existsSync(path.resolve(process.cwd(), dir)));

/**
 * Remove the directory and recreate it empty
 *
 * @param {string} dir The directory
 * @return {void}
 */
const remove = (dir) => {
  fs.rmSync(path.resolve(process.cwd(), dir), { force: true, recursive: true });
  fs.ensureDirSync(path.resolve(process.cwd(), dir));
};

module.exports = main;
module.exports.CANDIDATES = CANDIDATES;
