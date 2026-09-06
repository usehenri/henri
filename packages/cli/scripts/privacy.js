const fs = require('fs');
const path = require('path');

const { CliError } = require('./errors');
const { usage } = require('./help');
const { boot, validInstall } = require('./utils');

/**
 * `henri privacy`: the personal data of an application, and the two
 * operations a person may ask for.
 *
 * - `henri privacy` prints the map: which fields of which models are
 *   personal, which of them never leave the server, how each model reaches
 *   the person and what an erasure would do to it. It is how the mark is
 *   checked, the way `henri routes` is how the routes are checked.
 * - `henri privacy:export <who>` writes everything the application holds
 *   about one person.
 * - `henri privacy:erase <who>` removes them, and leaves a receipt.
 *
 * All three boot to the user module (runlevel 4, like `henri db:seed`): no
 * port is bound and no route is registered. The work itself is
 * `henri.privacy`
 * (`core/src/3.privacy.js`), so an application can put the same two
 * operations behind a page of its own.
 */

const COMMANDS = ['erase', 'export', 'map'];

/**
 * Runs one operation against a booted application and stops it again
 *
 * @param {function} work `(henri) => result`
 * @returns {Promise<*>} What the work resolved with
 */
const withHenri = async (work) => {
  // Runlevel 4, like `henri db:seed` and `henri jobs`: no port is bound and
  // no route is registered, and the user module is there because writing
  // over a password goes through the same hooks a sign-up does
  const henri = await boot({ runlevel: 4 });

  try {
    return await work(henri);
  } finally {
    await henri.stop();
  }
};

/**
 * The person named on the command line
 *
 * @param {object} args CLI arguments
 * @param {string} command The command, for the message
 * @returns {string} The email, external id or id
 * @throws {CliError} USAGE when nobody was named
 */
const who = (args, command) => {
  const [, subject] = args._;

  if (typeof subject !== 'string' || subject.trim() === '') {
    throw new CliError('USAGE', `henri privacy:${command} needs a person`, {
      hint: `henri privacy:${command} someone@example.com (an external id or an id work too)`,
    });
  }

  return subject.trim();
};

/**
 * The map of what is personal
 *
 * @returns {Promise<object>} The result
 */
const map = async () => {
  const described = await withHenri((henri) => henri.privacy.describe());

  return { command: 'map', ok: true, ...described };
};

/**
 * Everything the application holds about one person
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result, with the document
 * @throws {CliError} FAILED when the file cannot be written
 */
const exportOne = async (args) => {
  const subject = who(args, 'export');
  const document = await withHenri((henri) => henri.privacy.export(subject));
  const file = typeof args.out === 'string' ? args.out : null;

  if (file) {
    const target = path.resolve(process.cwd(), file);

    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
    } catch (error) {
      throw new CliError(
        'FAILED',
        `unable to write ${file}: ${error.message}`,
        {
          cause: error,
          hint: 'Point --out at a path this process may write',
        }
      );
    }
  }

  return { command: 'export', document, file, ok: true };
};

/**
 * Asks before erasing, unless the command line already answered
 *
 * @param {object} args CLI arguments
 * @param {object} plan What the erasure would do
 * @param {string} subject The person named on the command line
 * @returns {Promise<boolean>} true when it may go ahead
 * @throws {CliError} NEEDS_TTY when a prompt is needed without a terminal
 */
const confirmed = async (args, plan, subject) => {
  if (args.yes === true || args.force === true) {
    return true;
  }

  const touched = plan.steps.reduce((total, step) => total + step.count, 0);

  if (!process.stdin.isTTY) {
    throw new CliError(
      'NEEDS_TTY',
      'henri privacy:erase needs a terminal to confirm, and stdin is not one',
      {
        hint: `Run it again with --yes, or with --dry-run to see what it would do to ${touched} record(s)`,
      }
    );
  }

  const { confirm } = require('@inquirer/prompts');

  try {
    return await confirm({
      default: false,
      message: `Erase ${subject} and ${touched} record(s)? This cannot be undone`,
    });
  } catch (error) {
    throw new CliError('FAILED', error.message, { cause: error });
  }
};

/**
 * Erases one person
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result, with the plan and the receipt
 * @throws {CliError} USAGE on an unknown strategy
 */
const erase = async (args) => {
  const subject = who(args, 'erase');
  const strategy =
    typeof args.strategy === 'string' ? args.strategy : undefined;
  const dryRun = args['dry-run'] === true;

  return withHenri(async (henri) => {
    const plan = await henri.privacy.plan(subject, { strategy });

    if (dryRun) {
      return { command: 'erase', dryRun, ok: true, plan, receipt: null };
    }

    if (!(await confirmed(args, plan, subject))) {
      return {
        command: 'erase',
        dryRun,
        ok: false,
        plan,
        reason: 'refused at the prompt',
        receipt: null,
      };
    }

    const receipt = await henri.privacy.erase(subject, { strategy });

    return { command: 'erase', dryRun, ok: true, plan, receipt };
  });
};

/**
 * How a model reaches the person, in words
 *
 * @param {object} model One entry of the map
 * @param {?string} subject The name of the subject model
 * @returns {string} The description
 */
const relation = (model, subject) => {
  if (model.subject) {
    return 'the person';
  }

  return model.link
    ? `${model.link.field} -> ${subject}`
    : 'no link to the person';
};

/**
 * Prints the map of what is personal
 *
 * @param {object} result What map() answered
 * @returns {void}
 */
