const { MongoMemoryServer } = require('mongodb-memory-server');
const Mongoose = require('../index');

/**
 * Storage is UTC, and it is not negotiable.
 *
 * The same guarantee `packages/drizzle/__tests__/time-zone.spec.js` holds,
 * on the adapter that stores a BSON date: a moment written through a model
 * comes back the same moment, whatever zone the process was in when it was
 * written and whatever zone it is in when it is read. `config.timeZone` is
 * a presentation setting only because this is true.
 *
 * The process is pinned to the two awkward ones: `Pacific/Kiritimati` is
 * UTC+14 and `Pacific/Niue` is UTC-11, 25 hours apart, so an instant late
 * in a UTC day is on three different calendar days in the three zones.
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

/** The instants that break a framework that gets this wrong */
const INSTANTS = {
  fallBack: new Date('2026-11-01T05:30:00.000Z'),
  midnightAhead: new Date('2026-03-08T10:00:00.000Z'),
  // BSON keeps milliseconds, so this one carries them
  plain: new Date('2026-06-15T12:34:56.789Z'),
  springForward: new Date('2026-03-08T07:00:00.000Z'),
};

let mongod;

/**
 * A henri look-alike for the adapter
 *
 * @returns {object} the fake
 */
const fakeHenri = () => {
  const pen = {};

  ['error', 'fatal', 'info', 'warn'].forEach((level) => {
    pen[level] = () => {};
  });

  return {
    _user: null,
    config: { get: () => undefined, has: () => false },
    isTest: true,
    pen,
    user: { encrypt: async (password) => `hashed:${password}` },
  };
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

/**
 * A started adapter holding the model, on a database of its own
 *
 * @param {string} database the database name
 * @returns {Promise<object>} the adapter
 */
const started = async (database) => {
  const adapter = new Mongoose(
    'default',
    { url: mongod.getUri(database) },
    fakeHenri()
  );

  adapter.addModel(MODEL);
  await adapter.start();

  return adapter;
};

beforeAll(async () => {
  // A starting port of this worker's own, the way the adapter's own suite
  // picks one (see mongoose.spec.js): left to itself the library probes a
  // free port, closes the probe and launches mongod on it, so two workers
  // starting together land on the same one and the second dies
  const port = 20000 + ((process.pid * 4) % 7000) + 1;

  mongod = await MongoMemoryServer.create({ instance: { port } });
}, 120000);

afterAll(async () => {
  await mongod?.stop();
}, 60000);

describe('storage is UTC', () => {
  test('an instant survives being written and read in opposite zones', async () => {
    const adapter = await started('tz_round_trip');
    const Moment = adapter.getModels().Moment;

    await withProcessZone(AHEAD, async () => {
      for (const [label, when] of Object.entries(INSTANTS)) {
        await Moment.create({ at: when, label });
      }
    });

    await withProcessZone(BEHIND, async () => {
      for (const [label, when] of Object.entries(INSTANTS)) {
        const back = await Moment.findOne({ label });

        expect(back.at).toBeInstanceOf(Date);
        expect(back.at.toISOString()).toBe(when.toISOString());
      }
    });

    await adapter.stop();
  });

  test('a BSON date is epoch milliseconds, which carries no zone at all', async () => {
    const adapter = await started('tz_raw');
    const Moment = adapter.getModels().Moment;
    const when = INSTANTS.plain;

    await withProcessZone(AHEAD, () => Moment.create({ at: when, label: 'a' }));

    const raw = await withProcessZone(BEHIND, () =>
      Moment.collection.findOne({ label: 'a' })
    );

    expect(raw.at).toBeInstanceOf(Date);
    expect(raw.at.getTime()).toBe(when.getTime());

    await adapter.stop();
  });

  test('the process zone does not decide what a comparison matches', async () => {
    const adapter = await started('tz_compare');
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

    for (const zone of [AHEAD, BEHIND, 'UTC']) {
      await withProcessZone(zone, async () => {
        const older = await Moment.find({ at: { $lt: cutoff } });

        expect(older.map((row) => row.label)).toEqual(['before']);
      });
    }

    await adapter.stop();
  });
});
