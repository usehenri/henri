const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const supertest = require('supertest');

const Henri = require('../henri');

/** The demo application: what core's tests boot, and where its flags are */
const DEMO = path.resolve(__dirname, '..', '..', '..', 'demo');
const FlagsModule = require('../2.flags');
const {
  DEFAULTS,
  FileFlagStore,
  MIN_REFRESH,
  MemoryFlagStore,
  SharedFlagStore,
  actorOf,
  bucket,
  createFlagStore,
  decide,
  declarationsOf,
  flagsConfig,
  isEmpty,
  loadDeclarations,
  stateOf,
  unknownFlag,
} = require('../base/flags');

/** A configuration module the way `flagsConfig` reads one */
const config = (values = {}) => ({
  get: (key) => values[key],
  has: (key) => Object.prototype.hasOwnProperty.call(values, key),
});

/** A henri look-alike: a cwd, a pen that keeps its lines, and no shared store */
const fakeHenri = (values = {}, extras = {}) => {
  const logged = [];

  return Object.assign(
    {
      config: config(values),
      cwd: () => DEMO,
      isDev: false,
      isTest: false,
      logged,
      pen: {
        error: (...parts) => logged.push(['error', ...parts]),
        info: (...parts) => logged.push(['info', ...parts]),
        warn: (...parts) => logged.push(['warn', ...parts]),
      },
      shared: null,
    },
    extras
  );
};

/** A directory of this test's own, cleaned up after it */
const tmpdir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), `henri-flags-${process.pid}-`));

