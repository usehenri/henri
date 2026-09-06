// Encrypted attributes, in a real application on a real PostgreSQL.
//
// `app/models/User.js` marks `phone` encrypted. This file is what proves it
// is not decorative: the column holds an envelope, the model hands back the
// number, the account page still works, the export a speaker may ask for
// still holds their number, an erasure still removes it, and a key rotation
// walks the table without touching anything else.
//
// The key comes from HENRI_ENCRYPTION_KEYS (.env.example, and the CI job),
// never from config/*.json.
const {
  create,
  inertiaVersion,
  page,
  request,
  reset,
  signIn,
} = require('./helpers');

/**
 * The `phone` column of a row, as PostgreSQL holds it: through the store's
 * raw query, so no model, no getter and no hook is in the way
 *
 * @param {number} id The primary key of the user
 * @returns {Promise<?string>} What the column holds
 */
const storedPhone = async (id) => {
  const rows = await henri.model.stores.default.query(
    'SELECT phone FROM users WHERE id = $1',
    [id]
  );

  return rows[0] ? rows[0].phone : null;
};

describe('encrypted attributes', () => {
  beforeAll(async () => {
    await inertiaVersion();
  });

  beforeEach(async () => {
    await reset();
  });

  describe('the mark', () => {
    test('is one field, randomised, and the application says which', () => {
      const described = henri.encryption.describe();

      expect(described.enabled).toBe(true);
      expect(described.fields).toEqual([
        { deterministic: false, field: 'phone', model: 'User' },
      ]);
      expect(described.readPlaintext).toBe(false);
      expect(described.keys).toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f]{8}$/u),
          primary: true,
          source: 'HENRI_ENCRYPTION_KEYS',
        },
      ]);
    });

    test('the key is not the secret, and neither is in the answer', () => {
      const described = JSON.stringify(henri.encryption.describe());

      expect(described).not.toContain(process.env.HENRI_ENCRYPTION_KEYS);
      expect(described).not.toContain(henri.config.get('secret'));
    });
  });

  describe('the column and the model', () => {
    test('PostgreSQL holds an envelope, the model holds the number', async () => {
      const speaker = await create('user', { phone: '+1-555-0100' });

      expect(speaker.phone).toBe('+1-555-0100');

      const stored = await storedPhone(speaker.id);

      expect(stored).toMatch(/^henri:v1:r:[0-9a-f]{8}:/u);
      expect(stored).not.toContain('555');
      expect(stored).not.toContain('0100');

      const found = await User.findByKey(speaker.id);

      expect(found.phone).toBe('+1-555-0100');
      expect(found.toJSON().phone).toBe('+1-555-0100');
    });

    test('two speakers with the same number share no bytes', async () => {
      const one = await create('user', { phone: '+1-555-0100' });
      const two = await create('user', { phone: '+1-555-0100' });

      expect(await storedPhone(one.id)).not.toBe(await storedPhone(two.id));
      expect((await User.findByKey(two.id)).phone).toBe('+1-555-0100');
    });

    test('the whole column is ciphertext, whoever wrote the row', async () => {
      await create('user', { phone: '+1-555-0100' });
      await create('user', { phone: '+1-555-0101' });
      await create('user');

      const rows = await henri.model.stores.default.query(
        'SELECT phone FROM users'
      );
      const written = rows.map((row) => row.phone).filter(Boolean);

      expect(written).toHaveLength(2);
      expect(written.every((value) => value.startsWith('henri:v1:r:'))).toBe(
        true
      );
    });

    test('nothing may look a speaker up by their number', async () => {
      await create('user', { phone: '+1-555-0100' });

      await expect(User.findOne({ phone: '+1-555-0100' })).rejects.toThrow(
        expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
      );
    });
  });

  describe('the account page, which is what writes it', () => {
    test('a speaker sets their number and reads it back', async () => {
      const speaker = await create('user', { name: 'Ada Lovelace' });
      const { browser, csrf } = await signIn(speaker);

      const saved = await browser
        .patch('/account')
        .set('X-CSRF-Token', csrf)
        .set('Accept', 'application/json')
        .send({
          bio: '',
          company: '',
          name: 'Ada Lovelace',
          phone: '+1-555-0100',
        });

      expect(saved.status).toBeLessThan(400);

      const stored = await storedPhone(speaker.id);

      expect(stored).toMatch(/^henri:v1:r:/u);

      const account = await page(browser, '/account');

      expect(account.body.props.data.account.phone).toBe('+1-555-0100');
    });

    test('it still never leaves in an answer henri builds', async () => {
      const speaker = await create('user', { phone: '+1-555-0100' });

      await create('proposal', 'accepted', { speakerId: speaker.id });

      const answer = await request()
        .get('/proposals')
        .set('Accept', 'application/hal+json');

      expect(answer.status).toBe(200);
      expect(JSON.stringify(answer.body)).not.toContain('phone');
      expect(JSON.stringify(answer.body)).not.toContain('henri:v1:');
    });
  });

  describe('the person, and what they may ask for', () => {
    test('an export hands back the number, not the envelope', async () => {
      const speaker = await create('user', { phone: '+1-555-0100' });
      const document = await henri.privacy.export(speaker.email);

      expect(document.records.User[0].phone).toBe('+1-555-0100');
      expect(document.unreadable).toEqual([]);
      expect(JSON.stringify(document)).not.toContain('henri:v1:');
    });

    test('an erasure removes it from the column, not only from the model', async () => {
      const speaker = await create('user', { phone: '+1-555-0100' });

      await henri.privacy.erase(speaker.email, { strategy: 'delete' });

      expect(await storedPhone(speaker.id)).toBeNull();
    });
  });

  describe('a rotation', () => {
    const ORIGINAL = process.env.HENRI_ENCRYPTION_KEYS;
    const NEXT =
      '00000000000000000000000000000000000000000000000000000000000000f2';

    /**
     * Points the running application at a set of keys
     *
     * @param {Array<string>} keys The keys, the one that writes first
     * @returns {Promise<void>} Resolves when loaded
     */
    const rekey = async (keys) => {
      const config = { ...henri.config.config, encryption: { keys } };

      henri.config.config = Object.freeze(config);
      await henri.encryption.init();
    };

    afterAll(async () => {
      await rekey([ORIGINAL]);
    });

    test('moves every row to the new key, and leaves updatedAt alone', async () => {
      const speakers = await Promise.all([
        create('user', { phone: '+1-555-0100' }),
        create('user', { phone: '+1-555-0101' }),
        create('user', { phone: '+1-555-0102' }),
      ]);
      const before = await henri.model.stores.default.query(
        'SELECT id, phone, updated_at FROM users ORDER BY id'
      );

      expect((await henri.encryption.status()).ok).toBe(true);

      await rekey([NEXT, ORIGINAL]);

      // Every old row is still readable, and every one of them is stale
      expect((await User.findByKey(speakers[0].id)).phone).toBe('+1-555-0100');

      const stale = await henri.encryption.status();

      expect(stale.ok).toBe(false);
      expect(stale.stale).toBe(3);

      const report = await henri.encryption.rotate();

      expect(report.failures).toEqual([]);
      expect(report.rotated).toBe(3);
      expect((await henri.encryption.status()).ok).toBe(true);

      const after = await henri.model.stores.default.query(
        'SELECT id, phone, updated_at FROM users ORDER BY id'
      );

      // The bytes changed, the record did not
      expect(after.map((row) => row.phone)).not.toEqual(
        before.map((row) => row.phone)
      );
      expect(after.map((row) => String(row.updated_at))).toEqual(
        before.map((row) => String(row.updated_at))
      );

      // And with the old key dropped, everything still reads
      await rekey([NEXT]);

      expect((await User.findByKey(speakers[2].id)).phone).toBe('+1-555-0102');
    });
  });
});
