/**
 * What henri is allowed to tell a person to do.
 *
 * Two bodies of text send people somewhere: `packages/core/error-codes.json`,
 * where every code says how to fix it, and `base/config-schema.js`, where
 * every key says what it accepts (`describe`) and what to do about it
 * (`hint`). Both name commands and configuration keys, and a name that is
 * wrong is worse than no instruction at all -- it sends a person down a path
 * that ends nowhere. The first pass found the catalogue telling people to run
 * `henri credentials:init`, a command henri has never had.
 *
 * So this holds the two checks, and the source that owns each answer is read
 * rather than copied: `packages/cli` for the commands (the top level from the
 * `commands` of its package.json, the subcommands from what a group's script
 * exports) and `base/config-schema.js` for the keys. A command that is
 * renamed or retired makes every text that still names it fail.
 *
 * `error-codes.spec.js` and `config-hints.spec.js` are the two callers. This
 * file is not a suite of its own: vitest collects `*.spec.js` and `*.test.js`,
 * so a helper next to them is a helper.
 *
 * The boundary of the command check, said out loud: a span is read as a
 * command when it carries a colon (`henri db:status`), when it sits inside
 * backticks, or when the word after `henri` is a command the CLI dispatches.
 * Everything else is prose -- "henri owns the table", "henri ships no SDK" --
 * because `henri` is the name of the framework as well as the name of the
 * binary, and no rule can tell a retired one-word command from a verb.
 */

const path = require('path');

const { SCHEMA } = require('../base/config-schema');

const CLI = path.resolve(__dirname, '..', '..', '..', 'cli');

/* --------------------------------------------------------------------- *
 * The commands a text is allowed to name.
 * --------------------------------------------------------------------- */

/** The top level commands, straight from the package that dispatches them */
const COMMANDS = require(path.join(CLI, 'package.json')).commands;

/** What a group's script exports, once per group */
const groups = new Map();

/**
 * The subcommands of a command, or null when it takes none
 *
 * @param {string} name a top level command
 * @returns {?Array<string>} the subcommands, or null
 */
function subcommandsOf(name) {
  if (!groups.has(name)) {
    const script = require(path.join(CLI, 'scripts', name));
    const named = script.generators || script.destroyers;
    const list = Array.isArray(script.COMMANDS)
      ? script.COMMANDS
      : named && Object.keys(named);

    groups.set(
      name,
      Array.isArray(list) && list.every((one) => typeof one === 'string')
        ? list
        : null
    );
  }

  return groups.get(name);
}

/**
 * What is wrong with a command line a text printed, if anything
 *
 * A span stops being read at the first thing that is not a name: a flag, a
 * placeholder, a redirection. `henri db:status --sql` is `db:status`, and
 * `henri versions <Model>` is `versions`.
 *
 * @param {string} line the command line, without its backticks
 * @returns {?string} what is wrong, or null when it is a real command
 */
function wrongCommand(line) {
  const [, first, second] = line.split(/\s+/u);
  const [name, ...rest] = String(first || '').split(':');

  if (!COMMANDS.includes(name)) {
    return `there is no \`henri ${name}\` command`;
  }

  const subcommands = subcommandsOf(name);

  if (rest.length > 0) {
    return subcommands && subcommands.includes(rest.join(':'))
      ? null
      : `\`henri ${name}\` has no "${rest.join(':')}" (it has ${
          subcommands ? subcommands.join(', ') : 'no subcommands'
        })`;
  }

  // `henri jobs list` is `henri jobs:list` written the other way; anything
  // that is not a bare name (a flag, `<who>`, `>`) ends the command
  if (!subcommands || !/^[a-z][a-z0-9:-]*$/u.test(second || '')) {
    return null;
  }

  return subcommands.includes(second)
    ? null
    : `\`henri ${name}\` has no "${second}" (it has ${subcommands.join(', ')})`;
}

/** Anything inside backticks */
const TICKED = /`([^`]+)`/gu;

/**
 * `henri` followed by a name, wherever it appears.
 *
 * A colon only belongs to the name when a name follows it, so the sentence
 * "The document henri fills: ..." is prose and `henri db:status` is not.
 */
const INVOKED = /(?<![\w`.])henri\s+([a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)*)/gu;

/**
 * The command lines a text names
 *
 * A backticked span that starts with `henri ` is one whatever it holds, and
 * everything in it is read: `henri jobs list` is `henri jobs:list` written
 * the other way. A bare one is only ever the name -- it is read as a command
 * when it carries a colon or when the word is one the CLI dispatches, and
 * what follows it in the sentence is prose ("Let henri generate the secret").
 *
 * @param {string} text the text
 * @returns {Array<string>} the command lines, backticks stripped
 */
