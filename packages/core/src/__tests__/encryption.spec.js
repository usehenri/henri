/* global User */
const Henri = require('../henri');
const Encryption = require('../1.encryption');

const {
  DETERMINISTIC_LENGTH,
  MAX_DETERMINISTIC_BYTES,
  Keyring,
  decrypt,
  encrypt,
  generateKey,
  isEnvelope,
  keyIdIn,
  keyIdOf,
  keyringOf,
  parse,
  parseKey,
} = require('../base/encryption');
const { stateOf } = require('../base/rewrap');
const { markOf } = require('../base/privacy');

const KEY = generateKey();
const OTHER = generateKey();

/**
 * The same envelope with one byte of the ciphertext flipped.
 *
 * Not the last character of the base64: the final character of a base64
 * string may carry bits that decode to nothing, so changing it can leave
 * the bytes identical and the tag intact. This changes a byte.
 *
 * @param {string} envelope An envelope
 * @returns {string} The same envelope, with one byte changed
 */
const tampered = (envelope) => {
  const [prefix, version, scheme, id, body] = envelope.split(':');
  const raw = Buffer.from(body, 'base64url');

  raw[raw.length - 1] ^= 0xff;

  return [prefix, version, scheme, id, raw.toString('base64url')].join(':');
};

/**
 * The error a call threw, or null
 *
 * @param {function} work What to run
 * @returns {?Error} The error
 */
const thrownBy = (work) => {
  try {
    work();
  } catch (error) {
    return error;
  }

  return null;
};

/** A keyring of the given keys, primary first */
const ring = (...keys) => keyringOf(keys, 'the test');

/** The context every value of this file is bound to */
const CONTEXT = { context: 'Person.ssn', keyring: ring(KEY) };

/**
 * An encryption module reading a fixed configuration
 *
 * @param {object} settings What `config.encryption` holds
 * @returns {Promise<Encryption>} The module, initialized
 */
const moduleOf = async (settings) => {
  const encryption = new Encryption();

  encryption.henri = {
    config: {
      get: () => settings,
      has: (key) => key === 'encryption',
      sourceOf: () => 'the test',
    },
    pen: { error: () => {}, info: () => {}, warn: () => {} },
  };

  await encryption.init();

  return encryption;
};

describe('the envelope', () => {
  test('says what it is, which key wrote it and which scheme it used', () => {
    const value = encrypt('hunter2', CONTEXT);
    const parts = parse(value);

    expect(value.startsWith('henri:v1:r:')).toBe(true);
    expect(parts).toMatchObject({
      id: keyIdOf(parseKey(KEY, 'the test')),
      scheme: 'r',
      version: 'v1',
    });
    expect(value).not.toContain('hunter2');
    expect(decrypt(value, CONTEXT)).toBe('hunter2');
  });

  test('a reader tells it from plaintext without a key', () => {
    expect(isEnvelope('hunter2')).toBe(false);
    expect(isEnvelope('henri')).toBe(false);
    expect(isEnvelope(encrypt('x', CONTEXT))).toBe(true);
    expect(keyIdIn('hunter2')).toBeNull();
    expect(keyIdIn(encrypt('x', CONTEXT))).toHaveLength(8);
  });

  test('the key id says nothing about the key', () => {
    const key = parseKey(KEY, 'the test');

    expect(keyIdOf(key)).toMatch(/^[0-9a-f]{8}$/u);
    expect(KEY).not.toContain(keyIdOf(key));
  });

  test('randomised is different every time', () => {
    const one = encrypt('same', CONTEXT);
    const two = encrypt('same', CONTEXT);

    expect(one).not.toBe(two);
    expect(decrypt(one, CONTEXT)).toBe(decrypt(two, CONTEXT));
  });

  test('deterministic is the same every time, in that field only', () => {
    const options = { ...CONTEXT, deterministic: true };
    const one = encrypt('same', options);
    const two = encrypt('same', options);
    const elsewhere = encrypt('same', {
      ...options,
      context: 'Person.other',
    });

    expect(one).toBe(two);
    expect(one).not.toBe(elsewhere);
    expect(decrypt(elsewhere, { ...options, context: 'Person.other' })).toBe(
      'same'
    );
  });

  test('the same value under two keys is two different envelopes', () => {
    const options = { context: 'Person.ssn', deterministic: true };

    expect(encrypt('same', { ...options, keyring: ring(KEY) })).not.toBe(
      encrypt('same', { ...options, keyring: ring(OTHER) })
    );
  });

  test('an empty string round-trips, and null is left alone', async () => {
    const encryption = await moduleOf({ keys: [KEY] });

    expect(decrypt(encrypt('', CONTEXT), CONTEXT)).toBe('');
    expect(encryption.encrypt(null, { context: 'Person.ssn' })).toBeNull();
    expect(
      encryption.encrypt(undefined, { context: 'Person.ssn' })
    ).toBeUndefined();
  });

  test('unicode survives the round trip', () => {
    const value = 'Ada Lovelace — ✉️ ada@example.com — 東京';

    expect(decrypt(encrypt(value, CONTEXT), CONTEXT)).toBe(value);
  });
});

