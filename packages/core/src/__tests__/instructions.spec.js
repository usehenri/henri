/**
 * Everything henri tells a person to do next reads like an instruction.
 *
 * `error-codes.spec.js` holds the catalogue to this bar; these are the other
 * two bodies of text, checked by the same readers
 * (`__tests__/instructions.js`):
 *
 * - `base/config-schema.js`, where a wrong value in `config/<env>.json` --
 *   the failure people hit first, often before the application has ever run
 *   -- reaches the terminal as a `describe` saying what the value must be
 *   and a `hint` saying what to do about it;
 * - the `hint` of every failure `packages/cli` raises, read out of the
 *   source the way this repository already reads the codes.
 *
 * What it enforces, and why each rule is here:
 *
 * - every `henri <command>` a hint or a `describe` names is a command the
 *   CLI dispatches, read out of `packages/cli` rather than copied;
 * - every `config.<key>` one names is a key the schema declares, read out of
 *   the schema itself;
 * - every `@usehenri/<package>` one names is a package of this workspace and
 *   every `base/<file>.js` one names is a file of this package, because a
 *   pointer at something that moved is the same failure as a retired
 *   command;
 * - a hint that only restates its `describe` is not a hint.
 *
 * The nodes that deliberately have no hint are named in `SILENT`, with the
 * reason: a `describe` that leaves nothing to say is better left alone than
 * padded with "set this to a valid value".
 */

const fs = require('fs');
const path = require('path');

const {
  commandLines,
  declares,
  keysNamed,
  overlap,
  wrongCommand,
} = require('./instructions');

const { SCHEMA } = require('../base/config-schema');
const { describe: expectationOf } = require('../base/config-validate');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PACKAGES = path.join(ROOT, 'packages');
const BASE = path.resolve(__dirname, '..', 'base');
const SCRIPTS = path.join(PACKAGES, 'cli', 'scripts');

/**
 * Every node of the schema, with the path it sits at.
 *
 * A branch of a union is `key|0`, an item of a list `key[]` and the value of
 * a record `key.*`, so a node that is only reachable through one of the
 * three still has a name a failure can be traced back to.
 *
 * @param {object} node a schema node
 * @param {string} at the path so far
 * @param {Array<object>} [found=[]] what has been found so far
 * @returns {Array<object>} `{ at, node }` entries
 */
function nodes(node, at, found = []) {
  if (!node || typeof node !== 'object') {
    return found;
  }

  found.push({ at, node });

  (node.oneOf || []).forEach((branch, index) =>
    nodes(branch, `${at}|${index}`, found)
  );

  for (const [key, child] of Object.entries(node.keys || {})) {
    nodes(child, at ? `${at}.${key}` : key, found);
  }

  node.values && nodes(node.values, `${at}.*`, found);
  node.of && nodes(node.of, `${at}[]`, found);

  return found;
}

/** Every node of the schema */
const ALL = Object.entries(SCHEMA).flatMap(([key, node]) => nodes(node, key));

/**
 * The nodes a person can be sent to directly: a declared key, or the value
 * of a record. A branch of a union inherits the union's hint and an item of
 * a list its list's (`config-validate.js`), so neither needs one of its own
 * -- which is what the last segment of the path says.
 */
const NAMED = ALL.filter(({ at }) => {
  const last = at.split('.').pop();

  return !/\|\d+$/u.test(last) && !last.endsWith('[]');
});

/**
 * Every text of the schema, with the node it belongs to: an instruction is
 * an instruction wherever it was written down.
 */
const TEXTS = ALL.flatMap(({ at, node }) =>
  [
    ['hint', node.hint],
    ['describe', node.describe],
  ]
    .filter(([, text]) => typeof text === 'string')
    .map(([field, text]) => [`${at}.${field}`, text])
);

/**
 * The keys whose `describe` says everything there is to say, so a hint would
 * only be a longer way of reading it again. Adding one is a decision: the
 * reason goes next to it.
 */
const SILENT = new Map([
  [
    'user|1.confirmation|1.after',
    'a path to land on is a path to land on; the flow has no other setting to point at',
  ],
  [
    'user|1.identities|1.after',
    'the same, and the sign-in half of the flow lands on user.afterLogin, which is its own key',
  ],
]);

/** A package of the workspace, as `@usehenri/<name>` */
const workspace = new Set(
  fs
    .readdirSync(PACKAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `@usehenri/${entry.name}`)
);

