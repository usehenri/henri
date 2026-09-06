const fs = require('fs');
const path = require('path');
const supertest = require('supertest');

const Henri = require('../henri');
const { problems } = require('../base/config-validate');
const { isCode } = require('../base/errors');
const {
  CODE,
  SIGNATURES,
  UNCHECKED,
  UNKNOWN,
  check,
} = require('../base/arguments');

/**
 * The convention test of the public surface.
 *
 * `base/arguments.js` is only worth having if it cannot fall behind, so
 * this is the half that keeps it true, the way `config-schema.spec.js`
 * compares the schema with the types and the documentation:
 *
 * 1. every method the type declarations expose is in one of the two tables
 *    -- checked, or left alone with a reason;
 * 2. every declared signature is checked somewhere in the source, so a
 *    declaration nothing calls fails;
 * 3. every entry point genuinely refuses garbage, by calling it with
 *    garbage on a booted application.
 *
 * (3) is the one with teeth, and it is generic: the poison for an argument
 * is derived from the node that declares it, so a signature added tomorrow
 * is exercised without a line being written here.
 */

const ROOT = path.resolve(__dirname, '..');

/**
 * The interfaces of `index.d.ts` this table covers, and the name a method
 * of each gets. What is missing from this list is missing on purpose and
 * is named in `NOT_WALKED` below.
 */
const INTERFACES = {
  Cache: 'henri.cache',
  CallsModule: 'henri.calls',
  ConfigModule: 'henri.config',
  EncryptionModule: 'henri.encryption',
  Henri: 'henri',
  MailModule: 'henri.mail',
  ModelModule: 'henri.model',
  Pen: 'henri.pen',
  PoliciesModule: 'henri.policies',
  PrivacyModule: 'henri.privacy',
  Reporter: 'henri.reporter',
  Request: 'req',
  Response: 'res',
  RetentionModule: 'henri.retention',
  TrailModule: 'henri.trail',
  Utils: 'henri.utils',
};

/**
 * The rest of the surface, and why it is not walked yet. Each of these is
 * a module of its own with its own guards; adding one here is adding its
 * methods to `SIGNATURES` or to `UNCHECKED`, and that is the next pass.
 */
const NOT_WALKED = {
  AccountsService:
    'reached through a route, where base/params-schema.js is the boundary. Four of its calls do refuse badly on their own -- register(null) throws one frame down, urlFor(42) builds https://host42, tokenFor mints a token for a purpose nothing consumes -- and that is the next pass',
  ControllersModule:
    'reads what 2.controllers.js loaded and answers null for anything else',
  GraphqlModule:
    '@usehenri/graphql ships it, and a package checks its own surface',
  JobsModule: '@usehenri/jobs ships it',
  RouterModule: 'the expanded route table, read-only',
  ServerModule: 'the express application and the listener',
  SharedStore:
    'the backend of config.shared, reached by the three counters and never by an application directly',
  StoreAdapter:
    'the adapter contract, implemented by the adapters and called by core',
  UploadsModule: '@usehenri/uploads ships it',
  UserModule:
    'the password helpers, which mostly refuse on their own terms (a policy failure, a mismatch) rather than on a shape. Two do not and are the next pass: compare(password, user) answers a bad user with the same bare error a wrong password gets, and publicUser(42) answers a user-shaped object',
  ViewEngine:
    'the engine contract, implemented by the renderers and called by core',
  ViewModule: 'the engine, the renderer name and the handlebars instance',
  WebhooksModule: '@usehenri/webhooks ships it',
  WorkersModule: 'the loaded workers, read-only',
};

/**
 * Every method an interface of `index.d.ts` declares at its own level, with
 * whether it takes an argument at all
 *
 * @param {string} source the content of index.d.ts
 * @param {string} name the interface name
 * @returns {Map<string, boolean>} the method names, true when it takes one
 */
