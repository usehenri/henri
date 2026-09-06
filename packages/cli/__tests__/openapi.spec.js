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
