const { build, target } = require('./helpers');

/**
 * Storage is UTC, and it is not negotiable.
 *
 * The same guarantee the drizzle and mongoose suites hold, on the adapter
 * `@usehenri/mssql` rides. An application does not reach this adapter for
 * sqlite, PostgreSQL or MySQL -- those are `@usehenri/drizzle` with the
 * dialect chosen -- but the base class is exercised against the servers
 * that are available, so the guarantee is checked on them too.
 *
 * The process is pinned to the two awkward ones: `Pacific/Kiritimati` is
 * UTC+14 and `Pacific/Niue` is UTC-11, 25 hours apart.
 *
 * **Sub-second precision is deliberately not asserted here.** Sequelize
 * asks for a bare `DATETIME` on MySQL, which is `DATETIME(0)`, so the
 * milliseconds are truncated; the last test records that rather than
 * hiding it. It is a precision defect and not a zone one -- the instant is
 * the same in every zone, only rounded -- and the column an application
 * actually gets on MySQL is drizzle's `datetime(3)`.
 */

/** UTC+14: 2026-03-08T10:00Z is midnight on the 9th here */
const AHEAD = 'Pacific/Kiritimati';

/** UTC-11: the same instant is 23:00 on the 7th here */
const BEHIND = 'Pacific/Niue';

const MODEL = {
  globalId: 'Moment',
  identity: 'moment',
  options: { timestamps: true },
  schema: {
    at: { type: 'date' },
    label: { type: 'string' },
  },
  store: 'default',
};

/** Whole seconds, so every dialect can hold them exactly */
const INSTANTS = {
  fallBack: new Date('2026-11-01T05:30:00.000Z'),
  midnightAhead: new Date('2026-03-08T10:00:00.000Z'),
  plain: new Date('2026-06-15T12:34:56.000Z'),
  springForward: new Date('2026-03-08T07:00:00.000Z'),
};

/**
 * Runs something with the process pinned to a zone, and puts it back
 *
 * @param {string} zone the zone
 * @param {function} fn what to run
 * @returns {Promise<*>} whatever fn answered
 */
const withProcessZone = async (zone, fn) => {
  const before = process.env.TZ;

  process.env.TZ = zone;

  try {
    return await fn();
  } finally {
    typeof before === 'undefined'
      ? delete process.env.TZ
      : (process.env.TZ = before);
  }
};

describe('storage is UTC', () => {
  test('an instant survives being written and read in opposite zones', async () => {
    const { adapter } = build();

    adapter.addModel(MODEL);
    await adapter.start();

    const Moment = adapter.getModels().Moment;

    await withProcessZone(AHEAD, async () => {
      for (const [label, when] of Object.entries(INSTANTS)) {
        await Moment.create({ at: when, label });
      }
    });

    await withProcessZone(BEHIND, async () => {
      for (const [label, when] of Object.entries(INSTANTS)) {
        const back = await Moment.findOne({ where: { label } });

        expect(back.at).toBeInstanceOf(Date);
        expect(back.at.toISOString()).toBe(when.toISOString());
      }
    });

    await adapter.stop();
  });

  test('a date read back is the same instant a second time round', async () => {
    const { adapter } = build();

    adapter.addModel(MODEL);
    await adapter.start();

    const Moment = adapter.getModels().Moment;
    const when = INSTANTS.midnightAhead;

    await withProcessZone(AHEAD, () => Moment.create({ at: when, label: 'a' }));

    const first = await withProcessZone(BEHIND, () =>
      Moment.findOne({ where: { label: 'a' } })
    );

    await withProcessZone(AHEAD, () =>
      Moment.create({ at: first.at, label: 'b' })
    );

    const second = await withProcessZone(BEHIND, () =>
      Moment.findOne({ where: { label: 'b' } })
    );

    expect(second.at.toISOString()).toBe(when.toISOString());

    await adapter.stop();
  });

  test('sub-second precision is the dialect, and MySQL rounds it away', async () => {
    const { adapter } = build();

    adapter.addModel(MODEL);
    await adapter.start();

    const Moment = adapter.getModels().Moment;
    const when = new Date('2026-06-15T12:34:56.789Z');

    await withProcessZone(AHEAD, () =>
      Moment.create({ at: when, label: 'ms' })
    );

    const back = await withProcessZone(BEHIND, () =>
      Moment.findOne({ where: { label: 'ms' } })
    );

    // Whatever the dialect keeps, the second is right and the zone is
    // right: the truncation is downwards within the same second
    expect(Math.floor(back.at.getTime() / 1000)).toBe(
      Math.floor(when.getTime() / 1000)
    );

    // `DATETIME` with no length is `DATETIME(0)` on MySQL. Every other
    // dialect this adapter reaches keeps the milliseconds
    expect(back.at.getMilliseconds()).toBe(
      target.name === 'mysql' ? 0 : when.getMilliseconds()
    );

    await adapter.stop();
  });

  afterAll(() => target.cleanup());
});
