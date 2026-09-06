/* global Artwork */
const path = require('path');
const supertest = require('supertest');

const Henri = require('../henri');
const { build } = require('../base/openapi');
const { expand } = require('../base/routes');
const { loadModules } = require('../utils');

const demo = path.resolve(__dirname, '..', '..', '..', 'demo');

/**
 * The document of the demo application, built from its files the way
 * `henri openapi` builds it
 *
 * @returns {object} the document
 */
const describeDemo = () =>
  build({
    actions: Object.fromEntries(
      Object.entries(
        loadModules(path.join(demo, 'app', 'controllers'), {
          keepDirectoryPath: true,
        })
      ).flatMap(([, controller]) =>
        Object.keys(controller)
          .filter(
            (key) =>
              !['before', 'globalId', 'identity'].includes(key) &&
              typeof controller[key] === 'function'
          )
          .map((action) => [`${controller.identity}#${action}`, true])
      )
    ),
    config: require(path.join(demo, 'config', 'default.json')),
    info: { title: 'demo', version: '1.0.0' },
    models: Object.values(loadModules(path.join(demo, 'app', 'models'))),
    policies: Object.keys(loadModules(path.join(demo, 'app', 'policies'))),
    routes: expand(require(path.join(demo, 'app', 'routes.js'))),
  });

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
        enforced: '_links',
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
