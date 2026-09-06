/* global Artwork */
const path = require('path');
const supertest = require('supertest');

const Henri = require('../henri');
const { build } = require('../base/openapi');
const { expand } = require('../base/routes');
const { loadModules } = require('../utils');
const { RESERVED: HOOK_KEYS } = require('../base/hooks');
const { RESERVED: PARAM_KEYS, declarations } = require('../base/params-schema');

const demo = path.resolve(__dirname, '..', '..', '..', 'demo');
const reserved = new Set([...HOOK_KEYS, ...PARAM_KEYS, 'globalId', 'identity']);

/**
 * The document of the demo application, built from its files the way
 * `henri openapi` builds it: the actions the controllers export and the
 * `params` each of them declared, compiled by the same `declarations()` the
 * boot compiles them with
 *
 * @returns {object} the document
 */
const describeDemo = () => {
  const controllers = loadModules(path.join(demo, 'app', 'controllers'), {
    keepDirectoryPath: true,
  });
  const accepts = {};
  const actions = {};

  for (const controller of Object.values(controllers)) {
    const names = Object.keys(controller).filter(
      (key) => !reserved.has(key) && typeof controller[key] === 'function'
    );
    const rules = declarations(controller, controller.identity, names);

    for (const action of names) {
      actions[`${controller.identity}#${action}`] = true;
      accepts[`${controller.identity}#${action}`] = rules[action] || {};
    }
  }

  return build({
    accepts,
    actions,
    config: require(path.join(demo, 'config', 'default.json')),
    info: { title: 'demo', version: '1.0.0' },
    models: Object.values(loadModules(path.join(demo, 'app', 'models'))),
    policies: Object.keys(loadModules(path.join(demo, 'app', 'policies'))),
    routes: expand(require(path.join(demo, 'app', 'routes.js'))),
  });
};

/**
 * Every `$ref` of a document, with the path it sits at
 *
 * @param {*} value the document (or a part of it)
 * @param {string} [where=''] where it sits
 * @param {Array<Array<string>>} [found=[]] the accumulator
 * @returns {Array<Array<string>>} `[[ref, where], ...]`
 */
const refsOf = (value, where = '', found = []) => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => refsOf(entry, `${where}/${index}`, found));

    return found;
  }

  if (!value || typeof value !== 'object') {
    return found;
  }

  for (const key of Object.keys(value)) {
    if (key === '$ref' && typeof value[key] === 'string') {
      found.push([value[key], where]);
    } else {
      refsOf(value[key], `${where}/${key}`, found);
    }
  }

  return found;
};

/**
 * Follows a `#/a/b` pointer
 *
 * @param {object} document the document
 * @param {string} ref the pointer
 * @returns {*} what it names, or undefined
 */
