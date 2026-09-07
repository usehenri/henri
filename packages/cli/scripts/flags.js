const { CliError } = require('./errors');
const { usage } = require('./help');
const { boot, validInstall } = require('./utils');

/**
 * `henri flags`: read and flip the feature flags of `config/flags.js`.
 *
 * Five subcommands and nothing else. There is deliberately no way to
 * *create* a flag from here: a flag is declared in `config/flags.js`, which
 * is a file in the repository somebody reviews, and a name nothing declares
 * is refused rather than written into the store where it would sit forever
 * doing nothing (see `packages/core/src/base/flags.js`).
 *
 * It boots to **runlevel 2**, not 4 like the rest. That is where
 * `henri.flags` is, and it is the point: the reason somebody reaches for a
 * kill switch is often that something else is broken, so turning a feature
 * off must not require the database to be up.
 *
 * @module flags
 */

/** The subcommands, and what `henri flags:nope` is measured against */
const COMMANDS = ['list', 'off', 'on', 'percentage', 'reset'];

/** How wide the name column is before it stops being a column */
const NAME_WIDTH = 24;

/**
 * Boots henri, does the work, and stops it whatever happened.
 *
 * @param {function} work what to do with the instance
 * @returns {Promise<*>} whatever the work answered
 */
const withHenri = async (work) => {
  // Runlevel 2: `henri.flags` is there, the models are not, and nothing is
  // listening. Flipping a switch must not need the database
  const henri = await boot({ runlevel: 2 });

  try {
    return await work(henri);
  } finally {
    await henri.stop();
  }
};

/**
 * The flag name a subcommand was given
 *
 * @param {object} args the parsed arguments
 * @returns {string} the name
 * @throws {CliError} USAGE when there is none
 */
const nameOf = (args) => {
  const [command, name] = args._;

  if (typeof name !== 'string' || name.trim() === '') {
    throw new CliError('USAGE', `henri flags:${command} needs a flag name`, {
      hint: `henri flags:${command} <name> -- run henri flags to see what this application declares`,
    });
  }

  return name.trim();
};

/**
 * Turns core's refusal of an undeclared name into a usage failure.
 *
 * The message is already the right one -- it names the closest declared
 * flag -- and only the exit code is wrong: a name that does not exist is
 * something the person typed, which is a `2`.
 *
 * @param {Error} error whatever was thrown
 * @returns {never} always throws
 * @throws {Error} the usage failure, or the original
 */
const rethrow = (error) => {
  if (error && error.code === 'HENRI_FLAGS_UNKNOWN') {
    throw new CliError('USAGE', error.message, {
      cause: error,
      hint: 'Declare it in config/flags.js, or run henri flags to see the names',
    });
  }

  throw error;
};

/**
 * How long ago something happened, in words
 *
 * @param {?number} at epoch milliseconds, or null
 * @returns {string} a short phrase, or a dash
 */
const since = (at) => {
  if (!at) {
    return '-';
  }

  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  const scales = [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
  ];

  for (const [unit, size] of scales) {
    if (seconds >= size) {
      return `${Math.floor(seconds / size)}${unit} ago`;
    }
  }

  return 'just now';
};

/**
 * What has been done to a flag, in one phrase
 *
 * @param {object} flag one entry of `henri.flags.list()`
 * @returns {string} the phrase
 */
const gates = (flag) => {
  const parts = [];

  if (flag.boolean === true) {
    parts.push('on for everyone');
  }

  if (flag.percentage > 0) {
    parts.push(`${flag.percentage}% of the actors`);
  }

  if (flag.actors.length > 0) {
    parts.push(
      `${flag.actors.length} named actor${flag.actors.length === 1 ? '' : 's'}`
    );
  }

  if (flag.boolean === false && parts.length === 0) {
    parts.push('off for everyone');
  }

  if (parts.length === 0) {
    parts.push(
      `never flipped (default ${flag.default ? 'on' : 'off'}${
        flag.group ? ', and a group' : ''
      })`
    );
  } else if (flag.group) {
    parts.push('a group');
  }

  return parts.join(', ');
};

/**
 * Every flag, what it is and what has been done to it
 *
 * @param {object} args the parsed arguments
 * @returns {Promise<object>} the result
 */
const list = async (args) =>
  withHenri(async (henri) => {
    await henri.flags.refresh();

    return {
      command: 'list',
      flags: await henri.flags.list(),
      ok: true,
      store: storeOf(henri),
      verbose: args.all === true,
    };
  });

/**
 * Where the state of this application's flags lives, in words
 *
 * @param {object} henri the booted instance
 * @returns {object} `{ name, where }`
 */
const storeOf = (henri) => {
  const { flags } = henri;

  if (!flags.store) {
    return {
      name: 'none',
      where:
        flags.settings && !flags.settings.enabled
          ? 'disabled'
          : 'nothing declared',
    };
  }

  return { name: flags.store.name, where: flags.store.describe() };
};

/**
 * Turns a flag on, for everyone or for one actor
 *
 * @param {object} args the parsed arguments
 * @returns {Promise<object>} the result
 */
