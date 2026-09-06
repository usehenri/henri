const { CliError } = require('./errors');
const { usage } = require('./help');
const { boot, validInstall } = require('./utils');

/**
 * `henri versions`: the history of the models that keep one, read back.
 *
 * - `henri versions [<Model> [<record>]]` prints the latest versions,
 *   filtered by `--actor`, `--event`, `--request`, `--since` and `--until`.
 * - `henri versions:show <id>` prints one version and what the record
 *   looked like immediately after it (`reify`), without touching anything.
 * - `henri versions:restore <id>` writes that back, and refuses a
 *   reconstruction that is not exact unless `--force`.
 *
 * All three boot to runlevel 4: no port is bound and no route is
 * registered. The work is `henri.versions` (`core/src/4.versions.js`).
 */

const COMMANDS = ['list', 'restore', 'show'];

/** How many versions a listing prints unless `--limit` says */
const LIMIT = 25;

/**
 * Runs one operation against a booted application and stops it again
 *
 * @param {function} work `(henri) => result`
 * @returns {Promise<*>} What the work resolved with
 */
const withHenri = async (work) => {
  const henri = await boot({ runlevel: 4 });

  try {
    return await work(henri);
  } finally {
    await henri.stop();
  }
};

/**
 * The filter the command line asked for
 *
 * @param {object} args CLI arguments
 * @returns {object} The filter
 */
const filterOf = (args) => {
  const [, model, record] = args._;
  const text = (name) =>
    typeof args[name] === 'string' && args[name] !== ''
      ? args[name]
      : undefined;

  return {
    actor: text('actor'),
    event: text('event'),
    limit: Number(args.limit) || LIMIT,
    model: typeof model === 'string' && model !== '' ? model : undefined,
    record: typeof record === 'string' && record !== '' ? record : undefined,
    requestId: text('request'),
    since: text('since'),
    until: text('until'),
  };
};

/**
 * The latest versions
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const list = async (args) => {
  const filter = filterOf(args);
  const versions = await withHenri((henri) => henri.versions.list(filter));

  return { command: 'list', filter, ok: true, versions };
};

/**
 * The id a `show` or a `restore` was given
 *
 * @param {object} args CLI arguments
 * @param {string} command The command, for the message
 * @returns {string} The id
 * @throws {CliError} USAGE when no version was named
 */
const idOf = (args, command) => {
  const [, id] = args._;

  if (typeof id !== 'string' || id.trim() === '') {
    throw new CliError(
      'USAGE',
      `henri versions:${command} needs the id of a version`,
      { hint: 'henri versions <Model> <record> lists them with their ids' }
    );
  }

  return id.trim();
};

/**
 * One version, and the record as it was right after it
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const show = async (args) => {
  const id = idOf(args, 'show');
  const reified = await withHenri((henri) => henri.versions.reify(id));

  return { command: 'show', ok: true, ...reified };
};

/**
 * Writes a reified record back
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const restore = async (args) => {
  const id = idOf(args, 'restore');
  const done = await withHenri((henri) =>
    henri.versions.restore(id, { force: args.force === true })
  );

  return {
    command: 'restore',
    created: done.created,
    missing: done.missing,
    model: done.version.model,
    ok: true,
    record: done.version.record,
  };
};

/**
 * One value, short enough for a line
 *
 * @param {*} value Anything a version holds
 * @returns {string} The value, printed
 */
