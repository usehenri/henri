// The generated description against the running application.
//
// `henri openapi` writes a document from the routes, the models and the
// configuration; this suite builds the same document from the booted router
// and then calls the application and checks that what came back is what the
// document said -- the status, the shape and the headers. A document that
// describes an answer henri does not give is worse than no document, so a
// disagreement is a failure here, not a note.
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const { create, request, reset, signIn } = require('./helpers');

const HAL = 'application/hal+json';
const ABSTRACT =
  'An abstract for the description tests, comfortably longer than the sixty characters the model insists on.';

describe('the OpenAPI description of the showcase', () => {
  let document;
  let speaker;
  let event;
  let submitted;
  let compile;

  beforeAll(async () => {
    document = henri.router.describe();

    const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));

    /**
     * A validator for one schema of the document, with the components it
     * refers to in scope
     *
     * @param {object} schema A schema, or a `$ref` to one
     * @returns {function} The ajv validator
     */
    compile = (schema) =>
      ajv.compile({
        ...schema,
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        components: document.components,
      });

    await reset();
    speaker = await create('user', {
      company: 'Fathom',
      email: 'openapi-speaker@example.test',
      name: 'Doc Speaker',
      phone: '555-0100',
    });
    event = await create('event', { name: 'Doc Conf' });
    submitted = await create('proposal', 'submitted', {
      eventId: event.id,
      speakerId: speaker.id,
      title: 'A proposal the description describes',
    });
  });

  test('is a valid OpenAPI 3.1 document', async () => {
    const { Validator } = await import('@seriousme/openapi-schema-validator');

    expect(document.openapi).toBe('3.1.0');
    expect(await new Validator().validate(document)).toEqual({ valid: true });
  });

  test('says what it could not describe, and how much', () => {
    const { coverage } = document.info['x-henri'];

    expect(coverage.described + coverage.unknown).toBe(coverage.operations);
    // The member routes and the pages: henri writes none of those bodies
    expect(document.paths['/proposals/{id}/submit'].post['x-henri']).toEqual(
      expect.objectContaining({ answer: 'unknown', known: false })
    );
    expect(
      document.paths['/proposals/{id}/submit'].post.responses['200']
    ).toBeUndefined();
  });

  test('never carries a field marked personal: { expose: false }', () => {
    const { schemas } = document.components;
    const records = ['Event', 'Proposal', 'Review', 'Track', 'User'];

    // `phone` is marked expose: false on User, and henri strips a hidden
    // name from every answer at every depth: it is in no schema at all
    expect(JSON.stringify(schemas)).not.toContain('"phone"');

    for (const name of records) {
      expect([name, schemas[name].properties.password]).toEqual([
        name,
        undefined,
      ]);
      expect([name, schemas[`${name}Input`].properties.password]).toEqual([
        name,
        undefined,
      ]);
    }

    // The password reaches exactly two places, and both are requests henri
    // reads itself
    expect(schemas.Credentials.properties.password).toBeDefined();
    expect(schemas.Registration.properties.password).toBeDefined();
  });

  describe('GET /proposals', () => {
    const route = '/proposals';

    test('answers the status, the shape and the headers the document names', async () => {
      const operation = document.paths[route].get;
      const answer = await request()
        .get(`${route}?per_page=5`)
        .set('Accept', HAL);

      // Status
      expect(operation.responses[String(answer.status)]).toBeDefined();
      expect(answer.status).toBe(200);

      // Headers
      const headers = operation.responses['200'].headers;

      expect(Object.keys(headers)).toEqual(
        expect.arrayContaining(['Link', 'X-Total-Count', 'X-Request-Id'])
      );
      expect(answer.headers['x-total-count']).toBeDefined();
      expect(answer.headers['x-request-id']).toBeDefined();
      expect(answer.headers.link).toBeDefined();
      expect(answer.headers['content-type']).toContain(HAL);

      // Shape: the HAL envelope, which is the first of the two the document
      // names for a route henri guards (the other is a rendered page)
      const [hal] = operation.responses['200'].content[HAL].schema.anyOf;
      const valid = compile(hal);

      expect([valid(answer.body), valid.errors]).toEqual([true, null]);
      expect(answer.body._embedded.proposals.length).toBeGreaterThan(0);
    });

    test('honours the page parameters the document declares', () => {
      const { parameters } = document.paths[route].get;
      const perPage = parameters
        .map((parameter) =>
          parameter.$ref
            ? document.components.parameters[parameter.$ref.split('/').pop()]
            : parameter
        )
        .find((parameter) => parameter.name === 'per_page');

      expect(perPage.schema.default).toBe(
        henri.api.settings.pagination.perPage
      );
      expect(perPage.schema.maximum).toBe(
        henri.api.settings.pagination.maxPerPage
      );
    });
  });

  describe('GET /proposals/{id}', () => {
    test('answers the resource the document describes', async () => {
      const operation = document.paths['/proposals/{id}'].get;
      const answer = await request()
        .get(`/proposals/${submitted.externalId}`)
        .set('Accept', HAL);

      expect(operation.responses[String(answer.status)]).toBeDefined();
      expect(answer.status).toBe(200);

      const [hal] = operation.responses['200'].content[HAL].schema.anyOf;
      const valid = compile(hal);

      expect([valid(answer.body), valid.errors]).toEqual([true, null]);
      // The path parameter is the public identifier, as the document says
      expect(
        operation.parameters.find((parameter) => parameter.name === 'id').schema
      ).toEqual({ format: 'uuid', type: 'string' });
      expect(answer.body.externalId).toBe(submitted.externalId);
      // And a declared foreign key left as the public id of the row it names
      expect(answer.body.eventId).toBe(event.externalId);
    });

    test('answers the error envelope the document names for an unknown id', async () => {
      const operation = document.paths['/proposals/{id}'].get;
      const answer = await request()
        .get('/proposals/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11')
        .set('Accept', HAL);

      expect(answer.status).toBe(404);
      expect(operation.responses['404']).toBeDefined();

      const valid = compile({ $ref: '#/components/schemas/Error' });

      expect([valid(answer.body), valid.errors]).toEqual([true, null]);
    });
  });

  describe('POST /proposals', () => {
    test('answers the 201 and the Location header the document declares', async () => {
      const operation = document.paths['/proposals'].post;
      const { browser, csrf } = await signIn(speaker);
      const answer = await browser
        .post('/proposals')
        .set('Accept', HAL)
        .set('X-CSRF-Token', csrf)
        .send({
          abstract: ABSTRACT,
          eventId: event.externalId,
          title: 'A proposal the document promised',
        });

      expect(answer.status).toBe(201);
      expect(operation.responses['201']).toBeDefined();
      expect(operation.responses['201'].headers.Location).toBeDefined();
      expect(answer.headers.location).toBe(
        `/proposals/${answer.body.externalId}`
      );

      const [hal] = operation.responses['201'].content[HAL].schema.anyOf;
      const valid = compile(hal);

      expect([valid(answer.body), valid.errors]).toEqual([true, null]);

      // The document declares the two headers this route reads
      expect(
        operation.parameters
          .filter((parameter) => parameter.$ref)
          .map((parameter) => parameter.$ref.split('/').pop())
      ).toEqual(expect.arrayContaining(['IdempotencyKey', 'CsrfToken']));
    });

    test('the request body it declares is what the action declared', () => {
      // The controller declares `params`, so the body is that -- what henri
      // itself checks -- rather than the writable columns of the model
      const schema =
        document.paths['/proposals'].post.requestBody.content[
          'application/json'
        ].schema;

      expect(Object.keys(schema.properties).sort()).toEqual([
        'abstract',
        'eventId',
        'title',
        'trackId',
      ]);
      expect(schema.properties.title).toEqual({
        maxLength: 120,
        type: 'string',
      });
      // Open, because an undeclared key is dropped rather than refused and
      // the action still permits the model's other columns by name
      expect(schema.additionalProperties).toBe(true);
      expect(schema.required).toBeUndefined();
    });

    test('the columns of the model are still described, untouched', () => {
      const input = document.components.schemas.ProposalInput;

      // The FIELDS of app/helpers/proposals.js
      for (const field of [
        'abstract',
        'eventId',
        'format',
        'level',
        'title',
        'trackId',
      ]) {
        expect(Object.keys(input.properties)).toContain(field);
      }
      // Nothing is required: the speaker is the session, never the body
      expect(input.required).toBeUndefined();
      expect(input.properties.speakerId.type).toBeUndefined();
    });
  });

  describe('what an action declared it accepts', () => {
    test('GET /proposals declares its filters and refuses what it says', async () => {
      const operation = document.paths['/proposals'].get;
      const named = Object.fromEntries(
        operation.parameters
          .filter((parameter) => !parameter.$ref)
          .map((parameter) => [parameter.name, parameter])
      );

      // A GET answers 422 -- the check is registered whatever the verb --
      // and the document says which 422 it is
      expect(operation.responses['422']).toEqual({
        $ref: '#/components/responses/InvalidParameters',
      });
      expect(named.state.schema).toEqual({
        enum: ['accepted', 'submitted'],
        type: 'string',
      });
      expect(named.event.schema).toEqual({ format: 'uuid', type: 'string' });
      expect(operation['x-henri'].params).toEqual({
        fields: ['event', 'state'],
      });
      expect(operation['x-henri'].enforced).toEqual(['_links', 'params']);

      // ... and the application answers exactly that
      const refused = await request()
        .get('/proposals?state=draft')
        .set('Accept', HAL);

      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('HENRI_PARAMS_INVALID');
      expect(Object.keys(refused.body.data.errors)).toEqual(['state']);

      const valid = compile({ $ref: '#/components/schemas/Error' });

      expect([valid(refused.body), valid.errors]).toEqual([true, null]);

      // The paging parameters are still there: the declaration names
      // neither, so neither is replaced
      expect(
        operation.parameters.filter((parameter) => parameter.$ref)
      ).toEqual([
        { $ref: '#/components/parameters/Page' },
        { $ref: '#/components/parameters/PerPage' },
      ]);
      expect((await request().get('/proposals?state=accepted')).status).toBe(
        200
      );
    });

    test('POST /proposals names both 422s it can answer, and answers both', async () => {
      const operation = document.paths['/proposals'].post;
      const { browser, csrf } = await signIn(speaker);

      // The route honours Idempotency-Key *and* the action declares
      // parameters: one status, two failures, and the component says so
      expect(operation.responses['422']).toEqual({
        $ref: '#/components/responses/UnprocessableEntity',
      });
      expect(
        document.components.responses.UnprocessableEntity.description
      ).toContain('HENRI_PARAMS_INVALID');

      const refused = await browser
        .post('/proposals')
        .set('Accept', HAL)
        .set('X-CSRF-Token', csrf)
        .send({ abstract: ABSTRACT, eventId: event.externalId, title: 42 });

      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('HENRI_PARAMS_INVALID');
      expect(Object.keys(refused.body.data.errors)).toEqual(['title']);

      const replayed = await browser
        .post('/proposals')
        .set('Accept', HAL)
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', 'the-document-key')
        .send({
          abstract: ABSTRACT,
          eventId: event.externalId,
          title: 'A proposal that takes the key',
        });
      const mismatch = await browser
        .post('/proposals')
        .set('Accept', HAL)
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', 'the-document-key')
        .send({
          abstract: ABSTRACT,
          eventId: event.externalId,
          title: 'Another proposal on the same key',
        });

      expect(replayed.status).toBe(201);
      expect(mismatch.status).toBe(422);
      expect(mismatch.body.code).not.toBe('HENRI_PARAMS_INVALID');
    });

    test('an action with no declaration says nothing about one', () => {
      // The admin controller declares no `params`, and the document does
      // not pretend it does
      const operation = document.paths['/admin/proposals'].get;

      expect(operation['x-henri'].params).toBeUndefined();
      expect(operation.responses['422']).toBeUndefined();
      // Nothing anywhere in this document went unread
      expect(document.info['x-henri'].params).toBeUndefined();
    });
  });

  describe('an action that renders instead of answering HAL', () => {
    test('answers the other shape the document names', async () => {
      // The implicit render: events#index returns an object and never
      // calls res.collection(), so the JSON of this guarded route is the
      // options the page is built from
      const operation = document.paths['/events'].get;
      const [hal, rendered] =
        operation.responses['200'].content[HAL].schema.anyOf;
      const answer = await request().get('/events').set('Accept', HAL);

      expect(rendered).toEqual({ $ref: '#/components/schemas/RenderedPage' });
      expect(answer.status).toBe(200);
      expect(answer.body._embedded).toBeUndefined();

      const asPage = compile(rendered);
      const asCollection = compile(hal);

      expect([asPage(answer.body), asPage.errors]).toEqual([true, null]);
      // And still the envelope henri enforces, which is why both are named
      expect(asCollection(answer.body)).toBe(true);
      expect(operation['x-henri'].enforced).toEqual(['_links']);
    });
  });

  describe('the guards', () => {
    test('a role guard answers the 401 the document declares', async () => {
      const operation = document.paths['/admin/proposals'].get;
      const answer = await request()
        .get('/admin/proposals')
        .set('Accept', 'application/json');

      expect(answer.status).toBe(401);
      expect(operation.responses['401']).toBeDefined();
      expect(operation.security).toEqual([{ session: [] }, { bearer: [] }]);

      const valid = compile({ $ref: '#/components/schemas/Error' });

      expect([valid(answer.body), valid.errors]).toEqual([true, null]);
    });

    test('the version guard answers the 406 the document declares', async () => {
      const answer = await request()
        .get('/proposals')
        .set('Accept', 'application/vnd.henri.v2+json');

      expect(answer.status).toBe(406);
      expect(document.paths['/proposals'].get.responses['406']).toBeDefined();

      const valid = compile({ $ref: '#/components/schemas/Error' });

      expect([valid(answer.body), valid.errors]).toEqual([true, null]);
    });
  });

  describe('the endpoints henri mounts itself', () => {
    test('POST /login answers the user the document describes', async () => {
      const operation = document.paths['/login'].post;
      const first = await request().get('/login').set('Accept', 'text/html');
      const csrf = decodeURIComponent(
        (first.headers['set-cookie'] || [])
          .find((cookie) => cookie.startsWith('henri.csrf='))
          .split('=')[1]
          .split(';')[0]
      );
      const answer = await request()
        .post('/login')
        .set('Accept', 'application/json')
        .set('Cookie', first.headers['set-cookie'])
        .send({
          _csrf: csrf,
          email: speaker.email,
          password: 'lineup-showcase',
        });

      expect(answer.status).toBe(200);

      const valid = compile(
        operation.responses['200'].content['application/json'].schema
      );

      expect([valid(answer.body), valid.errors]).toEqual([true, null]);
      expect(answer.body.user.phone).toBeUndefined();
    });

    test('GET /readyz answers the health body the document describes', async () => {
      const operation = document.paths['/readyz'].get;
      const answer = await request().get('/readyz');

      expect(operation.responses[String(answer.status)]).toBeDefined();

      const valid = compile(
        operation.responses[String(answer.status)].content['application/json']
          .schema
      );

      expect([valid(answer.body), valid.errors]).toEqual([true, null]);
    });

    test('GET /logout answers the 405 the document declares', async () => {
      const answer = await request()
        .get('/logout')
        .set('Accept', 'application/json');

      expect(answer.status).toBe(405);
      expect(answer.headers.allow).toBe('POST');
      expect(document.paths['/logout'].get.responses['405']).toBeDefined();
    });
  });
});
