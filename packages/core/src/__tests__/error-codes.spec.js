const fs = require('fs');
const path = require('path');

const {
  AREAS,
  CODES,
  PATTERN,
  catalogue,
  coded,
  entry,
  exitOf,
  fail,
  fallback,
  isCode,
  stamp,
  url,
} = require('../base/errors');

const {
  commandLines,
  declares,
  keysNamed,
  overlap,
  wrongCommand,
} = require('./instructions');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PACKAGES = path.join(ROOT, 'packages');
const PAGE = path.join(
  ROOT,
  'website',
  'src',
  'content',
  'docs',
  'reference',
  'errors.md'
);

/**
 * Directories that hold no framework source: an application, the tests
 * themselves (a code has to be raised by the code that fails, not asserted
 * into existence), the scaffold templates and everything generated.
 */
const SKIPPED = new Set([
  '.henri',
  '.next',
  'coverage',
  'demo',
  'dist',
  'node_modules',
  '__tests__',
  'template',
]);

/** The files a code can be raised from */
const SOURCE = /\.(?:js|cjs|mjs)$/u;

/**
 * Anything shaped like a code: `HENRI_` and at least two segments. Loose on
 * purpose, so a code with a misspelled area is caught rather than skipped.
 */
const SHAPED =
  /(?<![A-Za-z0-9_])HENRI_[A-Z0-9]+(?:_[A-Z0-9]+)+(?![A-Za-z0-9_])/gu;

/**
 * The environment variables henri reads whose names look like a code. They
 * are the only `HENRI_*_*` strings in the source that name something else;
 * a new one goes here, and a name that would read as a code does not.
 */
const ENVIRONMENT = new Set([
  'HENRI_ASSET_PREFIX',
  'HENRI_CONFIG_JSON',
  'HENRI_CREDENTIALS_KEY',
  'HENRI_ENCRYPTION_KEYS',
  'HENRI_JOBS_REPORT',
  'HENRI_MCP_AUTOSTART',
  'HENRI_PASSWORD_PEPPER',
  'HENRI_SEED_REPORT',
  'HENRI_SKIP_SYNC',
  'HENRI_TEST_DOTENV',
  'HENRI_TEST_MYSQL_URL',
  'HENRI_TEST_POSTGRES_URL',
  'HENRI_TEST_QUOTED',
  'HENRI_TEST_REPORT',
  'HENRI_TEST_SQL_DIALECT',
  'HENRI_TEST_URL',
]);

/**
 * Every source file of the packages, the tests and the templates aside
 *
 * @param {string} dir where to look
 * @param {Array<string>} [found=[]] what has been found so far
 * @returns {Array<string>} the paths
 */
function sources(dir, found = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(item.name) || item.name.startsWith('.')) {
      continue;
    }

    const full = path.join(dir, item.name);

    if (item.isDirectory()) {
      sources(full, found);
    } else if (SOURCE.test(item.name)) {
      found.push(full);
    }
  }

  return found;
}

/** Every code-shaped string of the source, with the files it appears in */
const raised = new Map();

for (const file of sources(PACKAGES)) {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(SHAPED)) {
    const list = raised.get(match[0]) || [];

    list.push(path.relative(ROOT, file));
    raised.set(match[0], list);
  }
}

