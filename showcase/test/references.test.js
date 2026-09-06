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
// This file truncates nothing. Every other suite calls `reset()` in its
// `beforeAll`, which is fine when what follows only reads its own rows;
// here the rows are the measurement, so the edition is one of this file's
// own and every request is filtered to it. Nothing another file left behind
// can change a count, and nothing this file writes can disturb one.
const { createProposal, createUser, request } = require('./helpers');

const HAL = 'application/hal+json';
const PAGE = 25;
const SPEAKERS = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Counts the statements the pool runs while `fn` does its work
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
        await createUser({
          email: `${unique}-speaker-${index}@example.test`,
          name: `Cost Speaker ${index}`,
        })
      );
    }

    for (let index = 0; index < PAGE; index += 1) {
      await createProposal({
        eventId: event.id,
        speakerId: speakers[index % SPEAKERS].id,
        state: 'submitted',
        title: `A proposal about the cost, number ${index}`,
        trackId: track.id,
      });
    }
  });

  afterAll(async () => {
    // Put the database back the way it was found: the next file resets what
    // it needs, and nothing here should be in its way
    await Proposal.withDeleted().destroy({
      force: true,
      where: { eventId: event.id },
    });
    await Track.destroy({ id: track.id });
    await Event.destroy({ id: event.id });
  });

  test('a page whose associations are loaded costs nothing extra', async () => {
    const url = `/proposals?event=${event.externalId}&per_page=${PAGE}`;
    const { answer, queries } = await counting(() =>
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

    // Four statements for the whole request -- the edition of the filter,
    // the page, its count and the editions of the form -- and not one of
    // them is a resolution: seventy five foreign keys came back for free
    expect(queries).toBe(4);
  });

  test('and one that loads nothing costs one statement per target model', async () => {
    const records = await Proposal.where({ eventId: event.id }).limit(PAGE);

    expect(records).toHaveLength(PAGE);
    // No `include`: the three references have to be resolved
    expect(records[0].event).toBeUndefined();

    const { answer, queries } = await counting(() =>
      henri.model.publish(records)
    );

    expect(answer).toHaveLength(PAGE);
    expect(answer[0].eventId).toBe(event.externalId);
    expect(answer[0].trackId).toBe(track.externalId);
    expect(answer[0].speakerId).toMatch(UUID);

    // Three models pointed at, three statements -- not seventy five, and
    // not one per distinct key either: the six speakers are one `IN`
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