const on = async (args) => {
  const name = nameOf(args);
  const [, , actor = null] = args._;

  return withHenri(async (henri) => {
    await henri.flags.refresh();
    await henri.flags.enable(name, actor).catch(rethrow);

    return { actor, command: 'on', flag: await one(henri, name), ok: true };
  });
};

/**
 * Turns a flag off, for everyone or for one actor
 *
 * @param {object} args the parsed arguments
 * @returns {Promise<object>} the result
 */
const off = async (args) => {
  const name = nameOf(args);
  const [, , actor = null] = args._;

  return withHenri(async (henri) => {
    await henri.flags.refresh();
    await henri.flags.disable(name, actor).catch(rethrow);

    return { actor, command: 'off', flag: await one(henri, name), ok: true };
  });
};

/**
 * Rolls a flag out to a share of the actors
 *
 * @param {object} args the parsed arguments
 * @returns {Promise<object>} the result
 * @throws {CliError} USAGE when the share is not a number from 0 to 100
 */
const percentage = async (args) => {
  const name = nameOf(args);
  const [, , percent] = args._;
  const share = Number(percent);

  if (!Number.isFinite(share) || share < 0 || share > 100) {
    throw new CliError(
      'USAGE',
      `henri flags:percentage needs a share from 0 to 100, not "${percent === undefined ? '' : percent}"`,
      {
        hint: 'henri flags:percentage checkout 25 -- and 0 clears the rollout without turning anything off',
      }
    );
  }

  return withHenri(async (henri) => {
    await henri.flags.refresh();
    await henri.flags.percentage(name, share).catch(rethrow);

    return {
      command: 'percentage',
      flag: await one(henri, name),
      ok: true,
      percentage: share,
    };
  });
};

/**
 * Forgets everything that was done to a flag
 *
 * @param {object} args the parsed arguments
 * @returns {Promise<object>} the result
 */
const reset = async (args) => {
  const name = nameOf(args);

  return withHenri(async (henri) => {
    await henri.flags.refresh();
    await henri.flags.reset(name).catch(rethrow);

    return { command: 'reset', flag: await one(henri, name), ok: true };
  });
};

/**
 * One flag, read back after the write
 *
 * @param {object} henri the booted instance
 * @param {string} name the flag name
 * @returns {Promise<object>} the entry
 */
const one = async (henri, name) =>
  (await henri.flags.list()).find((flag) => flag.name === name) || null;

/**
 * Prints the table
 *
 * @param {object} result what `list()` answered
 * @returns {void}
 */
const printList = (result) => {
  const { flags, store } = result;

  console.log('');

  if (flags.length === 0) {
    console.log('  This application declares no feature flags.');
    console.log('  Add config/flags.js: module.exports = { checkout: false };');
    console.log('');

    return;
  }

  console.log(
    `  ${flags.length} flag${flags.length === 1 ? '' : 's'}, in ${store.name} (${store.where})`
  );
  console.log('');

  for (const flag of flags) {
    console.log(
      `  ${flag.name.padEnd(NAME_WIDTH)} ${(flag.everyone ? 'on' : 'off').padEnd(4)} ${gates(flag).padEnd(38)} ${since(flag.at)}`
    );

    if (flag.description) {
      console.log(`  ${' '.repeat(NAME_WIDTH)}      ${flag.description}`);
    }

    if (result.verbose && flag.actors.length > 0) {
      for (const actor of flag.actors) {
        console.log(`  ${' '.repeat(NAME_WIDTH)}      ${actor}`);
      }
    }
  }

  console.log('');
  console.log(
    '  "on"/"off" is what somebody henri knows nothing about is answered.'
  );
  console.log('');
};

/**
 * Prints what one write did
 *
 * @param {object} result what a write answered
 * @returns {void}
 */
const printOne = (result) => {
  const { flag } = result;

  console.log('');
  console.log(`  ${flag.name}: ${gates(flag)}`);

  if (result.actor) {
    console.log(`  the actor is ${result.actor}`);
  }

  console.log('');
};

/**
 * The `henri flags` command
 *
 * @param {object} args The parsed arguments
 * @returns {Promise<void>} Exits the process
 * @throws {CliError} USAGE on an unknown subcommand
 */
const main = async (args) => {
  const [command = 'list'] = args._;

  if (!COMMANDS.includes(command)) {
    if (!args.json) {
      console.log(usage('flags'));
    }

    throw new CliError('USAGE', `Unknown flags command "${command}"`, {
      hint: `Available commands: ${COMMANDS.join(', ')}`,
    });
  }

  validInstall({ fatal: true });

  const log = console.log;

  // With --json stdout is the result only: the boot log goes to stderr
  if (args.json) {
    console.log = (...parts) => console.error(...parts);
  }

  const runners = { list, off, on, percentage, reset };
  let result;

  try {
    result = await runners[command](args);
  } finally {
    console.log = log;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.command === 'list') {
    printList(result);
  } else {
    printOne(result);
  }

  process.exit(result.ok ? 0 : 1);
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.gates = gates;
module.exports.list = list;
module.exports.off = off;
module.exports.on = on;
module.exports.percentage = percentage;
module.exports.reset = reset;
module.exports.since = since;
