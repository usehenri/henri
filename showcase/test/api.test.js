// The JSON API: HAL, pagination, Idempotency-Key, ETags and the versioned
// media type. The same routes serve the pages of the application.
const { create, request, reset, signIn } = require('./helpers');

const HAL = 'application/hal+json';

// The numbers this API is meant to carry: the paging counters, the year of
// an edition, the score of a review and how many there are. Everything else
// that is a number is a number nobody asked for, and a primary key that
// leaked would be among them whatever key it hid under.
const COUNTED = new Set([
  'count',
  'page',
  'pages',
  'perPage',
  'reviews',
  'score',
  'total',
  'year',
]);

/**
 * Every number, and every string of digits, anywhere in a JSON answer,
 * except the ones the API is documented to carry
 *
 * @param {*} value The answer
 * @param {Array} [found=[]] The accumulator
 * @returns {Array} The values
 */
const numbersIn = (value, found = []) => {
  if (typeof value === 'number') {
    found.push(value);
  } else if (typeof value === 'string' && /^\d+$/u.test(value)) {
    found.push(Number(value));
  } else if (Array.isArray(value)) {
    value.forEach((entry) => numbersIn(entry, found));
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (!COUNTED.has(key)) {
        numbersIn(value[key], found);
      }
    }
  }

  return found;
};
const ABSTRACT =
  'An abstract for the API tests, comfortably longer than the sixty characters the model insists on.';

