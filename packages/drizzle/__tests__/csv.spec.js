// The cursor `@usehenri/core` walks an export with, against a real Drizzle
// store.
//
// `base/csv.js` reads an export a page at a time through a cursor on the
// record's public identifier -- `WHERE externalId > :last ORDER BY
// externalId` -- rather than through an `OFFSET`, which over a table that
// is being written to skips rows and repeats rows. The condition and the
// order are `base/filters.js`'s, so what has to be proved here is that this
// adapter runs them: every row exactly once, in creation order, whatever
// the page size. Runs on sqlite offline and on the PostgreSQL or MySQL
// server of the environment (`pnpm test:sql:live`).
const { build, target } = require('./helpers');

const { cursorOf, pages } = require('@usehenri/core/src/base/csv');

const taskModel = {
  globalId: 'Task',
  identity: 'task',
  options: { timestamps: false },
  schema: { done: { type: 'boolean' }, title: { type: 'string' } },
};

describe(`csv (${target.name})`, () => {
  let adapter;
  let Task;

  beforeAll(async () => {
    ({ adapter } = build());
    Task = adapter.addModel(taskModel, 'user');
    await adapter.start();

    for (let index = 0; index < 7; index++) {
      // Sequential on purpose: the order they were made in is the order
      // the cursor has to walk
      await Task.create({ done: index % 2 === 0, title: `task ${index}` });
    }
  });

  afterAll(async () => {
    await adapter.stop();
  });

  test('the cursor is the public identifier, never the primary key', () => {
    expect(cursorOf(Task)).toBe('externalId');
  });

  test.each([1, 2, 3, 100])(
    'a page of %i walks every row exactly once, in creation order',
    async (batch) => {
      const seen = [];

      for await (const rows of pages(Task, {
        batch,
        key: cursorOf(Task),
        where: {},
      })) {
        expect(rows.length).toBeLessThanOrEqual(batch);
        seen.push(...rows.map((row) => row.title));
      }

      expect(seen).toEqual([
        'task 0',
        'task 1',
        'task 2',
        'task 3',
        'task 4',
        'task 5',
        'task 6',
      ]);
    }
  );

  test('the condition of the export is kept under the cursor', async () => {
    const seen = [];

    for await (const rows of pages(Task, {
      batch: 1,
      key: cursorOf(Task),
      where: { done: true },
    })) {
      seen.push(...rows.map((row) => row.title));
    }

    expect(seen).toEqual(['task 0', 'task 2', 'task 4', 'task 6']);
  });

  test('a condition matching nothing walks nothing', async () => {
    const seen = [];

    for await (const rows of pages(Task, {
      batch: 2,
      key: cursorOf(Task),
      where: { title: 'nothing named this' },
    })) {
      seen.push(...rows);
    }

    expect(seen).toEqual([]);
  });
});
