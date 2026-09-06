const fs = require('fs');
const path = require('path');

const { cleanup, henri, scaffold } = require('./helpers');

describe('henri graphql', () => {
  let dir;
  let app;
  let model;
  let original;

  beforeAll(() => {
    ({ app, dir } = scaffold());
    model = path.join(app, 'app', 'models', 'Task.js');
    original = fs.readFileSync(model, 'utf8');
  });

  afterAll(() => {
    cleanup(dir);
  });

  afterEach(() => {
    fs.writeFileSync(model, original);
  });

  /**
   * Writes a `graphql` key into the scaffolded model
   *
   * @param {string} declaration what the key holds, as source
   * @returns {void}
   */
  const declare = (declaration) =>
    fs.writeFileSync(
      model,
      original.replace(
        'module.exports = {',
        `module.exports = {\n  graphql: ${declaration},`
      )
    );

  test('says so when no model asks for a definition', () => {
    const { status, stdout } = henri(['graphql'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain('No model declares a `graphql` key');
  });

  test('prints the SDL derived from the schema, without booting', () => {
    declare('true');

    const { status, stdout } = henri(['graphql'], { cwd: app });

    expect(status).toBe(0);
    expect(stdout).toContain('type Task {');
    // The public identifier, and never the primary key
    expect(stdout).toContain('  id: ID!');
    expect(stdout).not.toContain('externalId');
    expect(stdout).toContain('  task(id: ID!): Task');
    expect(stdout).toContain('type TaskPage {');
    // Mutations are asked for, never assumed
    expect(stdout).not.toContain('type Mutation');
  });

  test('prints the mutations a model asks for', () => {
    declare('{ generate: true, mutations: true }');

    const { stdout } = henri(['graphql'], { cwd: app });

    expect(stdout).toContain('  createTask(input: TaskInput!): Task');
    expect(stdout).toContain('  deleteTask(id: ID!): Task');
  });

  test('prints one model when it is named', () => {
    declare('true');

    const { stdout } = henri(['graphql', 'Task'], { cwd: app });

    expect(stdout).toContain('type Task {');

    const { status, stderr } = henri(['graphql', 'Nope'], { cwd: app });

    expect(status).not.toBe(0);
    expect(stderr).toContain('No model named "Nope"');
  });

  test('says what it left out, and why', () => {
    declare('true');
    fs.writeFileSync(
      model,
      fs
        .readFileSync(model, 'utf8')
        .replace(
          'schema: {',
          "schema: {\n    secret: { type: 'string', personal: { expose: false } },\n    note: { type: 'string', personal: true },"
        )
    );

    const { stdout } = henri(['graphql', '--summary'], { cwd: app });

    expect(stdout).toContain('secret: not a field');
    expect(stdout).toContain('never leaves the server');
    expect(stdout).toContain('note: not an argument');
  });

  test('prints the definitions as data with --json', () => {
    declare('true');

    const [description] = JSON.parse(
      henri(['graphql', '--json'], { cwd: app }).stdout
    );

    expect(description.model).toBe('Task');
    expect(description.generate).toBe(true);
    expect(description.queries).toEqual({
      many: 'tasks',
      one: 'task',
      page: 'TaskPage',
    });
  });

  test('fails on a declaration henri cannot read', () => {
    declare("{ generate: true, mutations: ['publish'] }");

    const { status, stderr } = henri(['graphql'], { cwd: app });

    expect(status).not.toBe(0);
    expect(stderr).toContain('HENRI_API_GRAPHQL_INVALID_DECLARATION');
  });
});