/** A uuid v7, minted the way the adapters mint one (time ordered) */
const uuidv7 = (at = Date.now()) => {
  const bytes = crypto.randomBytes(16);

  bytes.writeUIntBE(at, 0, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** A declaration, filled in the way `declarationsOf` fills one */
const declare = (name, extra = {}) =>
  Object.assign(
    { default: false, description: null, expose: false, group: null, name },
    extra
  );

describe('config.flags', () => {
  test('says where the state lives when the application does not', () => {
    expect(flagsConfig(config({}))).toEqual({
      enabled: true,
      refresh: DEFAULTS.refresh,
      store: 'file',
    });

    // A backend for the counters is a backend for the flags
    expect(flagsConfig(config({}), { shared: true }).store).toBe('shared');

    // A suite boots many applications at once and they must not share one
    // switch, so this is the one default that is not about deployment
    expect(flagsConfig(config({}), { isTest: true, shared: true }).store).toBe(
      'memory'
    );
  });

  test('reads a duration, and refuses to poll faster than a second', () => {
    expect(flagsConfig(config({ flags: { refresh: '30s' } })).refresh).toBe(
      30000
    );
    expect(flagsConfig(config({ flags: { refresh: 250 } })).refresh).toBe(
      MIN_REFRESH
    );
    expect(flagsConfig(config({ flags: { refresh: 'nope' } })).refresh).toBe(
      DEFAULTS.refresh
    );
  });

  test('refuses a block that is not one, and a shared store with no backend', () => {
    expect(() => flagsConfig(config({ flags: [] }))).toThrow(
      /must be an object/u
    );
    expect(() => flagsConfig(config({ flags: { store: 'shared' } }))).toThrow(
      /names no backend/u
    );
    expect(flagsConfig(config({ flags: { enabled: false } })).enabled).toBe(
      false
    );
  });
});

describe('the declarations', () => {
  test('takes the short form and the long one', () => {
    const declared = declarationsOf({
      checkout: false,
      'legacy-editor': true,
      newEditor: {
        default: false,
        description: '  The rewrite  ',
        expose: true,
        group: () => true,
      },
    });

    expect([...declared.keys()]).toEqual([
      'checkout',
      'legacy-editor',
      'newEditor',
    ]);
    expect(declared.get('legacy-editor').default).toBe(true);
    expect(declared.get('newEditor')).toMatchObject({
      default: false,
      description: 'The rewrite',
      expose: true,
    });
    expect(typeof declared.get('newEditor').group).toBe('function');
    // Everything unsaid is the safe answer
    expect(declared.get('checkout')).toEqual(declare('checkout'));
  });

  test('refuses what it cannot answer for later', () => {
    const refusals = [
      [['nope'], /must export an object/u],
      ['nope', /must export an object/u],
      [{ 'two words': false }, /is not a flag name/u],
      [{ ok: 'yes' }, /must be true, false, or an object/u],
      [{ ok: { default: 'yes' } }, /must be true or false/u],
      [{ ok: { group: 'admin' } }, /must be a function/u],
    ];

    for (const [exported, message] of refusals) {
      let thrown = null;

      try {
        declarationsOf(exported);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).not.toBeNull();
      expect(thrown.code).toBe('HENRI_FLAGS_DECLARATION_INVALID');
      expect(thrown.message).toMatch(message);
    }

    expect(declarationsOf(null).size).toBe(0);
  });

  test('an application with no file has no flags, which is not a failure', () => {
    expect(loadDeclarations(os.tmpdir()).size).toBe(0);
  });

  test('the demo application declares one of every shape', () => {
    const declared = loadDeclarations(DEMO);

    expect([...declared.keys()].sort()).toEqual([
      'checkout',
      'legacy-editor',
      'newBanner',
      'staffTools',
    ]);
  });
});

describe('the actor', () => {
  test('is the public identifier, and only ever that', () => {
    const id = uuidv7();

    expect(actorOf({ externalId: id, id: 42 })).toBe(id);
    expect(actorOf(id)).toBe(id);
    expect(actorOf('acme-corp')).toBe('acme-corp');
    expect(actorOf(null)).toBeNull();
    expect(actorOf(undefined)).toBeNull();
    expect(actorOf('')).toBeNull();
    // An externalId is a uuid, which is neither shape
    expect(actorOf('01a07d06-e6c4-73cd-9021-31eb06befdd7')).toBe(
      '01a07d06-e6c4-73cd-9021-31eb06befdd7'
    );
    // An application that generates its own is taken at its word
    expect(actorOf('acct_9f2b')).toBe('acct_9f2b');
  });

  test('is never a primary key, and says so', () => {
    // A stringified one too: `String(user.id)` is what a caller reaches for,
    // and on MongoDB it is a 24 character ObjectId that no read would ever
    // match -- a flag silently on for nobody
    for (const key of [42, 1n, '42', '6a9dc968ac7459e5a588ab10']) {
      let thrown = null;

      try {
        actorOf(key);
      } catch (error) {
        thrown = error;
      }

      expect(thrown.code).toBe('HENRI_FLAGS_ACTOR_INVALID');
      expect(thrown.message).toMatch(/never leaves the server/u);
    }
  });

  test('refuses a record with no public identifier', () => {
    let thrown = null;

    try {
      actorOf({ email: 'someone@example.test' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown.code).toBe('HENRI_FLAGS_ACTOR_INVALID');
    expect(thrown.message).toMatch(/externalId/u);
  });
});

describe('the bucket', () => {
  const actors = Array.from({ length: 10000 }, (unused, index) =>
    // Minted in sequence, a millisecond apart, exactly as a real table
    // fills up: this is the population the naive hash gets wrong
    uuidv7(1700000000000 + index)
  );

  /** How many of these actors a flag at this percentage is on for */
  const share = (name, percentage, list = actors) =>
    list.filter((actor) => bucket(name, actor) * 100 < percentage).length;

  test('is stable: the same actor and flag always land in the same place', () => {
    const actor = uuidv7();
    const first = bucket('checkout', actor);

    for (let index = 0; index < 1000; index++) {
      expect(bucket('checkout', actor)).toBe(first);
    }

    // And it is a pure function of two strings, so it survives a restart,
    // a second process and a different machine by construction
    expect(bucket('checkout', '018f0000-0000-7000-8000-000000000000')).toBe(
      0.07458281144499779
    );
  });

  test('a rollout only ever adds people', () => {
    const at10 = new Set(
      actors.filter((actor) => bucket('checkout', actor) * 100 < 10)
    );
    const at25 = actors.filter((actor) => bucket('checkout', actor) * 100 < 25);

    for (const actor of at10) {
      expect(at25).toContain(actor);
    }
  });

  test('lands close to the percentage asked for', () => {
    for (const percentage of [1, 10, 25, 50, 90]) {
      const found = (share('checkout', percentage) / actors.length) * 100;

      expect(Math.abs(found - percentage)).toBeLessThan(2);
    }
  });

  test('does not roll out by signup date, which is the trap of a uuid v7', () => {
    // The ids above were minted in order, so their leading bits count up.
    // Bucketing on any prefix of one would put the first cohort together;
    // every tenth of the sequence has to see about the same share
    const size = actors.length / 10;

    for (let index = 0; index < 10; index++) {
      const slice = actors.slice(index * size, (index + 1) * size);
      const found = (share('checkout', 25, slice) / slice.length) * 100;

      expect(Math.abs(found - 25)).toBeLessThan(5);
    }

    // What the trap looks like: the first hex characters of these ids are
    // the timestamp, so a prefix bucket puts the whole first tenth on one
    // side of any threshold
    const naive = (actor) => parseInt(actor.slice(0, 8), 16) / 2 ** 32;
    const early = actors.slice(0, size).filter((one) => naive(one) < 0.25);
    const late = actors.slice(-size).filter((one) => naive(one) < 0.25);

    expect(early.length === size || late.length === size).toBe(true);
  });

  test('two flags at the same share are not on for the same people', () => {
    const one = new Set(
      actors.filter((actor) => bucket('checkout', actor) * 100 < 50)
    );
    const two = actors.filter((actor) => bucket('search', actor) * 100 < 50);
    const both = two.filter((actor) => one.has(actor)).length;

    // Independent gates agree about half the time; the same gate twice
    // would agree every time
    expect(both / two.length).toBeGreaterThan(0.4);
    expect(both / two.length).toBeLessThan(0.6);
  });
});

describe('who a flag is on for', () => {
  const actor = uuidv7();
  const other = uuidv7();
  const empty = stateOf(null);

  test('answers the declared default until something says otherwise', () => {
    expect(decide(declare('a'), empty, actor, null)).toBe(false);
    expect(decide(declare('a', { default: true }), empty, actor, null)).toBe(
      true
    );
  });

  test('the switch beats everything', () => {
    expect(decide(declare('a'), stateOf({ boolean: true }), null, null)).toBe(
      true
    );
    expect(
      decide(
        declare('a', { default: true }),
        stateOf({ boolean: false }),
        actor,
        null
      )
    ).toBe(false);
  });

  test('a named actor is on, and nobody else is', () => {
    const state = stateOf({ actors: [actor] });

    expect(decide(declare('a'), state, actor, null)).toBe(true);
    expect(decide(declare('a'), state, other, null)).toBe(false);
    expect(decide(declare('a'), state, null, null)).toBe(false);
  });

  test('a percentage needs somebody to bucket, so it never opens for nobody', () => {
    const state = stateOf({ percentage: 100 });

    expect(decide(declare('a'), state, actor, null)).toBe(true);
    expect(decide(declare('a'), state, null, null)).toBe(false);
  });

  test('the group is asked last, and only a true opens it', () => {
    const truthy = declare('a', { group: () => 'admin' });
    const yes = declare('a', { group: (user) => user.roles.includes('admin') });

    expect(decide(truthy, empty, actor, { roles: [] })).toBe(false);
    expect(decide(yes, empty, actor, { roles: ['admin'] })).toBe(true);
    expect(decide(yes, empty, actor, { roles: [] })).toBe(false);
  });

  test('a group that throws is not a yes', () => {
    const boom = declare('a', {
      default: true,
      group: () => {
        throw new Error('nope');
      },
    });

    // It falls back to the declared default rather than to `false`: a group
    // that broke says nothing about what the flag means
    expect(decide(boom, empty, actor, null)).toBe(true);
  });

  test('the kill switch cannot be argued with by a group', () => {
    const staff = declare('a', { group: () => true });

    expect(decide(staff, stateOf({ boolean: false }), actor, null)).toBe(false);
  });

  test('an actor added after a kill switch is a new decision', () => {
    const state = stateOf({ actors: [actor], boolean: false });

    expect(decide(declare('a'), state, actor, null)).toBe(true);
    expect(decide(declare('a'), state, other, null)).toBe(false);
  });

  test('nothing the store holds is trusted to have a shape', () => {
    expect(stateOf('nope')).toEqual(stateOf(null));
    expect(stateOf({ actors: [1, '', 'ok'], percentage: '25' })).toMatchObject({
      actors: ['ok'],
      percentage: 25,
    });
    expect(stateOf({ percentage: 400 }).percentage).toBe(100);
    expect(stateOf({ boolean: 'yes' }).boolean).toBeNull();
    expect(isEmpty(stateOf(null))).toBe(true);
    expect(isEmpty(stateOf({ boolean: false }))).toBe(false);
  });
});

describe('the stores', () => {
  let dir = null;

  beforeEach(() => {
    dir = tmpdir();
  });

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('memory holds what this process wrote, and says what it is', async () => {
    const store = new MemoryFlagStore();

    expect(store.describe()).toMatch(/this process/u);
    await store.write('a', stateOf({ boolean: true }));
    expect([...(await store.read(['a', 'b']))].length).toBe(1);
    await store.write('a', null);
    expect((await store.read(['a'])).size).toBe(0);
  });

  test('a file is read whole and written one flag at a time', async () => {
    // Inside a directory henri has to create, which is the only case that
    // gets a `.gitignore`: a directory that was already there belongs to
    // the application and is left exactly as it was
    const file = path.join(dir, 'state', 'flags.json');
    const store = new FileFlagStore(file);

    // No file is no flips, not a failure
    expect((await store.read(['a'])).size).toBe(0);

    await store.write('a', stateOf({ boolean: true }));
    await store.write('b', stateOf({ percentage: 25 }));

    expect(
      Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))).sort()
    ).toEqual(['a', 'b']);
    expect((await store.read(['a', 'b'])).get('b').percentage).toBe(25);

    expect(fs.existsSync(path.join(dir, 'state', '.gitignore'))).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  test('a directory that was already there is left exactly as it was', async () => {
    // An application pointing this at `config/` must not end up with a
    // `.gitignore` holding `*` next to its configuration
    const store = new FileFlagStore(path.join(dir, 'flags.json'));

    await store.write('a', stateOf({ boolean: true }));

    expect(fs.readdirSync(dir)).toEqual(['flags.json']);
  });

  test('a second writer keeps what the first one wrote', async () => {
    const file = path.join(dir, 'flags.json');
    const one = new FileFlagStore(file);
    const two = new FileFlagStore(file);

    await one.write('a', stateOf({ boolean: true }));
    await two.write('b', stateOf({ boolean: true }));

    // The second read the file rather than trusting what it had in hand
    expect([...(await one.read(['a', 'b'])).keys()].sort()).toEqual(['a', 'b']);
  });

  test('it parses again only when the file has moved', async () => {
    const file = path.join(dir, 'flags.json');
    const store = new FileFlagStore(file);
    let parsed = 0;
    const parse = store.parse.bind(store);

    store.parse = () => {
      parsed++;

      return parse();
    };

    await store.write('a', stateOf({ boolean: true }));
    await store.read(['a']);
    parsed = 0;

    await store.read(['a']);
    await store.read(['a']);
    await store.read(['a']);

    expect(parsed).toBe(0);
  });

  test('a file that is not flag state is refused rather than guessed at', async () => {
    const file = path.join(dir, 'flags.json');
    const store = new FileFlagStore(file);

    fs.writeFileSync(file, 'not json at all');
    await expect(store.read(['a'])).rejects.toMatchObject({
      code: 'HENRI_FLAGS_STORE_UNUSABLE',
    });

    fs.writeFileSync(file, '[]');
    await expect(store.read(['a'])).rejects.toMatchObject({
      code: 'HENRI_FLAGS_STORE_UNUSABLE',
    });

    // A write replaces it: refusing every flip until somebody deletes a
    // file by hand would help nobody
    await store.write('a', stateOf({ boolean: true }));
    expect((await store.read(['a'])).get('a').boolean).toBe(true);
  });

  test('the shared store is one key per flag, and no expiry', async () => {
    const written = new Map();
    const backend = {
      delete: async (key) => void written.delete(key),
      get: async (key) => written.get(key),
      set: async (key, value, ttl) => {
        expect(ttl).toBeUndefined();
        written.set(key, value);
      },
    };
    const store = new SharedFlagStore(backend, 'redis');

    expect(store.shared).toBe(true);
    expect(store.describe()).toMatch(/every process/u);

    await store.write('a', stateOf({ boolean: true }));
    await store.write('b', stateOf({ percentage: 10 }));

    expect([...written.keys()].sort()).toEqual(['a', 'b']);
    expect((await store.read(['a', 'b', 'c'])).size).toBe(2);

    await store.write('a', null);
    expect(written.has('a')).toBe(false);
  });

  test('the store is built from the configuration, and shared needs a backend', () => {
    const henri = fakeHenri({}, { cwd: () => __dirname });

    expect(createFlagStore(henri, { store: 'memory' })).toBeInstanceOf(
      MemoryFlagStore
    );
    expect(createFlagStore(henri, { store: 'file' }).file).toBe(
      path.join(__dirname, '.henri', 'flags.json')
    );
    expect(createFlagStore(henri, { store: 'here/flags.json' }).file).toBe(
      path.join(__dirname, 'here', 'flags.json')
    );
    expect(() => createFlagStore(henri, { store: 'shared' })).toThrow(
      /no shared backend/u
    );
  });
});

describe('the module', () => {
  let dir = null;

  /** A flags module bound to a fake henri, initialized */
  const moduleOn = async (values, extras = {}) => {
    const module = new FlagsModule();

    module.henri = fakeHenri(values, extras);
    await module.init();

    return module;
  };

  beforeEach(() => {
    dir = tmpdir();
  });

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('an application with no flags pays for nothing', async () => {
    const module = await moduleOn({}, { cwd: () => os.tmpdir() });

    expect(module.store).toBeNull();
    expect(module.timer).toBeNull();
    expect(module.henri.logged).toEqual([]);
  });

  test('the boot line names the store and its limit', async () => {
    const module = await moduleOn({ flags: { store: 'memory' } });
    const [line] = module.henri.logged;

    expect(line[0]).toBe('info');
    expect(line[1]).toBe('flags');
    expect(line[2]).toBe('memory');
    expect(line[3]).toMatch(/4 declared, this process only/u);
    await module.stop();
  });

  test('a memory store in production says the command cannot reach anything', async () => {
    const module = await moduleOn({ flags: { store: 'memory' } });
    const warned = module.henri.logged.find(([level]) => level === 'warn');

    expect(warned[2]).toMatch(/this process's memory/u);
    expect(warned[3]).toMatch(/henri flags:on cannot reach/u);
    await module.stop();
  });

  test('a file store polls, and a memory one has nothing to poll', async () => {
    const memory = await moduleOn({ flags: { store: 'memory' } });
    const file = await moduleOn({
      flags: { store: path.join(dir, 'flags.json') },
    });

    expect(memory.timer).toBeNull();
    expect(file.timer).not.toBeNull();
    await memory.stop();
    await file.stop();
    expect(file.timer).toBeNull();
  });

  test('the four writes, and what each one leaves behind', async () => {
    const module = await moduleOn({ flags: { store: 'memory' } });
    const actor = uuidv7();

    expect(await module.enabled('checkout')).toBe(false);

    await module.enable('checkout');
    expect(await module.enabled('checkout')).toBe(true);

    await module.disable('checkout');
    expect(await module.enabled('checkout')).toBe(false);

    await module.enable('checkout', actor);
    expect(await module.enabled('checkout', actor)).toBe(true);
    expect(await module.enabled('checkout', uuidv7())).toBe(false);

    await module.percentage('checkout', 100);
    expect(await module.enabled('checkout', uuidv7())).toBe(true);

    // Off is a reset: the named set and the share go with it
    await module.disable('checkout');
    expect(await module.enabled('checkout', actor)).toBe(false);
    expect(module.state('checkout')).toMatchObject({
      actors: [],
      boolean: false,
      percentage: 0,
    });

    // And a reset is back to the file, not to off
    await module.reset('checkout');
    expect(module.state('checkout').boolean).toBeNull();
    expect(await module.enabled('legacy-editor')).toBe(true);
    await module.stop();
  });

  test('an undeclared name is a failure on the way in and on the way out', async () => {
    const module = await moduleOn({ flags: { store: 'memory' } });

    for (const call of [
      () => module.enabled('chekout'),
      () => module.enable('chekout'),
      () => module.disable('chekout'),
      () => module.percentage('chekout', 10),
      () => module.reset('chekout'),
    ]) {
      const thrown = await call().catch((error) => error);

      expect(thrown.code).toBe('HENRI_FLAGS_UNKNOWN');
      // The near miss, so a typo is one line to fix rather than a hunt
      expect(thrown.message).toMatch(/did you mean "checkout"/u);
    }

    const stranger = await module
      .enabled('nothing-like-it')
      .catch((error) => error);

    expect(stranger.message).toMatch(/this application declares checkout/u);
    await module.stop();
  });

  test('only the flags declared expose reach a page', async () => {
    const module = await moduleOn({ flags: { store: 'memory' } });

    expect(await module.exposed(null)).toEqual({ newBanner: false });
    await module.enable('newBanner');
    expect(await module.exposed(null)).toEqual({ newBanner: true });
    await module.stop();
  });

  test('the listing says what each flag is and what moved it', async () => {
    const module = await moduleOn({ flags: { store: 'memory' } });

    await module.percentage('checkout', 25);

    const listed = await module.list();
    const checkout = listed.find((flag) => flag.name === 'checkout');
    const staff = listed.find((flag) => flag.name === 'staffTools');

    expect(listed).toHaveLength(4);
    expect(checkout).toMatchObject({
      actors: [],
      boolean: null,
      default: false,
      // What somebody henri knows nothing about is answered
      everyone: false,
      expose: false,
      group: false,
      percentage: 25,
    });
    expect(checkout.at).toBeGreaterThan(0);
    // A function is not data: the listing says whether there is one
    expect(staff.group).toBe(true);
    expect(staff.description).toBe('The tools only the staff sees');
    await module.stop();
  });

  test('disabled means the declared default and nowhere to write', async () => {
    const module = await moduleOn({ flags: { enabled: false } });

    expect(await module.enabled('legacy-editor')).toBe(true);
    expect(await module.enabled('checkout')).toBe(false);
    await expect(module.enable('checkout')).rejects.toMatchObject({
      code: 'HENRI_FLAGS_STORE_UNUSABLE',
    });
    expect(module.henri.logged[0][2]).toBe('disabled');
  });

  test('a store that cannot be read keeps the flags where they are', async () => {
    const file = path.join(dir, 'flags.json');
    const module = await moduleOn({ flags: { store: file } });

    await module.enable('checkout');
    expect(await module.enabled('checkout')).toBe(true);

    // The backend goes away under it
    module.store.read = async () => {
      throw new Error('connection reset');
    };

    expect(await module.refresh()).toBe(false);
    // Not the declared default, which is what a cache miss would have
    // answered, and what would have turned the feature off mid-incident
    expect(await module.enabled('checkout')).toBe(true);

    const said = module.henri.logged.find(([level]) => level === 'error');

    expect(said[3]).toMatch(/keeping the flags where they are/u);

    // And an outage is not the log: once a minute, however often it fails
    module.henri.logged.length = 0;
    await module.refresh();
    expect(module.henri.logged).toEqual([]);
    await module.stop();
  });

  test('two instances over one file see each other', async () => {
    const file = path.join(dir, 'flags.json');
    const one = await moduleOn({ flags: { store: file } });
    const two = await moduleOn({ flags: { store: file } });

    expect(await two.enabled('checkout')).toBe(false);

    await one.enable('checkout');

    // The writer sees it at once, without waiting for its own poll
    expect(await one.enabled('checkout')).toBe(true);
    // The reader is behind until it looks again, which is the whole of the
    // staleness window: config.flags.refresh and nothing else
    expect(await two.enabled('checkout')).toBe(false);
    await two.refresh();
    expect(await two.enabled('checkout')).toBe(true);

    await one.stop();
    await two.stop();
  });

  test('a reload re-reads the declarations', async () => {
    const module = await moduleOn({ flags: { store: 'memory' } });

    module.declared.delete('checkout');
    await expect(module.enabled('checkout')).rejects.toMatchObject({
      code: 'HENRI_FLAGS_UNKNOWN',
    });

    await module.reload();
    expect(await module.enabled('checkout')).toBe(false);
    await module.stop();
  });

  test('the message for an unknown flag says what to do about it', () => {
    expect(unknownFlag('x', []).message).toMatch(/declares none/u);
    expect(unknownFlag('x', ['a'], 'henri flags:on').message).toMatch(
      /^henri flags:on asked for "x"/u
    );
  });
});

describe('a request', () => {
  let henri = null;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    delete global.henri;
  });

  test('req.flag() answers for the user of the request', async () => {
    const answer = await supertest(henri.server.app).get('/flags');

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ checkout: false, staffTools: false });

    await henri.flags.enable('checkout');

    const again = await supertest(henri.server.app).get('/flags');

    expect(again.body.checkout).toBe(true);
    await henri.flags.reset('checkout');
  });

  test('a flag nothing declares fails the request rather than answering no', async () => {
    const answer = await supertest(henri.server.app)
      .get('/flags/ghost')
      .set('Accept', 'application/json');

    expect(answer.status).toBe(500);
    expect(answer.body.code).toBe('HENRI_FLAGS_UNKNOWN');
  });

  test('a rendered page carries the flags declared expose, and no others', async () => {
    const answer = await supertest(henri.server.app)
      .get('/hello')
      .set('Accept', 'application/json');

    expect(answer.status).toBe(200);
    expect(answer.body.flags).toEqual({ newBanner: false });
    expect(answer.body.flags.checkout).toBeUndefined();

    await henri.flags.enable('newBanner');

    const again = await supertest(henri.server.app)
      .get('/hello')
      .set('Accept', 'application/json');

    expect(again.body.flags).toEqual({ newBanner: true });
    await henri.flags.reset('newBanner');
  });

  test('the group is asked about the user of the request', async () => {
    expect(await henri.flags.enabled('staffTools', null)).toBe(false);
    expect(
      await henri.flags.enabled('staffTools', {
        externalId: '018f0000-0000-7000-8000-000000000000',
        roles: ['admin'],
      })
    ).toBe(true);
  });

  test('the module is where it says it is', () => {
    expect(henri.flags.name).toBe('flags');
    expect(henri.flags.runlevel).toBe(2);
    expect(henri.flags.store.name).toBe('memory');
  });
});
