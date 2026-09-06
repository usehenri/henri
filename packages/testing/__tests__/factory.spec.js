const path = require('node:path');

const {
  build,
  create,
  createList,
  defineFactory,
  resetFactories,
} = require('../index.js');

/** A henri application whose models are `test/factories` away */
const APP = path.join(__dirname, 'fixtures', 'app');

/** What every stub model has written, newest last */
let written = [];

/**
 * A model that answers like one of henri's, without a database
 *
 * @param {string} name the global name
 * @returns {object} the model
 */
const stubModel = (name) => ({
  create: async (attrs) => {
    const record = { ...attrs, id: written.length + 1, model: name };

    written.push(record);

    return record;
  },
});

/**
 * The models of the fixture application, as globals
 *
 * @param {Array<string>} names the model names
 * @returns {void}
 */
const withModels = (names) => {
  global.henri = { model: { ids: names } };
  names.forEach((name) => (global[name] = stubModel(name)));
};

describe('factories', () => {
  const previous = process.cwd();

  beforeEach(() => {
    process.chdir(APP);
    written = [];
    resetFactories();
    withModels(['Event', 'Proposal', 'Track']);
  });

  afterEach(() => {
    process.chdir(previous);
    delete global.henri;
    ['Event', 'Proposal', 'Track'].forEach((name) => delete global[name]);
    resetFactories();
  });

  describe('the files of test/factories', () => {
    test('a factory is named after its file and writes to the model of that name', async () => {
      const event = await create('event');

      expect(event.model).toBe('Event');
      expect(event.name).toBe('Event 1');
      expect(event.state).toBe('draft');
    });

    test('`model` names the model when the file is called something else', async () => {
      const talk = await create('talk');

      expect(talk.model).toBe('Proposal');
      expect(talk.title).toBe('Talk 1');
    });

    test('an unknown factory says so and lists the ones there are', async () => {
      await expect(create('speaker')).rejects.toMatchObject({
        code: 'HENRI_FACTORY_UNKNOWN',
        message: expect.stringContaining('event, talk, track'),
      });
    });

    test('a model the application does not have is named in the failure', async () => {
      withModels(['Event', 'Track']);

      await expect(create('talk')).rejects.toMatchObject({
        code: 'HENRI_FACTORY_INVALID',
        message: expect.stringContaining("names the model 'Proposal'"),
      });
    });
  });

  describe('overrides', () => {
    test('win over the definition', async () => {
      const event = await create('event', { name: 'Lineup' });

      expect(event.name).toBe('Lineup');
    });

    test('are never made: the association is not created', async () => {
      const talk = await create('talk', { eventId: 42, trackId: 7 });

      expect(talk.eventId).toBe(42);
      expect(written).toHaveLength(1);
    });

    test('of `undefined` say nothing, so a default survives', async () => {
      const event = await create('event', { name: undefined });

      expect(event.name).toBe('Event 1');
    });

    test('may add a field the factory does not declare', async () => {
      const event = await create('event', { city: 'Montreal' });

      expect(event.city).toBe('Montreal');
    });
  });

  describe('traits', () => {
    test('apply their fields on top of the definition', async () => {
      const event = await create('event', 'open');

      expect(event.state).toBe('open');
      expect(event.name).toBe('Event 1');
    });

    test('compose, and an override still wins over both', async () => {
      const talk = await create('talk', 'accepted', 'lightning', {
        state: 'draft',
      });

      expect(talk.format).toBe('lightning');
      expect(talk.decidedAt).toEqual(new Date(0));
      expect(talk.state).toBe('draft');
    });

    test('reach the hooks through the context', async () => {
      const seen = [];

      defineFactory('event', {
        attributes: { name: ({ traits }) => seen.push(...traits) && 'Event' },
        traits: { open: {} },
      });
      await create('event', 'open');

      expect(seen).toEqual(['open']);
    });

    test('an unknown one says so and lists the ones there are', async () => {
      await expect(create('talk', 'published')).rejects.toMatchObject({
        code: 'HENRI_FACTORY_UNKNOWN_TRAIT',
        message: expect.stringContaining('accepted, lightning'),
      });
    });
  });

  describe('associations', () => {
    test('are made, and two fields can share one parent', async () => {
      const talk = await create('talk');
      const events = written.filter((record) => record.model === 'Event');
      const track = written.find((record) => record.model === 'Track');

      // The talk asks for an open event and the track reads that same id
      // rather than making a second one
      expect(events).toHaveLength(1);
      expect(events[0].state).toBe('open');
      expect(track.eventId).toBe(events[0].id);
      expect(talk.trackId).toBe(track.id);
    });

    test('are made by build() too: a foreign key has to name a row', async () => {
      const attributes = await build('talk');

      expect(written.map((record) => record.model)).toEqual(['Event', 'Track']);
      expect(attributes.eventId).toBe(1);
      expect(attributes.id).toBeUndefined();
    });

    test('build() touches nothing when the caller gives the keys', async () => {
      const attributes = await build('talk', { eventId: 1, trackId: 2 });

      expect(written).toEqual([]);
      expect(attributes).toEqual({
        eventId: 1,
        title: 'Talk 1',
        trackId: 2,
      });
    });

    test('a chain with nothing to end it is reported, not run forever', async () => {
      defineFactory('event', {
        attributes: { parentId: async ({ create: nested }) => nested('event') },
      });

      await expect(create('event')).rejects.toMatchObject({
        code: 'HENRI_FACTORY_DEPTH',
        message: expect.stringContaining('event -> event'),
      });
    });

    test('two fields that read each other are reported by name', async () => {
      defineFactory('event', {
        attributes: {
          name: async ({ attrs }) => await attrs.slug,
          slug: async ({ attrs }) => await attrs.name,
        },
      });

      await expect(create('event')).rejects.toMatchObject({
        code: 'HENRI_FACTORY_DEPTH',
        message: expect.stringContaining('name -> slug -> name'),
      });
    });
  });

  describe('sequences', () => {
    test('count the records one factory made, from one', async () => {
      const events = await createList('event', 3);

      expect(events.map((event) => event.name)).toEqual([
        'Event 1',
        'Event 2',
        'Event 3',
      ]);
    });

    test('are their own per factory, and build() advances them too', async () => {
      await build('event');
      const track = await create('track');
      const event = await create('event');

      expect(track.name).toBe('Track 1');
      // The first event was built, the track made a second one
      expect(event.name).toBe('Event 3');
    });

    test('uid keeps a unique column apart between processes', async () => {
      const event = await create('event');

      expect(event.slug).toMatch(/^event-[0-9a-z]{4}-1$/u);
    });
  });

  describe('after', () => {
    test('runs on the saved record, and what it answers replaces it', async () => {
      const talk = await create('talk');

      expect(talk.seen).toBe(true);
      expect(written.at(-1).seen).toBeUndefined();
    });

    test('returning nothing keeps the record', async () => {
      defineFactory('event', {
        after: () => undefined,
        attributes: { name: 'Kept' },
      });

      expect((await create('event')).name).toBe('Kept');
    });
  });

  describe('declaring one from a test file', () => {
    test('wins over the file of the same name, whatever order they arrive in', async () => {
      defineFactory('event', { attributes: { name: 'From the test file' } });

      expect((await create('event')).name).toBe('From the test file');
    });

    test('a definition that cannot be used says what is wrong with it', () => {
      expect(() => defineFactory('event', { attributes: 'nope' })).toThrow(
        /has no `attributes` object/u
      );
      expect(() =>
        defineFactory('event', { attributes: {}, model: 42 })
      ).toThrow(/`model` that is not the name of one/u);
      expect(() =>
        defineFactory('event', { attributes: {}, traits: { open: 'yes' } })
      ).toThrow(/trait 'open' that is not an object/u);
      expect(() =>
        defineFactory('event', { after: 1, attributes: {} })
      ).toThrow(/`after` that is not a function/u);
      expect(() => defineFactory('', { attributes: {} })).toThrow(
        /a factory needs a name/u
      );
    });
  });

  test('a factory used before the application booted says how to boot it', async () => {
    delete global.henri;

    await expect(create('event')).rejects.toMatchObject({
      code: 'HENRI_BOOT_TESTING_NOT_RUNNING',
    });
  });
});