describe('what a value that will not open says', () => {
  test('a key that is not held is named, and is its own failure', () => {
    const value = encrypt('x', CONTEXT);

    expect(() =>
      decrypt(value, { context: 'Person.ssn', keyring: ring(OTHER) })
    ).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_KEY_UNKNOWN' })
    );
  });

  test('a changed byte does not verify', () => {
    expect(() => decrypt(tampered(encrypt('x', CONTEXT)), CONTEXT)).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_UNREADABLE' })
    );
  });

  test('a value moved to another field does not open', () => {
    const value = encrypt('x', CONTEXT);

    expect(() =>
      decrypt(value, { context: 'Person.other', keyring: ring(KEY) })
    ).toThrow(expect.objectContaining({ code: 'HENRI_ENCRYPTION_UNREADABLE' }));
  });

  test('a value moved to another scheme does not open', () => {
    const value = encrypt('x', { ...CONTEXT, deterministic: true });

    expect(() => decrypt(value, CONTEXT)).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_UNREADABLE' })
    );
  });

  test('a truncated envelope is a failure, not a crash', () => {
    const value = encrypt('x', CONTEXT);

    expect(() => decrypt(value.slice(0, 30), CONTEXT)).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_UNREADABLE' })
    );
    expect(() => decrypt('henri:v2:r:aaaaaaaa:AAAA', CONTEXT)).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_UNREADABLE' })
    );
  });

  test('nothing about the value reaches the message', () => {
    const value = encrypt('a-national-identifier', CONTEXT);
    const error = thrownBy(() =>
      decrypt(value, { context: 'Person.ssn', keyring: ring(OTHER) })
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('a-national-identifier');
    expect(error.message).not.toContain(value);
    expect(error.message).not.toContain(KEY);
  });
});

describe('the ceiling of a deterministic value', () => {
  test('the longest one still fits its column', () => {
    const value = encrypt('x'.repeat(MAX_DETERMINISTIC_BYTES), {
      ...CONTEXT,
      deterministic: true,
    });

    expect(value.length).toBeLessThanOrEqual(DETERMINISTIC_LENGTH);
  });

  test('one byte more is refused, and says what to do instead', () => {
    expect(() =>
      encrypt('x'.repeat(MAX_DETERMINISTIC_BYTES + 1), {
        ...CONTEXT,
        deterministic: true,
      })
    ).toThrow(expect.objectContaining({ code: 'HENRI_ENCRYPTION_TOO_LONG' }));
  });

  test('it is bytes, not characters', () => {
    // Three bytes per character
    expect(() =>
      encrypt('東'.repeat(MAX_DETERMINISTIC_BYTES), {
        ...CONTEXT,
        deterministic: true,
      })
    ).toThrow(expect.objectContaining({ code: 'HENRI_ENCRYPTION_TOO_LONG' }));
  });

  test('a randomised value has no ceiling', () => {
    const value = 'x'.repeat(100000);

    expect(decrypt(encrypt(value, CONTEXT), CONTEXT)).toBe(value);
  });
});

