// Factories against a real application and a real store: the demo app on
// @usehenri/disk (mongoose). What is proved here is the one thing the unit
// tests cannot: a factory writes through the model, so everything the model
// does to a record still happens -- the password is hashed, the timestamps
// are stamped, the roles are not mass assigned. The showcase suite is the
// same proof against Drizzle and a real PostgreSQL.
/* global Artwork, User */
const path = require('node:path');

const {
  build,
  create,
  createList,
  request,
  setup,
  teardown,
} = require('../index.js');

/** The demo application of this repository */
const APP = path.resolve(__dirname, '..', '..', 'demo');

describe('factories (demo app, disk store)', () => {
  const previous = process.cwd();

  beforeAll(async () => {
    process.chdir(APP);
    await setup();
  }, 60000);

  afterAll(async () => {
    await teardown();
    process.chdir(previous);
  });

  test('makes a valid record out of nothing', async () => {
    const artwork = await create('artwork');

    expect(artwork.title).toMatch(/^Artwork \d+$/u);
    expect(artwork.year).toBe(1905);
    // The model's own doing, not the factory's
    expect(artwork.createdAt).toBeInstanceOf(Date);
  });

  test('the record goes through the model: the password is hashed', async () => {
    const user = await create('user');
    // A factory hands back the record the model made, and `findByKey` is the
    // primary key lookup: `findById` takes the public identifier only
    const stored = await User.findByKey(user.id).select('+password');

    expect(stored.password).not.toBe('difference-engine');
    expect(stored.password).not.toContain('difference-engine');
    expect(await henri.user.compare('difference-engine', stored)).toBeTruthy();
  });

  test('roles are not mass assigned, so `after` sets them', async () => {
    const member = await create('user');
    const admin = await create('user', 'admin');

    expect(member.roles).not.toContain('admin');
    expect(admin.roles).toContain('admin');
  });

  test('an association is made once and shared, and an override replaces it', async () => {
    const owner = await create('user');
    const mine = await create('memo', { ownerId: owner.id });
    const theirs = await create('memo');

    expect(mine.ownerId).toBe(String(owner.id));
    expect(theirs.ownerId).not.toBe(String(owner.id));
  });

  test('a trait is a named group of fields, not one', async () => {
    const archived = await create('memo', 'archived');
    const draft = await create('memo');

    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(draft.archivedAt).toBeFalsy();
  });

  test('createList makes as many as asked, in sequence', async () => {
    const artworks = await createList('artwork', 3, { year: 1912 });
    const titles = artworks.map((artwork) => artwork.title);

    expect(artworks).toHaveLength(3);
    expect(new Set(titles).size).toBe(3);
    expect(artworks.every((artwork) => artwork.year === 1912)).toBe(true);
  });

  test('build() answers the attributes a controller would accept', async () => {
    const attributes = await build('artwork', { title: 'Le bonheur de vivre' });
    const answer = await request().post('/artwork').send(attributes);
    const stored = await Artwork.find({ title: 'Le bonheur de vivre' });

    expect(answer.status).toBe(201);
    expect(stored).toHaveLength(1);
    // The year the factory filled in, sent by the test and kept by the model
    expect(stored[0].year).toBe(1905);
  });
});