function commandLines(text) {
  const found = [];

  for (const match of text.matchAll(TICKED)) {
    /^henri\s/u.test(match[1]) && found.push(match[1]);
  }

  for (const match of text.matchAll(INVOKED)) {
    const [name] = match[1].split(':');

    if (match[1].includes(':') || COMMANDS.includes(name)) {
      found.push(`henri ${match[1]}`);
    }
  }

  return [...new Set(found)];
}

/* --------------------------------------------------------------------- *
 * The configuration keys a text is allowed to name: the ones
 * `base/config-schema.js` declares, and only those.
 * --------------------------------------------------------------------- */

/** The top level keys, which is what says a dotted name is a config key */
const TOP = new Set(Object.keys(SCHEMA));

/**
 * Does the schema declare this key?
 *
 * A record's key is whatever an application named it (`stores.default.url`),
 * and everything under a node that forwards what it does not know
 * (`unknown: 'allow'`: helmet's options, cors', a nodemailer transport) is
 * that library's to declare rather than henri's -- so the walk stops there
 * and says yes.
 *
 * @param {string} key a dotted key, without the `config.` prefix
 * @param {object} [schema=SCHEMA] the schema
 * @returns {boolean} true when it is declared
 */
function declares(key, schema = SCHEMA) {
  const walk = (nodes, parts, depth) => {
    if (parts.length === 0) {
      return true;
    }

    if (depth > 12) {
      return false;
    }

    const [head, ...tail] = parts;
    const branches = nodes.flatMap((node) => node.oneOf || [node]);

    return branches.some((node) => {
      if (node.keys && node.keys[head]) {
        return walk([node.keys[head]], tail, depth + 1);
      }

      if (node.values) {
        return walk([node.values], tail, depth + 1);
      }

      // A node that forwards what it does not know owns nothing below it
      return node.type === 'any' || (node.type === 'object' && !node.keys);
    });
  };

  const parts = key.split('.');

  return (
    TOP.has(parts[0]) && walk([{ keys: schema, type: 'object' }], parts, 0)
  );
}

/** `config.<key>`, unless it is a call (`config.get(...)`) */
const EXPLICIT = /(?<![\w.])config\.([a-z]\w*(?:\.\w+)*)/gu;

/** A dotted name, the shape a configuration key is written in */
const DOTTED = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+$/u;

/**
 * The configuration keys a text names
 *
 * Two shapes: `config.<key>` anywhere, and a dotted name inside backticks
 * whose first segment is a key henri owns (`jobs.store`), which is how the
 * text writes them when the sentence already said "configuration".
 *
 * @param {string} text the text
 * @returns {Array<string>} the keys, without the `config.` prefix
 */
function keysNamed(text) {
  const found = [];

  for (const match of text.matchAll(EXPLICIT)) {
    if (text[match.index + match[0].length] !== '(') {
      found.push(match[1]);
    }
  }

  for (const match of text.matchAll(TICKED)) {
    const span = match[1].replace(/^config\./u, '');

    if (DOTTED.test(span) && TOP.has(span.split('.')[0])) {
      found.push(span);
    }
  }

  return [...new Set(found)];
}

/* --------------------------------------------------------------------- *
 * Whether one sentence says something the other did not.
 * --------------------------------------------------------------------- */

/** Words that carry no meaning when two sentences are compared */
const STOP = new Set(
  (
    'a an the and or of to it is was be been are for in on at that this which ' +
    'who with what not no nor but so as by from into its their there here ' +
    'they them he she'
  ).split(' ')
);

/**
 * The content words of a sentence
 *
 * @param {string} text the sentence
 * @returns {Set<string>} the words
 */
const words = (text) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/gu, ' ')
      .split(/\s+/u)
      .filter((word) => word.length > 2 && !STOP.has(word))
  );

/**
 * How much two sentences say the same thing (0 nothing, 1 everything)
 *
 * @param {string} one the first
 * @param {string} two the second
 * @returns {number} the Jaccard similarity of their content words
 */
function overlap(one, two) {
  const left = words(one);
  const right = words(two);
  const shared = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;

  return union === 0 ? 1 : shared / union;
}

module.exports = {
  COMMANDS,
  TICKED,
  TOP,
  commandLines,
  declares,
  keysNamed,
  overlap,
  subcommandsOf,
  words,
  wrongCommand,
};