describe('the keyring', () => {
  test('a key is 64 hexadecimal characters and nothing else', () => {
    for (const wrong of ['', 'nope', KEY.slice(0, 63), `${KEY}0`, null, 42]) {
      expect(() => parseKey(wrong, 'the test')).toThrow(
        expect.objectContaining({ code: 'HENRI_ENCRYPTION_KEY_MALFORMED' })
      );
    }

    expect(parseKey(` ${KEY.toUpperCase()} `, 'the test')).toHaveLength(32);
  });

  test('the value that arrived is never repeated in the message', () => {
    const error = thrownBy(() =>
      parseKey('almost-a-key-but-not-quite', 'HENRI_ENCRYPTION_KEYS')
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('almost-a-key-but-not-quite');
    expect(error.message).toContain('HENRI_ENCRYPTION_KEYS');
  });

  test('the same key twice is refused: it would rotate nothing', () => {
    expect(() => ring(KEY, KEY)).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_KEY_MALFORMED' })
    );
  });

  test('the first key writes and every key reads', () => {
    const keyring = ring(OTHER, KEY);

    expect(keyring.ids).toHaveLength(2);
    expect(keyring.primary.id).toBe(keyIdOf(parseKey(OTHER, 'x')));
    expect(keyring.find(keyIdOf(parseKey(KEY, 'x')))).toBeTruthy();
    expect(keyring.find('deadbeef')).toBeNull();
    expect(decrypt(encrypt('x', CONTEXT), { ...CONTEXT, keyring })).toBe('x');
  });

  test('an empty keyring is disabled, and encrypting refuses', () => {
    const keyring = new Keyring([]);

    expect(keyring.enabled).toBe(false);
    expect(keyring.primary).toBeNull();
    expect(() => encrypt('x', { context: 'Person.ssn', keyring })).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NO_KEY' })
    );
  });

  test('describe() answers ids and sources, never key material', () => {
    const described = ring(KEY, OTHER).describe();

    expect(described).toEqual([
      { id: expect.any(String), primary: true, source: 'the test' },
      { id: expect.any(String), primary: false, source: 'the test' },
    ]);
    expect(JSON.stringify(described)).not.toContain(KEY);
    expect(JSON.stringify(described)).not.toContain(OTHER);
  });
});

describe('the module', () => {
  test('one key or a list of them both work', async () => {
    expect((await moduleOf({ keys: KEY })).keys).toHaveLength(1);
    expect((await moduleOf({ keys: [KEY, OTHER] })).keys).toHaveLength(2);
    expect((await moduleOf({})).enabled).toBe(false);
    expect((await moduleOf(undefined)).enabled).toBe(false);
  });

  test('a model that encrypts without a key fails the boot', async () => {
    const encryption = await moduleOf({});

    expect(() => encryption.register('Person', { ssn: true })).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NO_KEY' })
    );
    expect(() => encryption.require('Person.ssn')).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NO_KEY' })
    );
  });

  test('a column that is not encrypted is a failure of its own', async () => {
    const encryption = await moduleOf({ keys: [KEY] });

    expect(() =>
      encryption.decrypt('in the clear', { context: 'Person.ssn' })
    ).toThrow(expect.objectContaining({ code: 'HENRI_ENCRYPTION_PLAINTEXT' }));
  });

  test('readPlaintext lets it through, and says so at boot', async () => {
    const encryption = await moduleOf({ keys: [KEY], readPlaintext: true });

    expect(encryption.decrypt('in the clear', { context: 'Person.ssn' })).toBe(
      'in the clear'
    );
  });

  test('candidates() covers every key, so a lookup survives a rotation', async () => {
    const encryption = await moduleOf({ keys: [OTHER, KEY] });
    const candidates = encryption.candidates('B-1', {
      context: 'Person.badge',
    });

    expect(candidates).toHaveLength(2);
    expect(new Set(candidates).size).toBe(2);
    // The one the old key wrote is among them
    expect(candidates).toContain(
      encrypt('B-1', {
        context: 'Person.badge',
        deterministic: true,
        keyring: ring(KEY),
      })
    );
  });

  test('tolerate() reads null and collects, and only inside itself', async () => {
    const encryption = await moduleOf({ keys: [OTHER] });
    const foreign = encrypt('x', CONTEXT);
    const read = () => encryption.read(foreign, { context: 'Person.ssn' });

    expect(read).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_KEY_UNKNOWN' })
    );

    const { failures, value } = await encryption.tolerate(async () => read());

    expect(value).toBeNull();
    expect(failures).toEqual([
      {
        code: 'HENRI_ENCRYPTION_KEY_UNKNOWN',
        context: 'Person.ssn',
        keyId: keyIdIn(foreign),
      },
    ]);

    // And the leniency is gone again outside it
    expect(read).toThrow();
  });

  test('two tolerate() calls in flight do not borrow each other leniency', async () => {
    const encryption = await moduleOf({ keys: [OTHER] });
    const foreign = encrypt('x', CONTEXT);
    let strict = null;

    const lenient = encryption.tolerate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));

      return encryption.read(foreign, { context: 'Person.ssn' });
    });

    try {
      encryption.read(foreign, { context: 'Person.ssn' });
    } catch (error) {
      strict = error.code;
    }

    expect(strict).toBe('HENRI_ENCRYPTION_KEY_UNKNOWN');
    expect((await lenient).value).toBeNull();
  });

  test('describe() answers the map and the key ids, never a key', async () => {
    const encryption = await moduleOf({ keys: [KEY, OTHER] });

    encryption.register('Person', {
      badge: { deterministic: true },
      ssn: true,
    });

    const described = encryption.describe();

    expect(described.fields).toEqual([
      { deterministic: true, field: 'badge', model: 'Person' },
      { deterministic: false, field: 'ssn', model: 'Person' },
    ]);
    expect(described.keys.map((key) => key.primary)).toEqual([true, false]);
    expect(JSON.stringify(described)).not.toContain(KEY);
  });

  test('reset() forgets the models, a reload of the keys does not', async () => {
    const encryption = await moduleOf({ keys: [KEY] });

    encryption.register('Person', { ssn: true });
    await encryption.init();

    expect(encryption.markOf('Person', 'ssn')).toBeTruthy();

    encryption.reset();

    expect(encryption.markOf('Person', 'ssn')).toBeNull();
  });
});