/** The codes the documentation page lists, in the order it lists them */
const documented = () =>
  [
    ...fs.readFileSync(PAGE, 'utf8').matchAll(/^### `(HENRI_[A-Z0-9_]+)`$/gmu),
  ].map((match) => match[1]);

/**
 * Every text of an entry, with the field it came from: an instruction is
 * an instruction wherever it was written down.
 *
 * @param {object} code a catalogue entry
 * @returns {Array<Array<string>>} `[field, text]` pairs
 */
const texts = (code) => [
  ['what', code.what],
  ['fix', code.fix],
  ...code.causes.map((cause) => ['causes', cause]),
];

describe('the error code catalogue', () => {
  test('every entry is complete, unique and shaped like a code', () => {
    const names = catalogue.codes.map((code) => code.code);

    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThan(0);

    for (const code of catalogue.codes) {
      expect(code.code).toMatch(PATTERN);
      expect(AREAS).toContain(code.area);
      expect(code.code.startsWith(`HENRI_${code.area.toUpperCase()}_`)).toBe(
        true
      );
      expect(typeof code.what).toBe('string');
      expect(code.what.length).toBeGreaterThan(10);
      expect(typeof code.fix).toBe('string');
      expect(code.fix.length).toBeGreaterThan(10);
      expect(Array.isArray(code.causes)).toBe(true);
      expect(code.causes.length).toBeGreaterThan(0);
      expect(code.causes.every((cause) => cause.length > 5)).toBe(true);
      expect([undefined, 1, 2, 3, 4]).toContain(code.exit);
    }
  });

  test('no two codes mean the same thing', () => {
    const meanings = catalogue.codes.map((code) => code.what.toLowerCase());

    expect(new Set(meanings).size).toBe(meanings.length);
  });

  test('the areas are declared once, sorted, and all of them are used', () => {
    const names = catalogue.areas.map((area) => area.area);

    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => /^[a-z]+$/u.test(name))).toBe(true);

    for (const area of catalogue.areas) {
      expect(area.what.length).toBeGreaterThan(10);
      expect(catalogue.codes.some((code) => code.area === area.area)).toBe(
        true
      );
    }
  });
});

describe('the catalogue and the source', () => {
  test('every code the source raises has an entry', () => {
    const unknown = [...raised.entries()]
      .filter(([name]) => !isCode(name) && !ENVIRONMENT.has(name))
      .map(([name, files]) => `${name} (${files[0]})`);

    expect(unknown).toEqual([]);
  });

  test('every entry is raised somewhere', () => {
    const never = catalogue.codes
      .map((code) => code.code)
      .filter((name) => !raised.has(name));

    expect(never).toEqual([]);
  });

  test('the environment variables are not codes, and still exist', () => {
    for (const name of ENVIRONMENT) {
      expect(isCode(name)).toBe(false);
    }
  });
});

/**
 * Every entry says what to do next, and everything it names exists.
 *
 * A "how to fix it" that names a command henri does not have, or a
 * configuration key it does not own, is worse than no instruction at all:
 * it sends a person down a path that ends nowhere. So the two kinds of
 * thing a fix points at are checked against the source that owns them --
 * `packages/cli` for the commands, `base/config-schema.js` for the keys --
 * rather than against a copy kept here. Both readers live in
 * `__tests__/instructions.js`, which `config-hints.spec.js` runs over the
 * configuration schema's own text.
 */