describe('the configuration schema reads like an instruction', () => {
  test('every command it names is a real one', () => {
    const wrong = [];

    for (const [where, text] of TEXTS) {
      for (const line of commandLines(text)) {
        const problem = wrongCommand(line);

        problem && wrong.push(`${where}: ${problem}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test('every configuration key it names is one henri declares', () => {
    const wrong = [];

    for (const [where, text] of TEXTS) {
      for (const key of keysNamed(text)) {
        declares(key) || wrong.push(`${where}: config.${key} is not a key`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test('every package and source file it names is there', () => {
    const wrong = [];

    for (const [where, text] of TEXTS) {
      for (const match of text.matchAll(/@usehenri\/[a-z0-9-]+/gu)) {
        workspace.has(match[0]) ||
          wrong.push(`${where}: there is no ${match[0]} package`);
      }

      for (const match of text.matchAll(/base\/[a-z-]+\.js/gu)) {
        fs.existsSync(path.join(BASE, path.basename(match[0]))) ||
          wrong.push(`${where}: there is no ${match[0]}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test('a hint says something the expectation did not', () => {
    const restated = [];

    for (const { at, node } of ALL) {
      if (!node.hint) {
        continue;
      }

      expect(typeof node.hint).toBe('string');
      expect(node.hint.trim().length).toBeGreaterThan(15);

      const said = expectationOf(node);
      const one = node.hint.toLowerCase().replace(/[^a-z0-9]/gu, '');
      const two = said.toLowerCase().replace(/[^a-z0-9]/gu, '');

      // Quoting the expectation only means restating it when there is
      // something to restate: "a string" is inside half the sentences in
      // English, and a hint that says "a value is a string, appended to the
      // url as it is" is doing its job
      if (
        one === two ||
        (two.length > 24 && one.includes(two)) ||
        overlap(node.hint, said) > 0.5
      ) {
        restated.push(at);
      }
    }

    expect(restated).toEqual([]);
  });

  test('every key a person can be sent to says what to do about it', () => {
    const silent = NAMED.filter(({ node }) => !node.hint).map(({ at }) => at);

    expect(silent).toEqual([...SILENT.keys()]);

    for (const reason of SILENT.values()) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  test('SILENT names nodes the schema still has', () => {
    const known = new Set(ALL.map(({ at }) => at));

    for (const at of SILENT.keys()) {
      expect(known.has(at)).toBe(true);
    }
  });
});

/**
 * Every `hint` the command line ships, read out of the source.
 *
 * A `CliError` builds its hint at the call site, often out of a template, so
 * there is nothing to import: the literal is what can be checked, the way
 * `error-codes.spec.js` reads the codes out of the source rather than out of
 * a running process. An interpolation ends the span it sits in, so
 * `henri flags:${command}` is read as `henri flags` and passes -- the rule
 * is only ever stricter about what is written down whole.
 */
const CLI_HINTS = fs
  .readdirSync(SCRIPTS)
  .filter((name) => name.endsWith('.js'))
  .flatMap((name) => {
    const src = fs.readFileSync(path.join(SCRIPTS, name), 'utf8');

    return [
      ...src.matchAll(
        /\bhint:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/gu
      ),
    ].map((match) => [
      `${name}:${src.slice(0, match.index).split('\n').length}`,
      match[1] || match[2] || match[3] || '',
    ]);
  });

describe('the hints of the command line', () => {
  test('there are hints to read', () => {
    expect(CLI_HINTS.length).toBeGreaterThan(100);
  });

  test('every command they name is a real one', () => {
    const wrong = [];

    for (const [where, text] of CLI_HINTS) {
      for (const line of commandLines(text)) {
        const problem = wrongCommand(line);

        problem && wrong.push(`${where}: ${problem}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test('every configuration key they name is one henri declares', () => {
    const wrong = [];

    for (const [where, text] of CLI_HINTS) {
      for (const key of keysNamed(text)) {
        declares(key) || wrong.push(`${where}: config.${key} is not a key`);
      }
    }

    expect(wrong).toEqual([]);
  });
});

describe('the readers of instructions.js', () => {
  test('they would catch a command or a key that is not there', () => {
    expect(wrongCommand('henri nope')).toMatch(/no `henri nope` command/u);
    expect(wrongCommand('henri db:nope')).toMatch(/has no "nope"/u);
    expect(wrongCommand('henri jobs nope')).toMatch(/has no "nope"/u);
    expect(wrongCommand('henri db:status --sql')).toBeNull();
    expect(wrongCommand('henri versions <Model> <record>')).toBeNull();
    expect(wrongCommand('henri openapi > openapi.json')).toBeNull();
    expect(wrongCommand('henri generate policy <Model>')).toBeNull();
    expect(wrongCommand('henri destroy model Thing')).toBeNull();
    expect(wrongCommand('henri destroy nope Thing')).toMatch(/has no "nope"/u);

    expect(keysNamed('`jobs.nope` and `config.jobs.store`')).toEqual([
      'jobs.store',
      'jobs.nope',
    ]);
    expect(keysNamed('`config.jobs.store` twice: config.jobs.store')).toEqual([
      'jobs.store',
    ]);
    expect(declares('jobs.nope')).toBe(false);
    expect(declares('stores.default.url')).toBe(true);
    expect(keysNamed('`henri.model.errors()` and config.get(key)')).toEqual([]);
  });

  test('a command is read out of a bare sentence, and prose is not', () => {
    // The retired command of the first pass, written the way a hint writes it
    expect(commandLines('Run henri credentials:init first')).toEqual([
      'henri credentials:init',
    ]);
    expect(wrongCommand('henri credentials:init')).toMatch(/has no "init"/u);

    expect(
      commandLines('`henri jobs list` and henri audit reports it')
    ).toEqual(['henri jobs list', 'henri audit']);

    // `henri` is the name of the framework as well as the binary
    expect(commandLines('henri owns the table and ships no SDK')).toEqual([]);
    expect(commandLines('Let henri generate the secret')).toEqual([
      'henri generate',
    ]);
  });

  test('a key under a node that forwards what it does not know is declared', () => {
    // Helmet's own options, cors', a nodemailer transport: henri validates
    // the block and declares nothing inside it
    expect(declares('helmet.contentSecurityPolicy')).toBe(true);
    expect(declares('stores.default.opts.autoIndex')).toBe(true);
    // ... but a store still refuses a misspelling of a key henri owns
    expect(declares('stores.default.adaptor')).toBe(false);
    expect(declares('nope.at.all')).toBe(false);
  });
});
