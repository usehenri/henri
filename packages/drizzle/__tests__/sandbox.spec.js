// `Drizzle#sandbox()`, the seam `henri console --sandbox` holds open.
//
// The claim being tested is the one somebody trusts before doing something
// destructive to production data: a model call typed at a prompt joins the
// transaction with nothing threaded through it, and everything the session
// wrote is gone afterwards. Runs on whatever the environment points at --
// sqlite offline, a PostgreSQL or a MySQL server with
// HENRI_TEST_POSTGRES_URL or HENRI_TEST_MYSQL_URL (`pnpm test:sql:live`).
const { build, target } = require('./helpers');

const models = [
  {
    globalId: 'Note',
    identity: 'note',
    options: { timestamps: true },
    schema: { body: { type: 'string' } },
    store: 'default',
  },
];

describe(`the console sandbox on ${target.name}`, () => {
  let adapter = null;
  let Note = null;

  beforeAll(async () => {
    ({ adapter } = build());
    models.forEach((model) => adapter.addModel(model, 'user'));
    await adapter.start();
    Note = adapter.getModels().Note;
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
  });

  beforeEach(async () => {
    await Note.where({}).destroy({ force: true });
  });

  test('a model call inside it joins the transaction, and is rolled back', async () => {
    await Note.create({ body: 'before' });

    const sandbox = await adapter.sandbox();

    // Nothing is threaded through this call: it joins because of where it
    // runs, which is the whole reason the flag can be offered here
    await sandbox.run(async () => {
      await Note.create({ body: 'written in the sandbox' });
      await Note.where({ body: 'before' }).destroy({ force: true });

      // Inside, the session sees its own work
      const seen = await Note.find({});

      expect(seen.map((note) => note.body)).toEqual(['written in the sandbox']);
    });

    expect(await sandbox.rollback()).toBe(true);

    // Outside, none of it happened -- including the destroy
    const left = await Note.find({});

    expect(left.map((note) => note.body)).toEqual(['before']);
  });

  test('several statements roll back together, and the handle closes once', async () => {
    const sandbox = await adapter.sandbox();

    await sandbox.run(async () => {
      for (const body of ['one', 'two', 'three']) {
        await Note.create({ body });
      }
    });

    await sandbox.rollback();

    expect(await Note.where({}).count()).toBe(0);

    // Rolling back what is already rolled back is not an error: the console
    // may exit twice (an `exit` event and a signal) and must not fail on it
    await expect(sandbox.rollback()).resolves.toBe(true);
  });

  test('work outside the sandbox is untouched by the rollback', async () => {
    const sandbox = await adapter.sandbox();

    await sandbox.run(async () => {
      await Note.create({ body: 'doomed' });
    });

    await sandbox.rollback();

    // After the transaction closed, the store is the store again
    await Note.create({ body: 'kept' });

    expect((await Note.find({})).map((note) => note.body)).toEqual(['kept']);
  });

  test('a sandbox inside a transaction is refused rather than nested', async () => {
    await adapter.transaction(async () => {
      await expect(adapter.sandbox()).rejects.toMatchObject({
        code: 'HENRI_STORE_SANDBOX_UNSUPPORTED',
      });
    });
  });

  test('rolling back leaves no unhandled rejection behind', async () => {
    // The rollback is a rejection of the transaction promise, so the guard
    // that catches "the transaction ended before the sandbox held it" has
    // to settle quietly once the handle is out. A console that printed
    // UnhandledPromiseRejection on the way out would be a console nobody
    // trusts the rest of
    const seen = [];
    const onUnhandled = (error) => seen.push(error);

    process.on('unhandledRejection', onUnhandled);

    try {
      const sandbox = await adapter.sandbox();

      await sandbox.run(() => Note.create({ body: 'gone' }));
      await sandbox.rollback();

      // Two turns of the microtask queue and one of the macrotask queue:
      // node reports an unhandled rejection at the end of a tick
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(seen).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
