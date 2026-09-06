const { deserialize, serialize } = require('../src/serialize');

describe('serialize', () => {
  test('keeps what JSON can carry', () => {
    const args = {
      count: 3,
      done: false,
      list: [1, 'two', null, { deep: true }],
      nothing: null,
      title: 'hello',
    };

    expect(deserialize(serialize(args))).toEqual(args);
  });

  test('stores a Date as its ISO string', () => {
    const date = new Date('2026-01-02T03:04:05.000Z');

    expect(deserialize(serialize({ at: date }))).toEqual({
      at: '2026-01-02T03:04:05.000Z',
    });
  });

  test('serializes nothing as null', () => {
    expect(serialize()).toBe('null');
    expect(deserialize(serialize())).toBeNull();
  });

  test.each([
    ['a function', { run: () => null }, 'args.run is a function'],
    ['a symbol', { tag: Symbol('x') }, 'args.tag is a symbol'],
    ['a bigint', { big: 1n }, 'args.big is a bigint'],
    ['undefined', { missing: undefined }, 'args.missing is undefined'],
    ['NaN', { count: NaN }, 'args.count is NaN'],
    ['Infinity', { count: Infinity }, 'args.count is Infinity'],
  ])('refuses %s, naming the path', (label, args, message) => {
    expect(() => serialize(args)).toThrow(message);
  });

  test('refuses a class instance and says to pass its id', () => {
    class Task {}

    expect(() => serialize({ task: new Task() })).toThrow(
      'args.task is a Task instance'
    );
  });

  test('refuses a Map, a Set and a Buffer', () => {
    expect(() => serialize({ seen: new Map() })).toThrow('args.seen is a Map');
    expect(() => serialize({ seen: new Set() })).toThrow('args.seen is a Set');
    expect(() => serialize({ blob: Buffer.from('x') })).toThrow(
      'args.blob is a Buffer'
    );
  });

  test('refuses a circular reference', () => {
    const args = { name: 'loop' };

    args.self = args;

    expect(() => serialize(args)).toThrow('args.self is a circular reference');
  });

  test('refuses a payload over the limit and says what to do', () => {
    const args = { blob: 'x'.repeat(2048) };

    expect(() => serialize(args, { maxBytes: 1024 })).toThrow(
      'over the 1024 bytes limit'
    );
  });

  test('carries the code and the path on the error', () => {
    let thrown = null;

    try {
      serialize({ user: { save: () => null } });
    } catch (error) {
      thrown = error;
    }

    expect(thrown.code).toBe('HENRI_JOB_INVALID_ARGUMENTS');
    expect(thrown.path).toBe('args.user.save');
  });

  test('reads back nothing as null', () => {
    expect(deserialize(null)).toBeNull();
    expect(deserialize('')).toBeNull();
    expect(deserialize('not json')).toBeNull();
  });

  test('allows the same object twice when it is not a cycle', () => {
    const shared = { id: 1 };

    expect(deserialize(serialize({ left: shared, right: shared }))).toEqual({
      left: { id: 1 },
      right: { id: 1 },
    });
  });
});