const short = (value) => {
  if (value === null || typeof value === 'undefined') {
    return '(none)';
  }

  const text = typeof value === 'string' ? value : JSON.stringify(value);

  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

/**
 * Prints a listing
 *
 * @param {object} result What list() answered
 * @returns {void}
 */
const printList = ({ versions }) => {
  console.log('');

  if (versions.length === 0) {
    console.log('  Nothing is versioned matching that.');
    console.log('');

    return;
  }

  for (const version of versions) {
    console.log(
      `  ${version.at.toISOString()}  ${version.event.padEnd(8)} ${
        version.model
      } ${version.record}`
    );

    const notes = [
      version.actor ? `actor ${version.actor}` : `source ${version.source}`,
      version.requestId ? `request ${version.requestId}` : null,
      version.erasedAt ? 'erased' : null,
    ].filter(Boolean);

    console.log(`    ${version.id}  ${notes.join('  ')}`);

    for (const field of Object.keys(version.changes)) {
      const change = version.changes[field];

      console.log(
        change === null
          ? `    ${field}: changed, not kept`
          : `    ${field}: ${short(change[0])} -> ${short(change[1])}`
      );
    }
  }

  console.log('');
};

/**
 * Prints a reification
 *
 * @param {object} result What show() answered
 * @returns {void}
 */
const printShow = ({ attributes, complete, existed, missing, version }) => {
  console.log('');
  console.log(
    `  ${version.model} ${version.record}, as it was after ${version.id}`
  );
  console.log(
    `  ${version.at.toISOString()}  ${version.event}  ${
      existed ? 'the record still exists' : 'the record is gone'
    }`
  );
  console.log('');

  for (const field of Object.keys(attributes).sort()) {
    console.log(`    ${field}: ${short(attributes[field])}`);
  }

  console.log('');

  if (!complete) {
    console.log(
      `  This is not exact: no values are kept for ${
        missing.length > 0 ? missing.join(', ') : 'some of the record'
      }.`
    );
    console.log(
      '  henri versions:restore --force writes what is kept and leaves the rest.'
    );
    console.log('');
  }
};

/**
 * Prints a restore
 *
 * @param {object} result What restore() answered
 * @returns {void}
 */
const printRestore = ({ created, missing, model, record }) => {
  console.log('');
  console.log(
    `  ${model} ${record} was ${created ? 'created again' : 'written back'}.`
  );

  if (missing.length > 0) {
    console.log(
      `  ${missing.join(', ')} kept no values and were left as they were.`
    );
  }

  console.log('');
};

/**
 * Runs `henri versions [list|show|restore]` (`henri versions:<command>` too)
 *
 * @param {object} args CLI arguments
 * @returns {Promise<void>} Resolves when done
 * @throws {CliError} USAGE on an unknown command, NOT_A_PROJECT elsewhere
 */
const main = async (args) => {
  const [first] = args._;
  const command = COMMANDS.includes(first) ? first : 'list';

  // `henri versions Memo` is a listing of that model rather than an unknown
  // command, and a model is capitalised everywhere else henri prints one
  // (`henri routes`, `henri privacy`), so that is what tells the two apart
  if (
    typeof first === 'string' &&
    !COMMANDS.includes(first) &&
    /^[a-z]/u.test(first)
  ) {
    if (!args.json) {
      console.log(usage('versions'));
    }

    throw new CliError('USAGE', `Unknown versions command "${first}"`, {
      hint: `Available commands: ${COMMANDS.join(', ')}. A model name is capitalised: henri versions Memo`,
    });
  }

  // Every branch reads `args._` as [command, ...], so a listing that named
  // a model straight away gets the word back
  const argv = COMMANDS.includes(first)
    ? args
    : { ...args, _: ['list', ...args._] };

  validInstall({ fatal: true });

  const log = console.log;

  // With --json stdout is the result only: the boot log goes to stderr
  if (args.json) {
    console.log = (...parts) => console.error(...parts);
  }

  let result;

  try {
    if (command === 'show') {
      result = await show(argv);
    } else if (command === 'restore') {
      result = await restore(argv);
    } else {
      result = await list(argv);
    }
  } finally {
    console.log = log;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.command === 'show') {
    printShow(result);
  } else if (result.command === 'restore') {
    printRestore(result);
  } else {
    printList(result);
  }

  // The drivers are closed by henri.stop(); leave nothing behind
  process.exit(result.ok ? 0 : 1);
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.list = list;
module.exports.restore = restore;
module.exports.show = show;
