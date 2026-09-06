const { isUuid, uuidv7 } = require('../external-id');
const { build, target, taskModel } = require('./helpers');

// A uuid version 7: the version nibble is a 7 and the variant one is 8-b
const UUIDV7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const noteModel = {
  globalId: 'Note',
  identity: 'note',
  // The one way out: this model keeps behaving the way it used to
  options: { externalId: false, timestamps: false },
  schema: { body: { type: 'string' } },
};

describe(`external id (${target.name})`, () => {
  let adapter;
  let Task;
  let Note;

  beforeAll(async () => {
    ({ adapter } = build());
    Task = adapter.addModel(taskModel, 'user');
    Note = adapter.addModel(noteModel, 'user');
    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
  });

  test('every record gets one on create, in its own column', async () => {
    const task = await Task.create({ name: 'first' });
    const attribute = Task.rawAttributes.externalId;

    expect(task.externalId).toMatch(UUIDV7);
    expect(attribute.field).toBe('external_id');
    expect(attribute.allowNull).toBe(false);
    expect(attribute.unique).toBe(true);
    // A function default is generated per row and never lands in the DDL
    expect(typeof attribute.defaultValue).toBe('function');
  });

  test('the database refuses a duplicate', async () => {
    const task = await Task.create({ name: 'unique' });

    await expect(
      Task.create({ externalId: task.externalId, name: 'clash' })
    ).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
  });

  test('the column is not null and unique in the database', async () => {
    const table = Task.getTableName();
    // The description comes from the server, on every dialect
    const description = await adapter.connector
      .getQueryInterface()
      .describeTable(table);
    const indexes = await adapter.connector
      .getQueryInterface()
      .showIndex(table);

    expect(description.external_id.allowNull).toBe(false);
    expect(
      indexes.some(
        (index) =>
          index.unique &&
          index.fields.some((field) => field.attribute === 'external_id')
      )
    ).toBe(true);
  });

  test('findById takes the public id and nothing else', async () => {
    const task = await Task.create({ name: 'lookup' });

    expect((await Task.findById(task.externalId)).id).toBe(task.id);
    // The primary key does not name a row from outside any more: this is
    // what stops GET /tasks/4812 from answering next to the uuid
    expect(await Task.findById(task.id)).toBeNull();
    expect(await Task.findById(String(task.id))).toBeNull();
    // ... and the refusal is the same null an unknown uuid gets, so nothing
    // in the answer says which of the two it was
    expect(await Task.findById(uuidv7())).toBeNull();
    expect(isUuid(String(task.id))).toBe(false);
  });

  test('findByKey and findByPk take the primary key and nothing else', async () => {
    const task = await Task.create({ name: 'server side' });

    expect((await Task.findByKey(task.id)).id).toBe(task.id);
    expect((await Task.findByKey(String(task.id))).id).toBe(task.id);
    expect((await Task.findByPk(task.id)).id).toBe(task.id);
    // A value the key column cannot hold is a miss, not a database error
    expect(await Task.findByKey(uuidv7())).toBeNull();
    expect(await Task.findByKey('nonsense')).toBeNull();
    expect(await Task.findByKey(null)).toBeNull();
  });

  test('findByExternalId takes the public id', async () => {
    const task = await Task.create({ name: 'public' });

    expect((await Task.findByExternalId(task.externalId)).id).toBe(task.id);
    expect(await Task.findByExternalId(uuidv7())).toBeNull();
  });

  test('externalIds.lookup "any" restores the primary key', async () => {
    const permissive = build({ externalIds: { lookup: 'any' } });
    const Loose = permissive.adapter.addModel(
      { ...taskModel, globalId: 'Loose', identity: 'loose' },
      'user'
    );

    await permissive.adapter.start();

    const row = await Loose.create({ name: 'permissive' });

    expect((await Loose.findById(row.id)).id).toBe(row.id);
    expect((await Loose.findById(row.externalId)).id).toBe(row.id);

    await permissive.adapter.stop();
  });

  test('it is written once and never changes', async () => {
    const task = await Task.create({ name: 'stable' });
    const { externalId } = task;

    await task.update({ externalId: uuidv7(), name: 'still stable' });
    await Task.update({ externalId: uuidv7() }, { where: { id: task.id } });

    expect(task.externalId).toBe(externalId);
    expect((await Task.findByKey(task.id)).externalId).toBe(externalId);
  });

  test('the primary key never leaves the server', async () => {
    const task = await Task.create({ name: 'serialized' });
    const json = JSON.parse(JSON.stringify(task));

    expect(json.externalId).toBe(task.externalId);
    expect(json.id).toBeUndefined();
    expect(json.name).toBe('serialized');
  });

  test('a model can opt out with options: { externalId: false }', async () => {
    const note = await Note.create({ body: 'no public id here' });

    expect(Note.rawAttributes.externalId).toBeUndefined();
    expect(JSON.parse(JSON.stringify(note))).toEqual({
      body: 'no public id here',
      id: note.id,
    });
    // A model that opted out keeps the lookup it always had
    expect((await Note.findById(note.id)).body).toBe('no public id here');
    expect((await Note.findByKey(note.id)).body).toBe('no public id here');
  });
});