describe('the JSON API', () => {
  let speaker;
  let admin;
  let event;
  let track;
  let submitted;

  beforeAll(async () => {
    await reset();

    speaker = await create('user', {
      company: 'Fathom',
      email: 'api-speaker@example.test',
      name: 'API Speaker',
    });
    admin = await create('user', 'admin', { email: 'api-admin@example.test' });
    event = await create('event', { name: 'API Conf' });
    track = await create('track', { eventId: event.id });

    for (let index = 0; index < 14; index += 1) {
      const proposal = await create('proposal', 'submitted', {
        eventId: event.id,
        speakerId: speaker.id,
        title: `An API proposal number ${index}`,
        trackId: track.id,
      });

      submitted = submitted || proposal;
    }
  });

  describe('a collection', () => {
    test('embeds the page and carries the paging links and counters', async () => {
      const answer = await request()
        .get('/proposals?per_page=5')
        .set('Accept', HAL);

      expect(answer.status).toBe(200);
      expect(answer.headers['content-type']).toContain(HAL);
      expect(answer.body._embedded.proposals).toHaveLength(5);
      expect(answer.body).toMatchObject({
        count: 5,
        page: 1,
        perPage: 5,
        total: 14,
      });
      expect(answer.body._links.self.href).toContain('/proposals?per_page=5');
      expect(answer.body._links.next.href).toContain('page=2');
      expect(answer.body._links.last.href).toContain('page=3');
      expect(answer.body._links.first).toBeTruthy();
      expect(answer.headers['x-total-count']).toBe('14');
      expect(answer.headers.link).toContain('rel="next"');
    });

    test('answers the second page with a prev link', async () => {
      const answer = await request()
        .get('/proposals?per_page=5&page=2')
        .set('Accept', HAL);

      expect(answer.body.page).toBe(2);
      expect(answer.body._links.prev.href).toContain('page=1');
      expect(answer.body._links.next.href).toContain('page=3');
    });

    test('caps per_page at config.api.maxPerPage', async () => {
      const answer = await request()
        .get('/proposals?per_page=5000')
        .set('Accept', HAL);

      expect(answer.body.perPage).toBe(50);
    });

    test('gives every item its own links', async () => {
      const answer = await request().get('/proposals').set('Accept', HAL);
      const [first] = answer.body._embedded.proposals;

      expect(first._links.self.href).toBe(`/proposals/${first.externalId}`);
      // The primary key is not in the payload and not in the link
      expect(first.id).toBeUndefined();
      expect(first.externalId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(first._links.collection.href).toBe('/proposals');
      // `except: ['destroy']` in config/routes.js: there is no such route,
      // so no client is ever offered the link
      expect(first._links.destroy).toBeUndefined();
    });

    test('is plain application/json for a client that does not ask for HAL', async () => {
      const answer = await request()
        .get('/proposals')
        .set('Accept', 'application/json');

      expect(answer.headers['content-type']).toContain('application/json');
      expect(answer.body._embedded).toBeTruthy();
    });
  });

  describe('a resource', () => {
    test('is the record plus its links', async () => {
      const answer = await request()
        .get(`/proposals/${submitted.externalId}`)
        .set('Accept', HAL);

      expect(answer.status).toBe(200);
      expect(answer.body).toMatchObject({
        externalId: submitted.externalId,
        state: 'submitted',
        title: submitted.title,
      });
      expect(answer.body.id).toBeUndefined();
      expect(answer.body._links.self.href).toBe(
        `/proposals/${submitted.externalId}`
      );
      expect(answer.body.speaker).toEqual({
        company: 'Fathom',
        externalId: speaker.externalId,
        name: 'API Speaker',
      });
      // The presenter drops it: an email never leaves the server this way
      expect(answer.body.speaker.email).toBeUndefined();
      // Every foreign key is the public identifier of the row it names.
      // henri does this on the way out, from what the model declared: the
      // controller neither deletes nor resolves anything
      expect(answer.body.eventId).toBe(event.externalId);
      expect(answer.body.trackId).toBe(track.externalId);
      expect(answer.body.speakerId).toBe(speaker.externalId);
    });

    test("carries no sequential id of any row, its own or another's", async () => {
      const answer = await request()
        .get(`/proposals/${submitted.externalId}`)
        .set('Accept', HAL);
      const body = JSON.stringify(answer.body);
      // Every primary key of every row this answer touches
      const keys = [submitted.id, speaker.id, event.id, track.id];

      expect(answer.status).toBe(200);

      // Every primary key is a number this answer must not hold
      expect(keys.every((key) => Number.isInteger(key) && key > 0)).toBe(true);
      expect(numbersIn(answer.body)).toEqual([]);

      for (const key of keys) {
        expect(body).not.toContain(`:${key},`);
        expect(body).not.toContain(`:"${key}"`);
      }

      expect(body).not.toMatch(/"(id|_id)":/u);
    });

    test('and neither does a whole page of them', async () => {
      const answer = await request()
        .get('/proposals?per_page=14')
        .set('Accept', HAL);
      const proposals = await Proposal.include('event', 'speaker', 'track')
        .order('-submittedAt', '-id')
        .limit(14);
      const keys = new Set();

      for (const proposal of proposals) {
        keys.add(proposal.id);
        keys.add(proposal.speakerId);
        keys.add(proposal.eventId);
        keys.add(proposal.trackId);
      }

      expect(answer.status).toBe(200);
      expect(keys.size).toBeGreaterThan(1);

      const seen = numbersIn(answer.body);

      for (const key of keys) {
        expect(seen).not.toContain(key);
      }

      // Nothing numeric at all is left in a page of proposals: the only
      // identifiers it carries are uuids
      expect(seen).toEqual([]);
    });

    test('a numeric id does not resolve, and says nothing when it fails', async () => {
      const byKey = await request()
        .get(`/proposals/${submitted.id}`)
        .set('Accept', HAL);
      const unknown = await request()
        .get('/proposals/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11')
        .set('Accept', HAL);

      expect(byKey.status).toBe(404);
      // The two failures are the same answer: nothing distinguishes "no
      // such row" from "not that kind of identifier"
      expect(byKey.status).toBe(unknown.status);
      expect(byKey.body.error).toBe(unknown.body.error);
      expect(byKey.body.statusCode).toBe(unknown.body.statusCode);
    });

    test('answers 404 for a record that is not there', async () => {
      const answer = await request()
        .get('/proposals/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11')
        .set('Accept', HAL);

      expect(answer.status).toBe(404);
      expect(answer.body).toMatchObject({
        error: 'Not Found',
        statusCode: 404,
      });
    });
  });

  describe('conditional requests', () => {
    test('a weak ETag and If-None-Match answer 304', async () => {
      const first = await request()
        .get(`/proposals/${submitted.externalId}`)
        .set('Accept', 'application/json');

      expect(first.headers.etag).toMatch(/^W\//);

      const second = await request()
        .get(`/proposals/${submitted.externalId}`)
        .set('Accept', 'application/json')
        .set('If-None-Match', first.headers.etag);

      expect(second.status).toBe(304);
      expect(second.text).toBeFalsy();
    });

    test('a changed record answers 200 with a new ETag', async () => {
      const first = await request()
        .get(`/proposals/${submitted.externalId}`)
        .set('Accept', 'application/json');

      await Proposal.findByIdAndUpdate(submitted.externalId, {
        title: 'A title that changed under the client',
      });

      const second = await request()
        .get(`/proposals/${submitted.externalId}`)
        .set('Accept', 'application/json')
        .set('If-None-Match', first.headers.etag);

      expect(second.status).toBe(200);
      expect(second.headers.etag).not.toBe(first.headers.etag);
    });
  });

  describe('the versioned media type', () => {
    test('serves the version the route declares', async () => {
      const answer = await request()
        .get('/proposals?per_page=1')
        .set('Accept', 'application/vnd.henri.v1+json');

      expect(answer.status).toBe(200);
      expect(answer.body._embedded.proposals).toHaveLength(1);
    });

    test('refuses another version with a 406', async () => {
      const answer = await request()
        .get('/proposals?per_page=1')
        .set('Accept', 'application/vnd.henri.v2+json');

      expect(answer.status).toBe(406);
      expect(answer.body).toMatchObject({
        data: { requested: 'v2', served: 'v1' },
        statusCode: 406,
      });
    });
  });

  describe('creating', () => {
    test('answers 201 with a Location header', async () => {
      const { browser, csrf } = await signIn(speaker);
      const answer = await browser
        .post('/proposals')
        .set('Accept', HAL)
        .set('X-CSRF-Token', csrf)
        .send({
          abstract: ABSTRACT,
          eventId: event.externalId,
          title: 'A proposal created over the API',
        });

      expect(answer.status).toBe(201);
      expect(answer.headers.location).toBe(
        `/proposals/${answer.body.externalId}`
      );
      expect(answer.body._links.self.href).toBe(
        `/proposals/${answer.body.externalId}`
      );
      // The edition was posted as a public id and resolved on the way in
      expect(answer.body.event.externalId).toBe(event.externalId);
    });

    describe('Idempotency-Key', () => {
      const body = {
        abstract: ABSTRACT,
        title: 'A proposal that was retried',
      };

      test('replays the first answer instead of writing twice', async () => {
        const { browser, csrf } = await signIn(speaker);
        const send = () =>
          browser
            .post('/proposals')
            .set('Accept', HAL)
            .set('X-CSRF-Token', csrf)
            .set('Idempotency-Key', 'the-same-key')
            .send({ ...body, eventId: event.externalId });

        const first = await send();

        expect(first.status).toBe(201);
        expect(first.headers['idempotency-replayed']).toBeUndefined();

        const second = await send();

        expect(second.status).toBe(201);
        expect(second.headers['idempotency-replayed']).toBe('true');
        expect(second.body.externalId).toBe(first.body.externalId);

        expect(await Proposal.count({ title: body.title })).toBe(1);
      });

      test('refuses the same key on a different request', async () => {
        const { browser, csrf } = await signIn(speaker);
        const answer = await browser
          .post('/proposals')
          .set('Accept', HAL)
          .set('X-CSRF-Token', csrf)
          .set('Idempotency-Key', 'the-same-key')
          .send({
            abstract: ABSTRACT,
            eventId: event.externalId,
            title: 'A different proposal entirely',
          });

        expect(answer.status).toBe(422);
        expect(answer.body.message).toMatch(/Idempotency-Key/);
      });

      test('is scoped to the user, so two of them may use one key', async () => {
        const other = await create('user', { email: 'api-other@example.test' });
        const { browser, csrf } = await signIn(other);
        const answer = await browser
          .post('/proposals')
          .set('Accept', HAL)
          .set('X-CSRF-Token', csrf)
          .set('Idempotency-Key', 'the-same-key')
          .send({
            abstract: ABSTRACT,
            eventId: event.externalId,
            title: 'Another speaker, the same key',
          });

        expect(answer.status).toBe(201);
        expect(answer.body.speaker.externalId).toBe(other.externalId);
      });
    });
  });

  describe('the nested reviews', () => {
    test('answer a HAL collection to the committee', async () => {
      const { browser, csrf } = await signIn(admin);

      await browser
        .post(`/proposals/${submitted.externalId}/reviews`)
        .set('Accept', HAL)
        .set('X-CSRF-Token', csrf)
        .send({ comment: 'A review long enough to pass.', score: 2 });

      const answer = await browser
        .get(`/proposals/${submitted.externalId}/reviews`)
        .set('Accept', HAL);

      expect(answer.status).toBe(200);
      expect(answer.body._embedded.reviews).toHaveLength(1);
      expect(answer.body._embedded.reviews[0]).toMatchObject({
        proposalId: submitted.externalId,
        score: 2,
      });
      expect(answer.body._links.proposal.href).toBe(
        `/proposals/${submitted.externalId}`
      );
      expect(answer.body.total).toBe(1);
    });
  });

  describe('the health check', () => {
    test('pings the store', async () => {
      const answer = await request()
        .get('/_henri/health')
        .set('Accept', 'application/json');

      expect(answer.status).toBe(200);
      expect(answer.body.status).toBe('ok');
      expect(answer.body.stores.default).toMatchObject({
        adapter: 'drizzle',
        ok: true,
      });
    });
  });
});