function methods(source, name) {
  // `interface Response extends Omit<ExpressResponse, 'render'> {`
  const declaration = new RegExp(
    `^\\s*interface ${name}(?:\\s+extends[^{]*)?\\s*\\{`,
    'mu'
  );
  const found_at = declaration.exec(source);

  expect(found_at).not.toBeNull();

  const start = found_at.index;

  const found = new Map();
  let depth = 0;

  for (const line of source.slice(start).split('\n').slice(1)) {
    if (depth === 0) {
      // `fetch<T>(key: CacheKey, ...)`, `file?(field: string)`, `stats()`
      const match = /^\s{4}(?:readonly\s+)?(\w+)\??(?:<[^>]*>)?\(([^)]*)/u.exec(
        line
      );

      if (match) {
        const takes = match[2].trim() !== '';

        found.set(match[1], found.get(match[1]) || takes);
      }
    }

    depth += (line.match(/\{/gu) || []).length;
    depth -= (line.match(/\}/gu) || []).length;

    if (depth < 0) {
      break;
    }
  }

  return found;
}

/** Every `.js` of core's source, the tests aside */
function sources(dir, found = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === '__tests__') {
      continue;
    }

    const full = path.join(dir, item.name);

    if (item.isDirectory()) {
      sources(full, found);
    } else if (item.name.endsWith('.js')) {
      found.push(full);
    }
  }

  return found;
}

/** The names `check('<name>', ...)` is called with, anywhere in the source */
const called = new Set(
  sources(ROOT).flatMap((file) =>
    [...fs.readFileSync(file, 'utf8').matchAll(/\bcheck\('([^']+)'/gu)].map(
      (match) => match[1]
    )
  )
);

/** Is there anything for `check()` to do in this signature? */
const enforced = (signature) =>
  signature.some((argument) => !argument.by && argument.type !== 'any');

/** The values a sample and a poison are picked from, in order */
const VALUES = [
  'x',
  1,
  200,
  true,
  {},
  [],
  () => 1,
  new Date('2024-01-02T03:04:05Z'),
  null,
];

/** A value the node accepts, or undefined when it accepts none of them */
const sample = (node) =>
  VALUES.find((value) => problems(node, value, 'x').length === 0);

/**
 * ... and one it does not.
 *
 * A list is poisoned with a bad item rather than with something that is not
 * a list, because `req.permit(...fields)` is variadic: the list *is* the
 * call, and a string there is one perfectly good field name.
 *
 * @param {object} node the node
 * @returns {*} a value the node refuses
 */
const poison = (node) =>
  node.type === 'array' && node.of
    ? [poison(node.of)]
    : VALUES.find((value) => problems(node, value, 'x').length > 0);

/**
 * What to pass for an argument another guard owns (`by`), by its name.
 * Small on purpose: the point is a call that is right everywhere except
 * where the test poisoned it.
 */
const OWNED = {
  event: { action: 'test.called' },
  key: 'a-key',
  message: { to: 'someone@example.test' },
  name: 'a-name',
  record: { externalId: '018f0000-0000-7000-8000-000000000000' },
  records: [],
  value: 1,
};