const printMap = (result) => {
  console.log('');

  if (result.models.length === 0) {
    console.log('  No model marks a field personal.');
    console.log('');
    console.log('  A field says it in the schema, next to its type:');
    console.log("    name: { personal: true, type: 'string' }");
    console.log('');
    console.log('  https://usehenri.io/guides/privacy/');
    console.log('');

    return;
  }

  console.log(
    `  The person is ${result.subject || 'nobody: this application has no user model'}`
  );
  console.log('');

  for (const model of result.models) {
    console.log(`  ${model.model} (${relation(model, result.subject)})`);

    for (const field of model.fields) {
      const notes = [
        `erase: ${field.erase}`,
        field.expose ? null : 'never leaves the server',
        field.export ? null : 'not exported',
      ].filter(Boolean);

      console.log(`    ${field.name.padEnd(20)} ${notes.join(', ')}`);
    }

    if (!model.subject) {
      console.log(
        `    ${'(records)'.padEnd(20)} onErase: ${model.onErase}${
          model.exported ? '' : ', not exported'
        }`
      );
    }

    console.log('');
  }

  console.log(
    `  Masked in the logs: ${result.models
      .flatMap((model) => model.fields.map((field) => field.name))
      .filter((name, index, all) => all.indexOf(name) === index)
      .sort()
      .join(', ')}`
  );

  if (result.private.length > 0) {
    console.log(`  Never in an answer: ${result.private.join(', ')}`);
  }

  console.log('');
  console.log('  https://usehenri.io/guides/privacy/');
  console.log('');
};

/**
 * Prints an export for a person to read
 *
 * @param {object} result What exportOne() answered
 * @returns {void}
 */
const printExport = ({ document, file }) => {
  console.log('');
  console.log(
    `  Everything held about ${document.subject.email || document.subject.externalId || 'this person'}`
  );
  console.log(`  Generated ${document.generatedAt}`);
  console.log('');

  for (const model of Object.keys(document.records)) {
    const records = document.records[model];

    console.log(`  ${model} (${records.length})`);

    for (const record of records) {
      console.log('');

      for (const field of Object.keys(record).sort()) {
        const value = record[field];

        console.log(
          `    ${field.padEnd(18)} ${
            value === null || typeof value === 'undefined'
              ? ''
              : String(
                  typeof value === 'object' ? JSON.stringify(value) : value
                ).slice(0, 120)
          }`
        );
      }
    }

    console.log('');
  }

  if (document.unlinked.length > 0) {
    console.log(
      `  Holding personal data with no link to this person: ${document.unlinked.join(', ')}`
    );
    console.log('');
  }

  if (file) {
    console.log(`  Written to ${file}`);
    console.log('');
  }
};

/**
 * Prints one line of a plan or a receipt
 *
 * @param {object} step A step of the plan, or a record of the receipt
 * @returns {void}
 */
const printStep = (step) => {
  const fields = (step.fields || Object.keys(step.values || {})).sort();

  console.log(
    `    ${step.model.padEnd(16)} ${step.action.padEnd(10)} ${String(
      step.count
    ).padStart(
      5
    )} record(s)${fields.length > 0 ? `  ${fields.join(', ')}` : ''}`
  );
};

/**
 * Prints what an erasure did, or would do
 *
 * @param {object} result What erase() answered
 * @returns {void}
 */
const printErase = ({ dryRun, ok, plan, reason, receipt }) => {
  console.log('');

  if (!ok) {
    console.log(`  Nothing was erased: ${reason}`);
    console.log('');

    return;
  }

  console.log(dryRun ? '  This erasure would:' : '  Erased:');

  for (const step of receipt ? receipt.records : plan.steps) {
    printStep(step);
  }

  for (const model of plan.unlinked) {
    console.log(
      `    ${model.model.padEnd(16)} ${'unlinked'.padEnd(10)}       ${model.reason}: ${model.fields.join(', ')} left alone`
    );
  }

  console.log('');

  if (receipt) {
    console.log(`  Receipt ${receipt.id}`);
    console.log(`  Digest  ${receipt.subject.digest.slice(0, 32)}...`);

    if (receipt.file) {
      console.log(`  Written to ${receipt.file}`);
    } else {
      console.log(
        '  Not written: config.privacy.receipts is false, keep what is above'
      );
    }
  } else {
    console.log('  Nothing was written: --dry-run');
  }

  console.log('');
};

/**
 * Runs `henri privacy [map|export|erase]` (`henri privacy:<command>` too)
 *
 * @param {object} args CLI arguments
 * @returns {Promise<void>} Resolves when done
 * @throws {CliError} USAGE on an unknown command, NOT_A_PROJECT elsewhere
 */
const main = async (args) => {
  const [command = 'map'] = args._;

  if (!COMMANDS.includes(command)) {
    if (!args.json) {
      console.log(usage('privacy'));
    }

    throw new CliError('USAGE', `Unknown privacy command "${command}"`, {
      hint: `Available commands: ${COMMANDS.join(', ')}`,
    });
  }

  validInstall({ fatal: true });

  const log = console.log;

  // With --json stdout is the result only: the boot log goes to stderr
  if (args.json) {
    console.log = (...parts) => console.error(...parts);
  }

  let result;

  try {
    if (command === 'export') {
      result = await exportOne(args);
    } else if (command === 'erase') {
      result = await erase(args);
    } else {
      result = await map();
    }
  } finally {
    console.log = log;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.command === 'export') {
    printExport(result);
  } else if (result.command === 'erase') {
    printErase(result);
  } else {
    printMap(result);
  }

  // The drivers are closed by henri.stop(); leave nothing behind
  process.exit(0);
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.erase = erase;
module.exports.exportOne = exportOne;
module.exports.map = map;
