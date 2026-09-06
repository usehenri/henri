// What a foreign key costs, measured against the real database.
//
// Every proposal points at three rows: a speaker, an edition and a track.
// Sending the public identifier of each means resolving it, and the naive
// shape of that is one query per key per record -- twenty five proposals
// would be seventy five statements. henri publishes one whole answer at a
// time: what an eager loaded association already holds is used (its primary
// key is compared against the key it stands in for, so the identity is
// checked rather than assumed) and whatever is left is asked for in one
// statement per target model.
//
// These are the numbers the guide quotes. A regression to N+1 fails here.
//
// ## Two counters, and they count different things
//
// This file used to monkey-patch the connection pool and count statements.
// It now asks `henri.queries` -- the seam the adapters report every model
// call to -- and keeps one statement counter beside it, because the two
// answer different questions and neither substitutes for the other:
//
// - `recording()` counts **model calls**: what the application asked for.
//   `Proposal.paginate()` is one, whatever SQL it compiles to. This is what
//   the N+1 detector counts and what `findings()` reports, and it is the
//   honest measure of "did this page loop over its records".
// - `counting()` counts **statements**: what the driver ran.
//   `Proposal.paginate()` is two. This is the number that catches the
//   adapter regressing, and it is deliberately kept for the one assertion
//   whose subject is the SQL -- that six repeated speaker keys are one `IN`
//   and not six lookups.
//
// A person reading "4 queries" would assume the second. Both are labelled.
//
// This file truncates nothing. Every other suite calls `reset()` in its
// `beforeAll`, which is fine when what follows only reads its own rows;
// here the rows are the measurement, so the edition is one of this file's
// own and every request is filtered to it. Nothing another file left behind
// can change a count, and nothing this file writes can disturb one.
const { create, request } = require('./helpers');

const HAL = 'application/hal+json';
const PAGE = 25;
const SPEAKERS = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Counts the **model calls** `fn` makes, through henri's own seam.
 *
 * No monkey patch: `onQuery()` is the documented way to hear about every
 * call, and what it reports is what the detector counts.
 *
 * @param {function} fn What to measure
 * @returns {Promise<{answer: *, calls: Array<object>}>} The result and the
 *   events, in order
 */
const recording = async (fn) => {
  const calls = [];

  henri.queries.onQuery((event) => calls.push(event));

  try {
    return { answer: await fn(), calls };
  } finally {
    henri.queries.onQuery(null);
  }
};

/**
 * The shapes that repeated, worst first: the detector's question, asked of a
 * list of events rather than of a request's own bucket.
 *
 * The detector runs server-side, inside the request, and keeps its count on
 * the request's AsyncLocalStorage; a test holding a list of events is on the
 * other side of the socket, so it groups them itself. The predicate is the
 * same one `Detector` uses -- the same `shape`, at least `threshold` times.
 *
 * @param {Array<object>} calls What `recording()` collected
 * @param {number} [threshold] How many repeats count as one
 * @returns {Array<object>} `{ shape, count, what }`, worst first
 */
const repeated = (calls, threshold = henri.queries.detector.threshold) => {
  const counts = new Map();

  for (const call of calls) {
    const seen = counts.get(call.shape) || {
      count: 0,
      shape: call.shape,
      what: `${call.model}.${call.method}`,
    };

    seen.count += 1;
    counts.set(call.shape, seen);
  }

  return [...counts.values()]
    .filter((one) => one.count >= threshold)
    .sort((one, two) => two.count - one.count);
};

/**
 * Counts the **statements** the pool runs while `fn` does its work.
 *
 * The one thing the seam cannot answer: it reports model calls, and the
 * subject of the assertion below is the SQL a model call compiles to.
 *
 * @param {function} fn What to measure
 * @returns {Promise<{answer: *, queries: number}>} The result and the count
 */
const counting = async (fn) => {
  const { client } = henri.model.stores.default;
  const original = client.query.bind(client);
  let queries = 0;

  client.query = (...args) => {
    queries += 1;

    return original(...args);
  };

  try {
    return { answer: await fn(), queries };
  } finally {
    client.query = original;
  }
};