describe('the public surface and the two tables', () => {
  const types = () =>
    fs.readFileSync(path.join(ROOT, '..', 'index.d.ts'), 'utf8');

  test('every method the types declare is checked, or left alone with a reason', () => {
    const source = types();
    const missing = [];

    for (const [name, prefix] of Object.entries(INTERFACES)) {
      for (const [method, takes] of methods(source, name)) {
        const full = `${prefix}.${method}`;

        // A method that takes no argument has nothing to check, and a
        // whole module may be left alone at once (`henri.pen`)
        if (
          !takes ||
          SIGNATURES[full] ||
          UNCHECKED[full] ||
          UNCHECKED[prefix]
        ) {
          continue;
        }

        missing.push(full);
      }
    }

    expect(missing).toEqual([]);
  });

  test('the interfaces that are not walked yet say so', () => {
    const source = types();

    for (const [name, reason] of Object.entries(NOT_WALKED)) {
      expect(source).toContain(`interface ${name} {`);
      expect(reason.length).toBeGreaterThan(20);
    }

    expect(
      Object.keys(NOT_WALKED).filter((name) => name in INTERFACES)
    ).toEqual([]);
  });

  test('no name is in both tables, and every reason reads like one', () => {
    const both = Object.keys(SIGNATURES).filter((name) => name in UNCHECKED);

    expect(both).toEqual([]);

    for (const [name, reason] of Object.entries(UNCHECKED)) {
      expect(typeof reason).toBe('string');
      // Long enough to be a reason rather than a shrug
      expect(reason.length).toBeGreaterThan(20);
      expect(name).toMatch(/^(?:henri|req|res|message)(?:\.\w+)*$/u);
    }
  });

  test('an argument another guard owns names a code the catalogue holds', () => {
    const declared = Object.values(SIGNATURES).flat();

    expect(declared.map((argument) => typeof argument.name)).toEqual(
      declared.map(() => 'string')
    );
    expect(
      declared
        .map((argument) => argument.by)
        .filter(Boolean)
        .filter((code) => !isCode(code))
    ).toEqual([]);
  });

  test('every declared signature is checked somewhere in the source', () => {
    const never = Object.entries(SIGNATURES)
      .filter(([name, signature]) => enforced(signature) && !called.has(name))
      .map(([name]) => name);

    expect(never).toEqual([]);
  });

  test('check() refuses a name it does not declare', () => {
    expect(() => check('henri.nothing.here', [])).toThrow(
      /has no declared signature/u
    );
  });
});

describe('every entry point refuses what it cannot honour', () => {
  let henri;
  let request;
  let response;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;

    // A real request, so `res.render`, `res.negotiate`, `res.boom` and
    // `req.permit` are the ones the router installs rather than a fake
    henri.router.handler.use((req, res) => {
      request = req;
      response = res;
      res.status(204).end();
    });

    await supertest(henri.server.app).get('/__arguments_spec__');
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    delete global.henri;
  });

  /**
   * The function a name stands for, already bound, or null when this test
   * cannot reach it
   *
   * @param {string} name the entry point
   * @returns {?function} the function
   */
  const entry = (name) => {
    if (name === 'res.boom') {
      return response.boom.badRequest;
    }

    if (name === 'message.deliverLater') {
      const message = henri.mailers.auth.confirm(
        { email: 'someone@example.test' },
        'https://example.test/confirm/x'
      );

      return (...args) => message.deliverLater(...args);
    }

    // The one variadic entry point: the list is the call
    if (name === 'req.permit') {
      return (fields) => request.permit(...fields);
    }

    const [head, ...rest] = name.split('.');
    const last = rest.pop();
    const owner = rest.reduce(
      (held, step) => (held ? held[step] : null),
      { henri, req: request, res: response }[head]
    );

    return owner && typeof owner[last] === 'function'
      ? (...args) => owner[last](...args)
      : null;
  };

  /**
   * The arguments of a call that is right everywhere except at `index`
   *
   * @param {Array<object>} signature the signature
   * @param {number} index the argument to poison
   * @returns {Array<*>} the arguments
   */
  const call = (signature, index) =>
    signature.map((argument, at) => {
      if (at === index) {
        return poison(argument);
      }

      if (argument.by) {
        return OWNED[argument.name];
      }

      return argument.type === 'any' ? 1 : sample(argument);
    });

  // What a shape cannot say, and what a clean empty run hides
  test('a selector that names nothing is its own refusal', async () => {
    let error = null;

    try {
      await henri.retention.plan({ only: 'Nothing' });
    } catch (thrown) {
      error = thrown;
    }

    expect(error && error.code).toBe(UNKNOWN);
    expect(error.hint).toMatch(/^(?:It is one of: |This application)/u);

    try {
      error = null;
      await henri.encryption.rotate({ model: 'Nothing' });
    } catch (thrown) {
      error = thrown;
    }

    expect(error && error.code).toBe(UNKNOWN);
  });

  // The record that names nobody, which used to reach an unsafe mass
  // update as `{ [primary]: undefined }`
  test('a record that says which row it is not names nobody', async () => {
    let error = null;

    try {
      await henri.privacy.subject({ email: 'someone@example.test' });
    } catch (thrown) {
      error = thrown;
    }

    expect(error && error.code).toBe('HENRI_PRIVACY_UNKNOWN_SUBJECT');
    expect(error.message).toContain('names nobody');
  });

  for (const [name, signature] of Object.entries(SIGNATURES)) {
    if (!enforced(signature)) {
      continue;
    }

    signature.forEach((argument, index) => {
      if (argument.by || argument.type === 'any') {
        return;
      }

      test(`${name}(${argument.name})`, async () => {
        const fn = entry(name);

        expect(typeof fn).toBe('function');

        // Every argument this test can express is expressible: a signature
        // whose node nothing in VALUES matches would silently not be tested
        expect(poison(argument)).toBeDefined();

        let error = null;

        try {
          await fn(...call(signature, index));
        } catch (thrown) {
          error = thrown;
        }

        expect(error).not.toBeNull();
        expect(error.code).toBe(CODE);
        // The message names the method and the argument that is wrong
        expect(error.message).toContain(name.split('.').slice(-2).join('.'));
        expect(error.message).toContain(`${argument.name}`);
      });

      if (argument.optional) {
        return;
      }

      test(`${name}(${argument.name}) left out`, async () => {
        const fn = entry(name);
        const args = call(signature, -1);

        args[index] = undefined;

        let error = null;

        try {
          await fn(...args);
        } catch (thrown) {
          error = thrown;
        }

        // A required argument that is absent is refused too, whether it
        // reads as missing or as the default the method fills in for it
        expect(error && error.code).toBe(CODE);
        expect(error.message).toContain(argument.name);
      });
    });
  }
});

