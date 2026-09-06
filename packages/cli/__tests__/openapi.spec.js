const fs = require('fs');
const path = require('path');

const { cleanup, henri, read, scaffold } = require('./helpers');

describe('henri openapi', () => {
  let dir;
  let app;
  let validate;

  beforeAll(async () => {
    const { Validator } = await import('@seriousme/openapi-schema-validator');

    validate = (candidate) => new Validator().validate(candidate);
    ({ app, dir } = scaffold());
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('prints a valid OpenAPI 3.1 document without booting the app', async () => {
    const { status, stdout } = henri(['openapi'], { cwd: app });
    const document = JSON.parse(stdout);

    expect(status).toBe(0);
    expect(document.openapi).toBe('3.1.0');
    expect(await validate(document)).toEqual({ valid: true });
    expect(document.info.title).toBe('app');
    expect(Object.keys(document.paths)).toContain('/tasks');
    expect(document.components.schemas.Task).toBeDefined();
  });

  test('describes the scaffolded resource from its model and its routes', () => {
    const { stdout } = henri(['openapi'], { cwd: app });
    const document = JSON.parse(stdout);
    const index = document.paths['/tasks'].get;
    const create = document.paths['/tasks'].post;

    expect(index['x-henri']).toMatchObject({
      answer: 'collection',
      known: true,
      model: 'Task',
      source: 'resources',
    });
    expect(create.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/TaskInput',
    });
    expect(create.responses['201'].headers.Location).toBeDefined();
    // The scaffold has no user model, so henri mounts no session endpoints
    expect(document.paths['/login']).toBeUndefined();
    expect(document.paths['/livez']).toBeDefined();
  });

  describe('what a controller declared it accepts', () => {
    const controller = () => path.join(app, 'app', 'controllers', 'tasks.js');
    let original;

    beforeEach(() => {
      original = fs.readFileSync(controller(), 'utf8');
    });

    afterEach(() => {
      fs.writeFileSync(controller(), original);
    });

    /**
     * Adds a `params` export to the scaffolded controller
     *
     * @param {string} block The block, as source
     * @returns {object} The document `henri openapi` writes for it
     */
    const withParams = (block) => {
      fs.writeFileSync(
        controller(),
        original.replace('module.exports = {', `module.exports = {\n${block}\n`)
      );

      return JSON.parse(henri(['openapi'], { cwd: app }).stdout);
    };

    test('is read from the controller file, with no server and no database', () => {
      const document = withParams(
        `  params: {
    index: { q: { type: 'string', maxLength: 20 } },
    create: { title: { type: 'string', required: true } },
  },`
      );
      const index = document.paths['/tasks'].get;
      const create = document.paths['/tasks'].post;

      // A GET answers 422 as soon as it declares anything: the check is
      // registered whatever the verb
      expect(index.responses['422']).toEqual({
        $ref: '#/components/responses/InvalidParameters',
      });
      expect(index.parameters).toContainEqual(
        expect.objectContaining({
          in: 'query',
          name: 'q',
          required: false,
          schema: { maxLength: 20, type: 'string' },
        })
      );
      expect(index['x-henri'].params).toEqual({ fields: ['q'] });

      // A mutating route can answer 422 for two reasons, and says so
      expect(create.responses['422']).toEqual({
        $ref: '#/components/responses/UnprocessableEntity',
      });
      // The body is the declaration, not the model's writable columns
      expect(
        create.requestBody.content['application/json'].schema.properties
      ).toEqual({ title: { type: 'string' } });
      expect(
        create.requestBody.content['application/json'].schema.required
      ).toEqual(['title']);
    });

    test('says which declaration it could not read, and describes no parameters', async () => {
      const document = withParams(
        "  params: { index: { q: { type: 'nope' } } },"
      );
      const index = document.paths['/tasks'].get;

      // A declaration that would fail the boot is one this command could
      // not read: the operation says so rather than accepting everything
      expect(index['x-henri'].params).toEqual({ read: false });
      expect(index.responses['422']).toBeUndefined();
      expect(index.description).toContain('could not read the `params`');
      expect(document.info['x-henri'].params.unread).toContain('tasks#index');
      expect(await validate(document)).toEqual({ valid: true });

      const { stdout } = henri(['openapi', '--summary'], { cwd: app });

      expect(stdout).toContain('could not be read');
      expect(stdout).toContain('tasks#index');
    });

    test('a scaffolded application declares none, and nothing is invented', () => {
      const document = JSON.parse(henri(['openapi'], { cwd: app }).stdout);

      expect(document.info['x-henri'].params).toBeUndefined();
      expect(document.paths['/tasks'].get['x-henri'].params).toBeUndefined();
      expect(document.paths['/tasks'].get.responses['422']).toBeUndefined();
      expect(document.paths['/tasks'].post.responses['422']).toEqual({
        $ref: '#/components/responses/IdempotencyMismatch',
      });
    });
  });

  test('writes the document with --out and reports what it covers', () => {
    const { status, stdout } = henri(['openapi', '--out', 'openapi.json'], {
      cwd: app,
    });

    expect(status).toBe(0);
    expect(stdout).toContain('openapi.json written');
    expect(stdout).toContain('whose answer henri cannot know');
    expect(JSON.parse(read(app, 'openapi.json')).openapi).toBe('3.1.0');

    fs.rmSync(path.join(app, 'openapi.json'));
  });

  test('prints the coverage alone with --summary', () => {
    const { status, stdout } = henri(['openapi', '--summary'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain('OpenAPI 3.1.0 for app');
    expect(stdout).toContain('GET /  main#home');
    expect(stdout).not.toContain('"openapi"');
  });

  test('refuses to run outside of a project with exit code 3', () => {
    const { status } = henri(['openapi'], { cwd: dir });

    expect(status).toBe(3);
  });

  test('names the failure when --out cannot be written', () => {
    // A file cannot also be a directory: package.json is one
    const { status, stderr } = henri(
      ['openapi', '--out', 'package.json/openapi.json', '--json'],
      { cwd: app }
    );
    const { error } = JSON.parse(stderr);

    expect(status).toBe(1);
    expect(error.code).toBe('HENRI_API_DESCRIPTION_UNWRITABLE');
    expect(error.command).toBe('openapi');
    expect(error.hint).toContain('henri openapi > openapi.json');
  });

  test('--out without a file name is a usage error', () => {
    const { status, stderr } = henri(['openapi', '--out'], { cwd: app });

    expect(status).toBe(2);
    expect(stderr).toContain('--out needs a file name');
  });
});