describe('what a foreign key costs', () => {
  const unique = `cost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let event;
  let track;

  beforeAll(async () => {
    event = await Event.create({
      city: 'Testville',
      name: 'Cost Conf',
      slug: unique,
      state: 'open',
      year: 2026,
    });
    track = await Track.create({
      eventId: event.id,
      name: 'Cost',
      slug: unique,
    });

    // The fixtures have to be readable before anything points at them: a
    // foreign key violation two hundred rows later says nothing useful
    if (
      !(await Event.findByKey(event.id)) ||
      !(await Track.findByKey(track.id))
    ) {
      throw new Error('the fixtures of this file did not survive their insert');
    }

    // Six speakers over twenty five proposals: the keys repeat, which is
    // what deduplication inside one statement is for
    const speakers = [];

    for (let index = 0; index < SPEAKERS; index += 1) {
      speakers.push(
        await create('user', {
          email: `${unique}-speaker-${index}@example.test`,
          name: `Cost Speaker ${index}`,
        })
      );
    }

    for (let index = 0; index < PAGE; index += 1) {
      await create('proposal', 'submitted', {
        eventId: event.id,
        speakerId: speakers[index % SPEAKERS].id,
        title: `A proposal about the cost, number ${index}`,
        trackId: track.id,
      });
    }
  });

  afterAll(async () => {
    // Put the database back the way it was found: the next file resets what
    // it needs, and nothing here should be in its way
    // The condition is the first argument: a `where` inside the options was
    // read by nothing and this deleted every proposal in the database
    await Proposal.destroy({ eventId: event.id }, { force: true });
    await Track.destroy({ id: track.id });
    await Event.destroy({ id: event.id });
  });

  test('a page whose associations are loaded costs nothing extra', async () => {
    const url = `/proposals?event=${event.externalId}&per_page=${PAGE}`;
    const { answer, calls } = await recording(() =>
      request().get(url).set('Accept', HAL)
    );
    const records = answer.body._embedded.proposals;

    expect(answer.status).toBe(200);
    expect(records).toHaveLength(PAGE);

    // Every foreign key is a public identifier, and none of them was looked
    // up: `include: ['event', 'speaker', 'track']` already brought the rows
    for (const record of records) {
      expect(record.speakerId).toMatch(UUID);
      expect(record.eventId).toBe(event.externalId);
      expect(record.trackId).toBe(track.externalId);
    }

    // The assertion this file exists for, and the one nothing could make
    // before the seam: whatever the request cost, no call was repeated
    // enough times to be a loop over the records
    expect(repeated(calls)).toEqual([]);

    // Three model calls for the whole request -- the edition of the filter,
    // the page (a `paginate`, two statements and one decision) and the
    // editions of the form -- and not one of them is a resolution: seventy
    // five foreign keys came back for free
    expect(calls.map((call) => `${call.model}.${call.method}`)).toEqual([
      'Event.findById',
      'Proposal.paginate',
      'Event.toArray',
    ]);
  });

  test('and one that loads nothing costs one call per target model', async () => {
    const records = await Proposal.where({ eventId: event.id }).limit(PAGE);

    expect(records).toHaveLength(PAGE);
    // No `include`: the three references have to be resolved
    expect(records[0].event).toBeUndefined();

    const { answer, calls } = await recording(() =>
      henri.model.publish(records)
    );

    expect(answer).toHaveLength(PAGE);
    expect(answer[0].eventId).toBe(event.externalId);
    expect(answer[0].trackId).toBe(track.externalId);
    expect(answer[0].speakerId).toMatch(UUID);

    // Three models pointed at, three model calls -- not seventy five, and
    // not one per distinct key either
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.model).sort()).toEqual([
      'Event',
      'Track',
      'User',
    ]);
  });

  test('the six repeated speaker keys are one IN, and that is a statement count', async () => {
    const records = await Proposal.where({ eventId: event.id }).limit(PAGE);

    // The one assertion here whose subject is the SQL rather than the call:
    // deduplicating the keys happens inside a single model call, so only a
    // statement counter can see it. Three statements, not eight (the three
    // models plus the five extra distinct speakers)
    const { queries } = await counting(() => henri.model.publish(records));

    expect(queries).toBe(3);
  });

  test('a key that names no row is null, and never the number', async () => {
    const orphan = await Proposal.where({ eventId: event.id }).first();
    const gone = await Track.create({
      eventId: event.id,
      name: 'About to go',
      slug: `${unique}-gone`,
    });

    await orphan.update({ trackId: gone.id });
    await Track.destroy({ id: gone.id });

    const published = await henri.model.publish(
      await Proposal.findByKey(orphan.id)
    );

    expect(published.trackId).toBeNull();
    expect(JSON.stringify(published)).not.toContain(`:${gone.id},`);

    await orphan.update({ trackId: track.id });
  });
});