describe('the catalogue reads like an instruction', () => {
  test('every command it names is a real one', () => {
    const wrong = [];

    for (const code of catalogue.codes) {
      for (const [field, text] of texts(code)) {
        for (const line of commandLines(text)) {
          const problem = wrongCommand(line);

          problem && wrong.push(`${code.code}.${field}: ${problem}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test('every configuration key it names is one henri declares', () => {
    const wrong = [];

    for (const code of catalogue.codes) {
      for (const [field, text] of texts(code)) {
        for (const key of keysNamed(text)) {
          declares(key) ||
            wrong.push(
              `${code.code}.${field}: config.${key} is not in the schema`
            );
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test('every fix says something the meaning did not', () => {
    const restated = [];

    for (const code of catalogue.codes) {
      expect(typeof code.fix).toBe('string');
      expect(code.fix.trim().length).toBeGreaterThan(19);

      const one = code.fix.toLowerCase().replace(/[^a-z0-9]/gu, '');
      const two = code.what.toLowerCase().replace(/[^a-z0-9]/gu, '');

      if (
        one === two ||
        one.includes(two) ||
        overlap(code.fix, code.what) > 0.5
      ) {
        restated.push(code.code);
      }
    }

    expect(restated).toEqual([]);
  });

  test('a fix that only restates the meaning is caught', () => {
    expect(
      overlap('The store was not reached.', 'The store, not reached.')
    ).toBe(1);
    expect(
      overlap(
        'A model has no store and there is no default one.',
        'Configure `stores.default`, or give the model a `store`.'
      )
    ).toBeLessThan(0.5);
  });
});

describe('the catalogue and the documentation', () => {
  test('the reference page lists every code, and only those', () => {
    expect(documented()).toEqual(catalogue.codes.map((code) => code.code));
  });

  test('the reference page names every area', () => {
    const page = fs.readFileSync(PAGE, 'utf8');

    for (const area of catalogue.areas) {
      expect(page).toContain(`## ${area.area}`);
    }
  });
});

describe('base/errors', () => {
  test('isCode and entry only know the catalogue', () => {
    expect(isCode('HENRI_MODEL_UNKNOWN_TYPE')).toBe(true);
    expect(isCode('HENRI_MODEL_NOPE')).toBe(false);
    expect(isCode('ENOENT')).toBe(false);
    expect(isCode(42)).toBe(false);
    expect(entry('HENRI_MODEL_UNKNOWN_TYPE')).toBe(
      CODES.HENRI_MODEL_UNKNOWN_TYPE
    );
    expect(entry('nope')).toBeNull();
  });

  test('stamp puts the code on an error, and never overwrites one', () => {
    const error = stamp(new Error('boom'), 'HENRI_MODEL_UNKNOWN_TYPE');

    expect(error.code).toBe('HENRI_MODEL_UNKNOWN_TYPE');
    expect(stamp(error, 'HENRI_MODEL_NO_STORE').code).toBe(
      'HENRI_MODEL_UNKNOWN_TYPE'
    );
  });

  test('an error with a code of its own keeps it', () => {
    const error = Object.assign(new Error('nope'), { code: 'ENOENT' });

    stamp(error, 'HENRI_CONFIG_UNREADABLE');

    expect(error.code).toBe('ENOENT');
    expect(error.henriCode).toBe('HENRI_CONFIG_UNREADABLE');
    expect(coded(error)).toBe('HENRI_CONFIG_UNREADABLE');
  });

  test('stamp refuses a code the catalogue does not hold', () => {
    expect(() => stamp(new Error('boom'), 'HENRI_MODEL_NOPE')).toThrow(
      /not a henri error code/u
    );
  });

  test('coded walks the cause chain and survives a cycle', () => {
    const inner = fail('HENRI_STORE_START_FAILED', 'no server');
    const outer = new Error('boot failed', { cause: inner });

    expect(coded(outer)).toBe('HENRI_STORE_START_FAILED');
    expect(coded(new Error('nothing'))).toBeNull();
    expect(coded(null)).toBeNull();

    inner.cause = outer;
    expect(coded(outer)).toBe('HENRI_STORE_START_FAILED');
  });

  test('fallback yields to a more precise code down the chain', () => {
    const precise = fail('HENRI_MODEL_NO_STORE', 'no store');

    expect(
      fallback(
        new Error('boot failed', { cause: precise }),
        'HENRI_BOOT_FAILED'
      ).code
    ).toBeUndefined();
    expect(fallback(new Error('boot failed'), 'HENRI_BOOT_FAILED').code).toBe(
      'HENRI_BOOT_FAILED'
    );
  });

  test('exitOf answers what the catalogue says, or 1', () => {
    expect(exitOf('HENRI_CLI_USAGE')).toBe(2);
    expect(exitOf('HENRI_CLI_NOT_A_PROJECT')).toBe(3);
    expect(exitOf('HENRI_CLI_NEEDS_TTY')).toBe(4);
    expect(exitOf('HENRI_MODEL_UNKNOWN_TYPE')).toBe(1);
    expect(exitOf('nope')).toBe(1);
  });

  test('url is unset by default and holds no address of its own', () => {
    expect(url('HENRI_MODEL_UNKNOWN_TYPE')).toBeNull();
    expect(url('HENRI_MODEL_UNKNOWN_TYPE', null)).toBeNull();
    expect(
      url('HENRI_MODEL_UNKNOWN_TYPE', 'https://example.test/e/')
    ).toBeNull();
    expect(JSON.stringify(catalogue)).not.toMatch(
      /https?:\/\/(?!usehenri\.io)/u
    );
  });

  test('url fills the template of the configuration', () => {
    const inst = { config: { get: () => 'https://example.test/e/{code}/' } };

    expect(url('HENRI_MODEL_UNKNOWN_TYPE', inst)).toBe(
      'https://example.test/e/HENRI_MODEL_UNKNOWN_TYPE/'
    );
    expect(url('HENRI_MODEL_UNKNOWN_TYPE', 'https://x.test/{code}')).toBe(
      'https://x.test/HENRI_MODEL_UNKNOWN_TYPE'
    );
    expect(url('nope', 'https://x.test/{code}')).toBeNull();
  });
});