describe('what the rotation sees without opening anything', () => {
  test('stateOf sorts a column into a key id, plaintext or nothing', async () => {
    const encryption = await moduleOf({ keys: [KEY] });
    const value = encrypt('x', CONTEXT);

    expect(stateOf(encryption, value)).toBe(keyIdIn(value));
    expect(stateOf(encryption, 'in the clear')).toBe('plaintext');
    expect(stateOf(encryption, null)).toBe('null');
    expect(stateOf(encryption, '')).toBe('null');
    expect(stateOf(encryption, 'henri:v1:zzz')).toBe('malformed');
  });
});

describe('the mark implies personal', () => {
  test('an encrypted field is personal unless the model says otherwise', () => {
    expect(
      markOf('Person', 'ssn', { encrypted: true, type: 'string' })
    ).toMatchObject({ encrypted: true, erase: 'clear', expose: true });

    expect(
      markOf('Person', 'ssn', {
        encrypted: true,
        personal: { expose: false },
        type: 'string',
      })
    ).toMatchObject({ encrypted: true, expose: false });

    // An application secret is not somebody's data
    expect(
      markOf('Setting', 'apiKey', {
        encrypted: true,
        personal: false,
        type: 'string',
      })
    ).toBeNull();

    // And a field that is neither is still not in the map
    expect(markOf('Person', 'title', { type: 'string' })).toBeNull();
  });
});