describe('what a refusal says', () => {
  test('it names the method, the argument, the expectation and the value', () => {
    expect(() => check('henri.cache.fetch', ['k', {}, 42])).toThrow(
      'henri.cache.fetch(fn) must be a function, but it is the number 42'
    );
    expect(() => check('res.render', ['/tasks', 'oops'])).toThrow(
      'res.render(options) must be an object, but it is the string "oops"'
    );
    expect(() => check('req.pagination', [{ perPage: 'abc' }])).toThrow(
      'req.pagination(overrides.perPage) must be a whole number above zero, but it is the string "abc"'
    );
  });

  test('a near miss of a declared option is named', () => {
    expect(() =>
      check('henri.privacy.erase', ['someone@example.test', { stratgy: 'x' }])
    ).toThrow('did you mean "options.strategy"?');

    // ... and a key that is nothing like one is left alone, the way the
    // configuration leaves an application's own keys alone
    expect(() =>
      check('henri.privacy.erase', ['someone@example.test', { mine: 'x' }])
    ).not.toThrow();
  });

  test('one signature may stand for a family of methods', () => {
    expect(() => check('res.boom', [42], 'res.boom.notFound')).toThrow(
      'res.boom.notFound(message) must be a string, but it is the number 42'
    );
  });

  test('every problem is reported, not the first one', () => {
    let error;

    try {
      check('henri.policies.can', [null, 42, null, { policy: 1 }]);
    } catch (thrown) {
      error = thrown;
    }

    expect(error.problems).toHaveLength(2);
    expect(error.message).toContain('2 arguments henri cannot honour');
    expect(error.message).toContain('(action)');
    expect(error.message).toContain('(options.policy)');
  });

  test('null is not the same as absent for an argument', () => {
    // The whole of the `options = {}` default that never applied to null
    expect(() => check('henri.cache.set', ['k', 1, null])).toThrow(
      'henri.cache.set(options) must be an object, but it is null'
    );
    expect(() => check('henri.cache.set', ['k', 1])).not.toThrow();
  });

  test('... and it is the same as absent for a selector inside a bag', () => {
    expect(() =>
      check('henri.encryption.rotate', [{ field: 'phone', model: null }])
    ).not.toThrow();
  });
});