const resolve = (document, ref) =>
  ref
    .replace(/^#\//u, '')
    .split('/')
    .reduce(
      (current, part) =>
        current ? current[decodeURIComponent(part)] : undefined,
      document
    );

/**
 * Every operation of a document
 *
 * @param {object} document the document
 * @returns {Array<object>} `[{ operation, route, verb }]`
 */
const operationsOf = (document) =>
  Object.entries(document.paths).flatMap(([route, item]) =>
    Object.entries(item).map(([verb, operation]) => ({
      operation,
      route,
      verb,
    }))
  );

describe('the OpenAPI description', () => {
  let document;
  let validate;

  beforeAll(async () => {
    const { Validator } = await import('@seriousme/openapi-schema-validator');

    validate = (candidate) => new Validator().validate(candidate);
    document = describeDemo();
  });

  test('the demo application describes as a valid OpenAPI 3.1 document', async () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.jsonSchemaDialect).toBe(
      'https://json-schema.org/draft/2020-12/schema'
    );
    expect(await validate(document)).toEqual({ valid: true });
  });

  test('every $ref resolves', () => {
    const dangling = refsOf(document)
      .filter(([ref]) => typeof resolve(document, ref) === 'undefined')
      .map(([ref, where]) => `${ref} (${where})`);

    expect(dangling).toEqual([]);
  });

  test('operation ids are unique', () => {
    const ids = operationsOf(document).map(
      ({ operation }) => operation.operationId
    );

    expect(ids).toHaveLength(new Set(ids).size);
  });

  test('every path variable is a declared parameter, and the reverse', () => {
    for (const { operation, route, verb } of operationsOf(document)) {
      const wanted = [...route.matchAll(/\{([^}]+)\}/gu)].map(
        (match) => match[1]
      );
      const declared = (operation.parameters || [])
        .map((parameter) =>
          parameter.$ref ? resolve(document, parameter.$ref) : parameter
        )
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) => parameter.name);

      expect([`${verb} ${route}`, declared.sort()]).toEqual([
        `${verb} ${route}`,
        wanted.sort(),
      ]);
    }
  });

  test('no operation declares the same parameter twice', () => {
    for (const { operation, route, verb } of operationsOf(document)) {
      const seen = (operation.parameters || [])
        .map((parameter) =>
          parameter.$ref ? resolve(document, parameter.$ref) : parameter
        )
        .map((parameter) => `${parameter.in} ${parameter.name}`);

      expect([`${verb} ${route}`, seen.length]).toEqual([
        `${verb} ${route}`,
        new Set(seen).size,
      ]);
    }
  });

  test('every operation says whether henri knows what it answers', () => {
    for (const { operation, route, verb } of operationsOf(document)) {
      const marks = operation['x-henri'];

      expect([`${verb} ${route}`, typeof marks]).toEqual([
        `${verb} ${route}`,
        'object',
      ]);
      expect(typeof marks.known).toBe('boolean');
      expect(operation.description.length).toBeGreaterThan(40);
    }
  });

  describe('what henri knows', () => {
    test('a resources route answers the HAL envelope of its model', () => {
      const index = document.paths['/api/v1/artworks'].get;

      expect(index['x-henri']).toMatchObject({
        answer: 'collection',
        controller: 'artworks',
        known: true,
        model: 'Artwork',
        source: 'resources',
        version: 'v1',
      });
      // Both shapes a route henri guards can answer, HAL first
      const [hal, rendered] =
        index.responses['200'].content['application/hal+json'].schema.anyOf;

      expect(hal.allOf).toEqual([
        { $ref: '#/components/schemas/ArtworkCollection' },
      ]);
      expect(hal.properties._embedded.properties.artworks.items).toEqual({
        $ref: '#/components/schemas/ArtworkResource',
      });
      expect(rendered).toEqual({
        $ref: '#/components/schemas/RenderedPage',
      });
      expect(index.responses['406']).toEqual({
        $ref: '#/components/responses/NotAcceptable',
      });
      expect(index.parameters).toContainEqual({
        $ref: '#/components/parameters/Page',
      });
    });

    test('a model schema carries the columns the adapters add, typed', () => {
      const { properties } = document.components.schemas.Artwork;

      expect(properties.externalId).toMatchObject({
        format: 'uuid',
        type: 'string',
      });
      expect(properties.createdAt).toMatchObject({
        format: 'date-time',
        type: 'string',
      });
      expect(properties.year).toEqual({ type: ['integer', 'null'] });
    });

    test('a declared foreign key is the public id of the row it names', () => {
      expect(document.components.schemas.Memo.properties.ownerId).toMatchObject(
        { format: 'uuid', type: ['string', 'null'] }
      );
      // What a request may send for it is the controller's decision
      expect(
        document.components.schemas.MemoInput.properties.ownerId.type
      ).toBeUndefined();
    });

    test('a field marked personal: { expose: false } is in no schema', () => {
      const names = JSON.stringify(document.components.schemas);

      // The demo's User marks `gender` expose: false, and the password is
      // never exposed by any answer henri builds
      expect(
        document.components.schemas.User.properties.gender
      ).toBeUndefined();
      expect(
        document.components.schemas.User.properties.password
      ).toBeUndefined();
      expect(names).not.toContain('"gender"');
    });

    test('the guards of a route become the statuses it can answer', () => {
      const admin = document.paths['/admin'].get;

      expect(admin['x-henri'].roles).toEqual(['admin']);
      expect(admin.responses['401']).toBeDefined();
      expect(admin.responses['403']).toBeDefined();
      expect(admin.security).toEqual([{ session: [] }, { bearer: [] }]);

      // A policy that does not exist refuses every request, and says so
      expect(document.paths['/ghost'].get.description).toContain(
        'there is no such file in app/policies'
      );
      expect(document.paths['/ghost'].get['x-henri'].policy).toBe(false);
    });

    test('a mutating route takes Idempotency-Key unless it opted out', () => {
      const key = { $ref: '#/components/parameters/IdempotencyKey' };

      expect(document.paths['/once'].post.parameters).toContainEqual(key);
      expect(document.paths['/echo'].post.parameters).not.toContainEqual(key);
      expect(document.paths['/echo'].post.responses['409']).toBeUndefined();
    });

    test('a GET declaring its parameters answers 422, and says so', () => {
      // The check is registered whatever the verb (5.router.js), so a GET
      // with a declaration refuses `?limit=banana` -- which is what the
      // document used to deny by tying 422 to the idempotency of a
      // mutating route
      const search = document.paths['/notes/search'].get;
      const named = Object.fromEntries(
        search.parameters.map((parameter) => [parameter.name, parameter])
      );

      expect(search.responses['422']).toEqual({
        $ref: '#/components/responses/InvalidParameters',
      });
      expect(search['x-henri'].params).toEqual({
        fields: ['exact', 'limit', 'q'],
      });
      expect(search['x-henri'].enforced).toEqual(['params']);
      expect(named.limit.schema).toEqual({
        default: 10,
        maximum: 50,
        minimum: 1,
        type: 'integer',
      });
      expect(named.q.schema).toEqual({ maxLength: 60, type: 'string' });
      expect(named.exact.schema).toEqual({ default: false, type: 'boolean' });
      expect(named.limit.required).toBe(false);
    });

    test('a mutating route names both 422s it can answer', () => {
      // `notes#create` declares `title` and the route honours
      // Idempotency-Key: two different failures, one status
      const create = document.paths['/notes'].post;
      const schema = create.requestBody.content['application/json'].schema;

      expect(create.responses['422']).toEqual({
        $ref: '#/components/responses/UnprocessableEntity',
      });
      expect(
        document.components.responses.UnprocessableEntity.description
      ).toContain('HENRI_PARAMS_INVALID');
      expect(schema.properties.title).toEqual({
        maxLength: 40,
        type: 'string',
      });
      expect(schema.required).toEqual(['title']);
      // Open on purpose: an undeclared key is dropped, not refused
      expect(schema.additionalProperties).toBe(true);
      expect(create.requestBody.required).toBe(true);
      expect(create['x-henri'].enforced).toEqual(['_links', 'params']);
    });

    test('a route with no declaration keeps the idempotency 422 alone', () => {
      expect(document.paths['/once'].post.responses['422']).toEqual({
        $ref: '#/components/responses/IdempotencyMismatch',
      });
      expect(
        document.components.responses.IdempotencyMismatch.description
      ).not.toContain('params');
      // ... and one that opted out of idempotency answers no 422 at all
      expect(document.paths['/echo'].post.responses['422']).toBeUndefined();
      expect(document.paths['/echo'].post['x-henri'].params).toBeUndefined();
    });

    test('a declared page replaces the paging parameter, never doubles it', () => {
      const declared = build({
        accepts: { 'tasks#index': { page: { min: 1, type: 'integer' } } },
        actions: { 'tasks#index': true },
        models: [],
        routes: expand({ 'resources tasks': { only: ['index'] } }),
      });
      const index = declared.paths['/tasks'].get;
      const names = index.parameters.map(
        (parameter) => parameter.name || parameter.$ref
      );

      expect(names).toEqual(['page', '#/components/parameters/PerPage']);
      expect(index.parameters[0].schema).toEqual({
        minimum: 1,
        type: 'integer',
      });
    });

    test('the endpoints henri mounts itself are described exactly', () => {
      const login = document.paths['/login'].post;

      expect(login['x-henri'].source).toBe('built-in');
      expect(login.responses['200'].content['application/json'].schema).toEqual(
        {
          properties: { user: { $ref: '#/components/schemas/PublicUser' } },
          required: ['user'],
          type: 'object',
        }
      );
      expect(document.paths['/logout'].get.responses['405']).toBeDefined();
      expect(document.paths['/signup'].post).toBeDefined();
      expect(document.paths['/password/reset/{token}'].get).toBeDefined();
      expect(document.paths['/livez'].get).toBeDefined();
      expect(document.paths['/readyz'].get.responses['503']).toBeDefined();
    });

    test('the identity endpoints say which provider and what a refusal means', () => {
      const start = document.paths['/auth/{provider}'].post;
      const callback = document.paths['/auth/{provider}/callback'].get;

      expect(start['x-henri'].source).toBe('built-in');
      expect(start.parameters[0]).toMatchObject({
        in: 'path',
        name: 'provider',
        schema: { enum: ['acme', 'other'], type: 'string' },
      });
      // A GET on the start endpoint is the 405 the router answers, so the
      // document describes the POST and nothing else there
      expect(document.paths['/auth/{provider}'].get).toBeUndefined();
      expect(callback.responses['409'].description).toContain('exists');
      expect(
        callback.responses['200'].content['application/json'].schema.properties
          .identity.properties.subject
      ).toBeUndefined();
      expect(document.paths['/auth/{provider}/unlink'].post).toBeDefined();
    });
  });

  describe('what henri does not know', () => {
    test('a hand-written route declares no success status at all', () => {
      const version = document.paths['/version'].get;

      expect(version['x-henri'].known).toBe(false);
      expect(version['x-henri'].answer).toBe('unknown');
      expect(Object.keys(version.responses)).toEqual(['429', 'default']);
      expect(version.responses.default.description).toContain('Not described');
      expect(
        version.responses.default.content['application/json'].schema
      ).toEqual({});
    });

    test('a member route of a resource is not described either', () => {
      expect(document.paths['/memos/{id}/peek'].get['x-henri']).toMatchObject({
        answer: 'unknown',
        known: false,
      });
    });

    test('a form page says both shapes rather than choosing one', () => {
      const form = document.paths['/api/v1/artworks/new'].get;

      expect(form['x-henri']).toMatchObject({
        answer: 'page',
        enforced: ['_links'],
        known: false,
      });
      expect(
        form.responses['200'].content['application/json'].schema.anyOf
      ).toEqual([
        { $ref: '#/components/schemas/RenderedPage' },
        { $ref: '#/components/schemas/HalResource' },
      ]);
      expect(form.responses['200'].content['text/html']).toEqual({});
    });

    test('nothing is required of a model in an answer', () => {
      for (const name of ['Artwork', 'Memo', 'User']) {
        const schema = document.components.schemas[name];

        expect([name, schema.required]).toEqual([name, undefined]);
        expect([name, schema.additionalProperties]).toEqual([name, true]);
      }
    });

    test('a controller with no such action is named as one', () => {
      const missing = build({
        actions: { 'tasks#index': true },
        models: [],
        routes: expand({ 'get /nope': 'tasks#nope' }),
      });
      const operation = missing.paths['/nope'].get;

      expect(operation['x-henri'].known).toBe(false);
      expect(operation.description).toContain('**No such action.**');
      expect(operation.responses.default.description).toContain(
        '501 in development'
      );
    });

    test('a declaration it could not read is named, not invented', () => {
      // The one case where the two ways of building the document differ: a
      // controller `henri openapi` could not load. It says so rather than
      // describing the action as accepting nothing
      const blind = build({
        accepts: { 'tasks#index': null },
        actions: { 'tasks#index': true },
        models: [],
        routes: expand({ 'resources tasks': { only: ['index'] } }),
      });
      const index = blind.paths['/tasks'].get;

      expect(index['x-henri'].params).toEqual({ read: false });
      expect(index.responses['422']).toBeUndefined();
      expect(index.description).toContain('could not read the `params`');
      expect(blind.info['x-henri'].params).toEqual({
        unread: ['tasks#index'],
      });
      // ... and a caller that passed no declarations at all is in the same
      // position for every operation
      expect(
        build({
          actions: { 'tasks#index': true },
          models: [],
          routes: expand({ 'resources tasks': { only: ['index'] } }),
        }).paths['/tasks'].get['x-henri'].params
      ).toEqual({ read: false });
    });

    test('the demo document read every declaration it needed', () => {
      expect(document.info['x-henri'].params).toBeUndefined();
    });

    test('the coverage says how much of the document was derived', () => {
      const { coverage } = document.info['x-henri'];

      expect(coverage.described + coverage.unknown).toBe(coverage.operations);
      expect(coverage.described).toBeGreaterThan(0);
      expect(coverage.unknown).toBeGreaterThan(0);
    });
  });

  describe('against the running application', () => {
    const skipWorkers = process.env.SKIP_WORKERS;
    let henri;
    let request;
    let live;

    beforeAll(async () => {
      process.env.SKIP_WORKERS = '1';
      henri = new Henri();
      await henri.init();
      global.henri = henri;
      request = supertest(henri.server.app);
      live = henri.router.describe();
    }, 60000);

    afterAll(async () => {
      await henri.stop();
      delete global.henri;

      if (typeof skipWorkers === 'undefined') {
        delete process.env.SKIP_WORKERS;
      } else {
        process.env.SKIP_WORKERS = skipWorkers;
      }
    }, 60000);

    test('the booted router describes the same surface as the files', async () => {
      expect(await validate(live)).toEqual({ valid: true });
      expect(Object.keys(live.paths).sort()).toEqual(
        Object.keys(document.paths).sort()
      );
    });

    test('both ways of building it read the same declarations', () => {
      // The compiled rules of a booted application and the ones
      // `henri openapi` compiles from the files are the same rules: the
      // parameters, the request bodies and the 422s they produce have to
      // match operation for operation, or one of the two documents is lying
      for (const { operation, route, verb } of operationsOf(document)) {
        const other = (live.paths[route] || {})[verb] || {};
        const where = `${verb} ${route}`;

        expect([where, other['x-henri'] && other['x-henri'].params]).toEqual([
          where,
          operation['x-henri'].params,
        ]);
        expect([where, other.responses && other.responses['422']]).toEqual([
          where,
          operation.responses['422'],
        ]);
        expect([where, other.parameters]).toEqual([
          where,
          operation.parameters,
        ]);
        expect([where, other.requestBody]).toEqual([
          where,
          operation.requestBody,
        ]);
      }
    });

    test('a GET refuses what the document says it refuses', async () => {
      const described = live.paths['/notes/search'].get;
      const answer = await request
        .get('/notes/search?limit=banana')
        .set('Accept', 'application/json');

      expect(answer.status).toBe(422);
      expect(described.responses['422']).toEqual({
        $ref: '#/components/responses/InvalidParameters',
      });
      expect(live.components.responses.InvalidParameters.description).toContain(
        'HENRI_PARAMS_INVALID'
      );
      expect(answer.body.code).toBe('HENRI_PARAMS_INVALID');
      expect(Object.keys(answer.body.data.errors)).toEqual(['limit']);

      // ... and accepts what it says it accepts, in the shape it declared
      const ok = await request
        .get('/notes/search?limit=2&exact=true')
        .set('Accept', 'application/json');

      expect(ok.status).toBe(200);
    });

    test('a mutating route refuses a body the document declared', async () => {
      const described = live.paths['/notes'].post;
      const body = described.requestBody.content['application/json'].schema;
      const answer = await request
        .post('/notes')
        .set('Accept', 'application/json')
        .send({ title: 'x'.repeat(body.properties.title.maxLength + 1) });

      expect(answer.status).toBe(422);
      expect(described.responses['422']).toEqual({
        $ref: '#/components/responses/UnprocessableEntity',
      });
      expect(answer.body.code).toBe('HENRI_PARAMS_INVALID');

      // The schema says `title` is required, and so does the application
      const missing = await request
        .post('/notes')
        .set('Accept', 'application/json')
        .send({});

      expect(body.required).toEqual(['title']);
      expect(missing.status).toBe(422);
      expect(Object.keys(missing.body.data.errors)).toEqual(['title']);
    });

    test('a described collection answers what the document says', async () => {
      await Artwork.create({ title: 'Nighthawks', year: 1942 });

      const answer = await request
        .get('/api/v1/artworks')
        .set('Accept', 'application/hal+json');
      const described = live.paths['/api/v1/artworks'].get;

      expect(described.responses[String(answer.status)]).toBeDefined();
      expect(answer.headers['content-type']).toContain('application/hal+json');
      expect(answer.headers['x-request-id']).toBeDefined();
      expect(answer.headers['x-total-count']).toBeDefined();
      expect(Object.keys(answer.body)).toEqual(
        expect.arrayContaining(['_embedded', '_links', 'count'])
      );
      expect(answer.body._embedded.artworks[0].externalId).toMatch(
        /^[0-9a-f-]{36}$/u
      );
    });

    test('a described failure answers the envelope the document names', async () => {
      const answer = await request
        .get('/admin')
        .set('Accept', 'application/json');
      const described = live.paths['/admin'].get;

      expect(answer.status).toBe(401);
      expect(described.responses['401']).toBeDefined();
      expect(Object.keys(answer.body).sort()).toEqual([
        'error',
        'message',
        'statusCode',
      ]);
    });

    test('a version guard answers the 406 the document declares', async () => {
      const answer = await request
        .get('/api/v1/artworks')
        .set('Accept', 'application/vnd.henri.v2+json');

      expect(answer.status).toBe(406);
      expect(live.paths['/api/v1/artworks'].get.responses['406']).toBeDefined();
      expect(answer.body.statusCode).toBe(406);
    });
  });
});
