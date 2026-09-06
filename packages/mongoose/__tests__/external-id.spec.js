const { MongoMemoryServer } = require('mongodb-memory-server');
const Mongoose = require('../index');
const { isUuid, uuidv7 } = require('../external-id');

// A uuid version 7: the version nibble is a 7 and the variant one is 8-b
const UUIDV7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const taskModel = {
  globalId: 'Task',
  identity: 'task',
  options: { timestamps: false },
  schema: { name: { required: true, type: 'string' } },
};

const noteModel = {
  globalId: 'Note',
  identity: 'note',
  // The one way out: this model keeps behaving the way it used to
  options: { externalId: false, timestamps: false },
  schema: { body: { type: 'string' } },
};

/**
 * A minimal henri stand-in
 *
 * @returns {object} fake henri
 */
const fakeHenri = () => ({
  _user: null,
  config: { get: () => undefined, has: () => false },
  isTest: true,
  pen: { error() {}, fatal() {}, info() {}, warn() {} },
  user: { encrypt: async (password) => `hashed:${password}` },
});

describe('external id (mongoose)', () => {
  let mongod;
  let adapter;
  let Task;
  let Note;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    adapter = new Mongoose(
      'default',
      { url: mongod.getUri('external-id') },
      fakeHenri()
    );
    Task = adapter.addModel(taskModel, 'user');
    Note = adapter.addModel(noteModel, 'user');
    await adapter.start();
  }, 120000);

  afterAll(async () => {
    await adapter.stop();
    await mongod.stop();
  });

  test('every document gets one on create', async () => {
    const task = await Task.create({ name: 'first' });

    expect(task.externalId).toMatch(UUIDV7);
    expect(task._id).toBeDefined();
  });

  test('the unique index exists on the server', async () => {
    const indexes = await Task.collection.indexes();
    const found = indexes.find((index) => index.key.externalId === 1);

    expect(found).toBeDefined();
    expect(found.unique).toBe(true);

    const task = await Task.create({ name: 'unique' });

    // Refused by the server, not by a model validation
    await expect(
      Task.create({ externalId: task.externalId, name: 'clash' })
    ).rejects.toMatchObject({ code: 11000 });
  });

  test('it is required', async () => {
    await expect(
      Task.create({ externalId: null, name: 'no id' })
    ).rejects.toThrow(/externalId/);
  });

  test('findById takes the public id or the document id', async () => {
    const task = await Task.create({ name: 'lookup' });

    expect(String((await Task.findById(task.externalId))._id)).toBe(
      String(task._id)
    );
    expect(String((await Task.findById(task._id))._id)).toBe(String(task._id));
    expect(String((await Task.findById(String(task._id)))._id)).toBe(
      String(task._id)
    );
    // An object id is 24 hex characters: it never looks like a uuid
    expect(isUuid(String(task._id))).toBe(false);
    expect(await Task.findById(uuidv7())).toBeNull();
    expect(await Task.findById('000000000000000000000000')).toBeNull();
  });

  test('findByIdAndUpdate and findByIdAndDelete take it too', async () => {
    const task = await Task.create({ name: 'member routes' });
    const updated = await Task.findByIdAndUpdate(
      task.externalId,
      { name: 'renamed' },
      { returnDocument: 'after' }
    );

    expect(updated.name).toBe('renamed');

    await Task.findByIdAndDelete(task.externalId);

    expect(await Task.findById(task.externalId)).toBeNull();
  });

  test('the document id never leaves the server', async () => {
    const task = await Task.create({ name: 'serialized' });
    const json = JSON.parse(JSON.stringify(task));

    expect(json).toEqual({ externalId: task.externalId, name: 'serialized' });
    expect(adapter.toPlain(task)._id).toBeUndefined();
  });

  test('a model can opt out with options: { externalId: false }', async () => {
    const note = await Note.create({ body: 'no public id here' });
    const json = JSON.parse(JSON.stringify(note));

    expect(note.externalId).toBeUndefined();
    expect(json._id).toBe(String(note._id));
    expect(String((await Note.findById(note._id))._id)).toBe(String(note._id));
  });
});
