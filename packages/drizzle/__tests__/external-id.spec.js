const { ValidationError } = require('../validation');
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

describe('uuid v7', () => {
  test('is time ordered, unique and shaped like RFC 9562 says', () => {
    const list = Array.from({ length: 5000 }, () => uuidv7());
    const stamp = parseInt(`${list[0].slice(0, 8)}${list[0].slice(9, 13)}`, 16);

    expect(list.every((value) => UUIDV7.test(value))).toBe(true);
    expect(new Set(list).size).toBe(list.length);
    // The counter keeps the ids of one millisecond ordered, which is what
    // makes the index append instead of scattering
    expect(
      list.every((value, index) => index === 0 || value > list[index - 1])
    ).toBe(true);
    expect(Math.abs(stamp - Date.now())).toBeLessThan(5000);
  });

  test('tells a uuid from a primary key and from an object id', () => {
    expect(isUuid(uuidv7())).toBe(true);
    expect(isUuid('0199A5C1-1F7E-7A3C-BB0D-2B1A4F6D9C11')).toBe(true);
    expect(isUuid('42')).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid('9007199254740993')).toBe(false);
    // A MongoDB object id is 24 hex characters and no dashes
    expect(isUuid('6a9cc1ae7276eaea0bf93cfe')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

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

  test('every record gets one on create', async () => {
    const task = await Task.create({ name: 'first' });

    expect(task.externalId).toMatch(UUIDV7);
    expect(task.id).toEqual(expect.any(Number));
  });

  test('the column is not null and unique in the database', async () => {
    const task = await Task.create({ name: 'unique' });

    // Not a model check: the row is refused by the database itself, and the
    // adapter turns the constraint violation into a validation error
    await expect(
      Task.create({ externalId: task.externalId, name: 'clash' })
    ).rejects.toBeInstanceOf(ValidationError);

    const columns = adapter.tables.Task.fields.externalId;

    expect(columns.required).toBe(true);
    expect(columns.unique).toBe(true);
  });

  test('the caller may bring its own, lowercased', async () => {
    const given = '0199A5C1-1F7E-7A3C-BB0D-2B1A4F6D9C11';
    const task = await Task.create({ externalId: given, name: 'given' });

    expect(task.externalId).toBe(given.toLowerCase());
    expect(await Task.findById(given)).not.toBeNull();
  });

  test('anything that is not a uuid is refused', async () => {
    await expect(
      Task.create({ externalId: 'not-a-uuid', name: 'bad' })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('findById takes the public id and nothing else', async () => {
    const task = await Task.create({ name: 'lookup' });

    expect((await Task.findById(task.externalId)).id).toBe(task.id);
    // The primary key does not name a row from outside any more: this is
    // what stops GET /tasks/4812 from answering next to the uuid
    expect(await Task.findById(task.id)).toBeNull();
    expect(await Task.findById(String(task.id))).toBeNull();
    // The refusal is the same null an unknown uuid gets, so nothing in
    // the answer says which of the two it was
    expect(await Task.findById(uuidv7())).toBeNull();
    expect(await Task.findById('not-an-id')).toBeNull();
    expect(await Task.findById(424242)).toBeNull();
    expect(await Task.findById(null)).toBeNull();
  });

  test('findByKey takes the primary key and nothing else', async () => {
    const task = await Task.create({ name: 'server side' });

    expect((await Task.findByKey(task.id)).id).toBe(task.id);
    expect((await Task.findByKey(String(task.id))).id).toBe(task.id);
    expect(await Task.findByKey(task.externalId)).toBeNull();
    expect(await Task.findByKey(424242)).toBeNull();
    expect(await Task.findByKey(null)).toBeNull();
    // `findByPk` is the Sequelize name of the same door
    expect((await Task.findByPk(task.id)).id).toBe(task.id);
  });

  test('externalIds.lookup "any" restores the primary key', async () => {
    const { adapter } = build({ externalIds: { lookup: 'any' } });

    adapter.addModel(
      { globalId: 'Loose', identity: 'loose', schema: { name: 'string' } },
      'user'
    );
    await adapter.start();

    const Loose = adapter.models.Loose;
    const row = await Loose.create({ name: 'permissive' });

    expect((await Loose.findById(row.id)).id).toBe(row.id);
    expect((await Loose.findById(row.externalId)).id).toBe(row.id);

    await adapter.stop();
  });

  test('findByIdAndUpdate is not the door findById stopped being', async () => {
    const task = await Task.create({ name: 'no back door' });

    expect(await Task.findByIdAndUpdate(task.id, { name: 'x' })).toBeNull();
    expect(await Task.findByIdAndDelete(task.id)).toBeNull();
    expect((await Task.findByKey(task.id)).name).toBe('no back door');
  });

  test('findByIdAndUpdate and findByIdAndDelete take it too', async () => {
    const task = await Task.create({ name: 'member routes' });
    const updated = await Task.findByIdAndUpdate(task.externalId, {
      name: 'renamed',
    });

    expect(updated.name).toBe('renamed');
    expect(updated.id).toBe(task.id);
    expect(await Task.findByIdAndUpdate(uuidv7(), { name: 'x' })).toBeNull();

    const deleted = await Task.findByIdAndDelete(task.externalId);

    expect(deleted.id).toBe(task.id);
    expect(await Task.findById(task.externalId)).toBeNull();
  });

  test('it is written once and never changes', async () => {
    const task = await Task.create({ name: 'stable' });
    const { externalId } = task;

    await task.update({ externalId: uuidv7(), name: 'still stable' });

    expect(task.externalId).toBe(externalId);
    expect((await Task.findByKey(task.id)).externalId).toBe(externalId);
  });

  test('the primary key never leaves the server', async () => {
    const task = await Task.create({ name: 'serialized' });
    const json = JSON.parse(JSON.stringify(task));

    expect(json.externalId).toBe(task.externalId);
    expect(json.id).toBeUndefined();
    // A partial selection carries the public id, never the primary key alone
    const [partial] = await Task.query()
      .where({ id: task.id })
      .select('name')
      .toArray();

    expect(JSON.parse(JSON.stringify(partial))).toEqual({
      externalId: task.externalId,
      name: 'serialized',
    });
  });

  test('a model can opt out with options: { externalId: false }', async () => {
    const note = await Note.create({ body: 'no public id here' });

    expect(Note.externalId).toBe(false);
    expect(note.externalId).toBeUndefined();
    expect(adapter.tables.Note.fields.externalId).toBeUndefined();
    expect(JSON.parse(JSON.stringify(note))).toEqual({
      body: 'no public id here',
      id: note.id,
    });
    expect((await Note.findById(note.id)).body).toBe('no public id here');
    expect((await Note.findByKey(note.id)).body).toBe('no public id here');
    expect(await Note.findById(uuidv7())).toBeNull();
  });
});
