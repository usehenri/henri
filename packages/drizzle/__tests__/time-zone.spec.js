const { build, target } = require('./helpers');

/**
 * Storage is UTC, and it is not negotiable.
 *
 * The guarantee this file exists to hold: a moment written through a model
 * comes back the same moment, whatever zone the process is in when it is
 * written and whatever zone it is in when it is read. That is what makes
 * `config.timeZone` a presentation setting -- if the stored value moved
 * with the deployment there would be nothing to present.
 *
 * The process is pinned to the two awkward ones. `Pacific/Kiritimati` is
 * UTC+14, the furthest ahead there is, and `Pacific/Niue` is UTC-11: 25
 * hours apart, so an instant late in a UTC day is on three different
 * calendar days in the three zones. A driver that serializes a local wall
 * clock instead of an instant shows up here as a whole day.
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

/**
 * The instants that break a framework that gets this wrong.
 *
 * `midnightAhead` is the off-by-one-day case: midnight on the 9th in
 * Kiritimati, still the 8th in UTC. `springForward` and `fallBack` are the
 * two sides of a DST transition in a zone that has one -- 2026-03-08 in
 * New York, where 02:00 does not exist, and 2026-11-01, where 01:30
 * happens twice. Stored as instants none of that is ambiguous, which is
 * the point.
 */
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

    // Written on the far side of the date line ...
    await withProcessZone(AHEAD, async () => {
      for (const [label, when] of Object.entries(INSTANTS)) {
        await Moment.create({ at: when, label });
      }
    });

    // ... and read from the other side of it, 25 hours away
    await withProcessZone(BEHIND, async () => {
      for (const [label, when] of Object.entries(INSTANTS)) {
        const back = await Moment.findOne({ label });

        expect(back.at).toBeInstanceOf(Date);
        expect(back.at.toISOString()).toBe(when.toISOString());
      }
    });

    await adapter.stop();
  });

  test('the process zone does not decide what a comparison matches', async () => {
    const { adapter } = build();

    adapter.addModel(MODEL);
    await adapter.start();

    const Moment = adapter.getModels().Moment;
    const cutoff = new Date('2026-03-08T10:00:00.000Z');

    await withProcessZone(AHEAD, async () => {
      await Moment.create({
        at: new Date('2026-03-08T09:59:59.000Z'),
        label: 'before',
      });
      await Moment.create({
        at: new Date('2026-03-08T10:00:01.000Z'),
        label: 'after',
      });
    });

    // The same range means the same thing in a zone a day behind: this is
    // what retention's cutoff and every `since` filter rest on
    for (const zone of [AHEAD, BEHIND, 'UTC']) {
      await withProcessZone(zone, async () => {
        const older = await Moment.findAll({ at: { $lt: cutoff } });

        expect(older.map((row) => row.label)).toEqual(['before']);
      });
    }

    await adapter.stop();
  });

  test('a date read back is the same instant a second time round', async () => {
    const { adapter } = build();

    adapter.addModel(MODEL);
    await adapter.start();

    const Moment = adapter.getModels().Moment;
    const when = INSTANTS.midnightAhead;

    await withProcessZone(AHEAD, () => Moment.create({ at: when, label: 'a' }));

    // Read in one zone, written back in another: a driver that renders a
    // local wall clock on the way out and parses it as UTC on the way in
    // loses a day here, and only here
    const first = await withProcessZone(BEHIND, () =>
      Moment.findOne({ label: 'a' })
    );

    await withProcessZone(AHEAD, () =>
      Moment.create({ at: first.at, label: 'b' })
    );

    const second = await withProcessZone(BEHIND, () =>
      Moment.findOne({ label: 'b' })
    );

    expect(second.at.toISOString()).toBe(when.toISOString());

    await adapter.stop();
  });

  test('the timestamps henri stamps itself are instants too', async () => {
    const { adapter } = build();

    adapter.addModel(MODEL);
    await adapter.start();

    const Moment = adapter.getModels().Moment;
    const before = Date.now();
    const made = await withProcessZone(AHEAD, () =>
      Moment.create({ at: INSTANTS.plain, label: 'stamped' })
    );
    const after = Date.now();

    // CreatedAt is a moment on this clock, not a wall clock 14 hours out
    expect(made.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(made.createdAt.getTime()).toBeLessThanOrEqual(after + 1000);

    await adapter.stop();
  });

  afterAll(() => target.cleanup());
});