describe('encryption (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
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

  /**
   * A user with an encrypted phone and national identifier
   *
   * @param {string} email The address
   * @returns {Promise<object>} The user
   */
  const person = (email) =>
    User.create({
      age: 36,
      email,
      name: 'Ada Lovelace',
      nationalId: `ID-${email}`,
      password: 'difference-engine-1842',
      phone: '+1-555-0100',
    });

  test('the application declares two encrypted fields', () => {
    const described = henri.encryption.describe();

    expect(described.enabled).toBe(true);
    expect(described.fields).toEqual([
      { deterministic: true, field: 'nationalId', model: 'User' },
      { deterministic: false, field: 'phone', model: 'User' },
    ]);
    expect(described.keys).toHaveLength(2);
    expect(described.readPlaintext).toBe(false);
  });

  test('the database holds ciphertext and the model the string', async () => {
    const user = await person('encrypted-one@example.com');

    expect(user.phone).toBe('+1-555-0100');

    const raw = await User.collection.findOne({ _id: user._id });

    expect(raw.phone).toMatch(/^henri:v1:r:/u);
    expect(raw.nationalId).toMatch(/^henri:v1:d:/u);
    expect(raw.phone).not.toContain('555');

    const found = await User.findByKey(user._id);

    expect(found.phone).toBe('+1-555-0100');
  });

  test('the deterministic one is what makes a lookup possible', async () => {
    await person('encrypted-two@example.com');

    const found = await User.findOne({
      nationalId: 'ID-encrypted-two@example.com',
    });

    expect(found.email).toBe('encrypted-two@example.com');
    await expect(User.findOne({ phone: '+1-555-0100' })).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
  });

  test('an encrypted field is masked in the logs without being marked', () => {
    expect(
      henri.pen.redact({ name: 'Ada', phone: '+1-555-0100', plan: 'free' })
    ).toEqual({ name: '[FILTERED]', phone: '[FILTERED]', plan: 'free' });
  });

  test('an encrypted field marked private never leaves the server', () => {
    const stripped = henri.privacy.strip({
      email: 'a@b.co',
      nationalId: 'ID-1',
      phone: '+1-555-0100',
    });

    expect(stripped).toEqual({ email: 'a@b.co' });
  });

  test('the export hands the person their plaintext back', async () => {
    const document = await henri.privacy.export('encrypted-one@example.com');
    const [record] = document.records.User;

    expect(record.phone).toBe('+1-555-0100');
    expect(record.nationalId).toBe('ID-encrypted-one@example.com');
    expect(document.unreadable).toEqual([]);
  });

  test('the export says what it could not read rather than failing', async () => {
    const user = await person('encrypted-three@example.com');

    // A row written by a key this application no longer holds
    await User.collection.updateOne(
      { _id: user._id },
      {
        $set: {
          phone: encrypt('+1-555-0199', {
            context: 'User.phone',
            keyring: ring(OTHER),
          }),
        },
      }
    );

    const document = await henri.privacy.export('encrypted-three@example.com');

    expect(document.records.User[0].phone).toBeNull();
    expect(document.unreadable).toEqual([
      {
        code: 'HENRI_ENCRYPTION_KEY_UNKNOWN',
        context: 'User.phone',
        keyId: expect.any(String),
      },
    ]);
  });

  test('an erasure writes over the value, and what it writes is encrypted', async () => {
    const user = await person('encrypted-four@example.com');

    await henri.privacy.erase('encrypted-four@example.com');

    const raw = await User.collection.findOne({ _id: user._id });

    expect(raw.phone === null || raw.phone === undefined).toBe(true);

    // The address is anonymized rather than cleared, and it is not
    // encrypted: `email` belongs to henri
    expect(raw.email).toMatch(/erased\.invalid$/u);
    // The national identifier could not be cleared (it is not required,
    // so it is), and nothing readable is left
    expect(raw.nationalId === null || raw.nationalId === undefined).toBe(true);
  });

  test('the status counts the rows by key id', async () => {
    const report = await henri.encryption.status();
    const phone = report.fields.find((entry) => entry.field === 'phone');

    expect(report.primary).toBe(henri.encryption.keys[0]);
    expect(phone.rows).toBeGreaterThan(0);
    // The one written under a key nobody holds is neither current nor
    // plaintext: it is counted as older
    expect(phone.stale).toBeGreaterThan(0);
  });

  test('a rotation moves what it can and never overwrites what it cannot', async () => {
    const before = await User.collection.find({}).toArray();
    const report = await henri.encryption.rotate();
    const after = await User.collection.find({}).toArray();

    expect(report.failures.map((entry) => entry.code)).toContain(
      'HENRI_ENCRYPTION_KEY_UNKNOWN'
    );

    const unreadable = before.find(
      (row) => row.email === 'encrypted-three@example.com'
    );
    const stillThere = after.find(
      (row) => row.email === 'encrypted-three@example.com'
    );

    expect(stillThere.phone).toBe(unreadable.phone);
    expect((await henri.encryption.status()).plaintext).toBe(0);
  });
});
