const bcrypt = require('bcryptjs');
const {
  DEFAULTS,
  algorithmFor,
  argon2Available,
  hashPassword,
  needsRehash,
  passwordPolicy,
  pepperConfig,
  validatePassword,
  verifyPassword,
} = require('../base/password');

const password = 'correct-horse-battery-staple';

// Argon2 is an optional dependency: the tests that need it say so, and the
// tests that must hold either way never branch on it
const hasArgon2 = argon2Available();

describe('password policy', () => {
  const policy = passwordPolicy({});

  test('refuses a password below the minimum, whatever it is', () => {
    expect(validatePassword('short', policy).valid).toBe(false);
    expect(validatePassword('short', policy).errors[0]).toMatchObject({
      code: 'too_short',
      minLength: 12,
    });

    // Eleven characters is refused, twelve is not
    expect(validatePassword('a'.repeat(11), policy).valid).toBe(false);
    expect(validatePassword('a'.repeat(12), policy).valid).toBe(true);
  });

  test('the minimum is what a comparable framework asks for by default', () => {
    // The number itself is documented and configurable; what matters is that
    // it is not the old six
    expect(DEFAULTS.minLength).toBeGreaterThanOrEqual(12);
    expect(DEFAULTS.bcryptRounds).toBeGreaterThanOrEqual(12);
  });

  test('refuses a missing password without throwing', () => {
    for (const value of [undefined, null, 42, '', {}]) {
      expect(validatePassword(value, policy)).toMatchObject({
        errors: [{ code: 'missing' }],
        valid: false,
      });
    }
  });

  test('refuses what bcrypt would silently truncate', () => {
    // Bcrypt ignores everything past 72 bytes: two different passwords
    // sharing a 72 byte prefix would be the same secret
    const long = `${'a'.repeat(72)}-and-more`;

    expect(validatePassword(long, policy)).toMatchObject({
      errors: [{ code: 'too_long', maxBytes: 72 }],
      valid: false,
    });

    // Bytes, not characters: an emoji is four of them
    expect(validatePassword('🔐'.repeat(18), policy).valid).toBe(true);
    expect(validatePassword('🔐'.repeat(19), policy).valid).toBe(false);
  });

  test('the minimum is configurable, with a floor', () => {
    expect(passwordPolicy({ minLength: 16 }).minLength).toBe(16);
    // Nothing configures its way below eight, or below bcrypt cost ten
    expect(passwordPolicy({ minLength: 6 }).minLength).toBe(8);
    expect(passwordPolicy({ bcryptRounds: 4 }).bcryptRounds).toBe(10);
  });

  test('the cost floor gives way for the suite, the policy does not', () => {
    const test = passwordPolicy({ bcryptRounds: 4 }, { isTest: true });

    expect(test.bcryptRounds).toBe(4);
    expect(passwordPolicy({ minLength: 6 }, { isTest: true }).minLength).toBe(
      8
    );
  });

  test('refuses an algorithm it does not know', () => {
    expect(() => passwordPolicy({ algorithm: 'md5' })).toThrow(TypeError);
    expect(() => passwordPolicy('nope')).toThrow(TypeError);
    expect(() => passwordPolicy({ maxBytes: 8, minLength: 12 })).toThrow(
      TypeError
    );
  });
});

describe('hashing', () => {
  test('produces a hash that verifies, and only for the right password', async () => {
    const policy = passwordPolicy({}, { isTest: true });
    const hash = await hashPassword(password, policy);

    expect(hash).not.toBe(password);
    await expect(verifyPassword(password, hash)).resolves.toMatchObject({
      ok: true,
    });
    await expect(verifyPassword('not-it', hash)).resolves.toMatchObject({
      ok: false,
    });
  });

  test.skipIf(!hasArgon2)(
    'prefers argon2id when the binding is there',
    async () => {
      const policy = passwordPolicy({}, { isTest: true });

      expect(algorithmFor(policy)).toBe('argon2id');
      expect(await hashPassword(password, policy)).toMatch(
        /^\$argon2id\$v=19\$/
      );
    }
  );

  test.runIf(!hasArgon2)('falls back to bcrypt when it is not', async () => {
    const policy = passwordPolicy({}, { isTest: true });

    expect(algorithmFor(policy)).toBe('bcrypt');
    expect(await hashPassword(password, policy)).toMatch(/^\$2[aby]\$/);
  });

  test('bcrypt stays available for applications that pin it', async () => {
    const policy = passwordPolicy({ algorithm: 'bcrypt' }, { isTest: true });
    const hash = await hashPassword(password, policy);

    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    await expect(verifyPassword(password, hash)).resolves.toMatchObject({
      ok: true,
    });
  });

  test('verifies both formats whatever the configured algorithm is', async () => {
    const legacy = await bcrypt.hash(password, await bcrypt.genSalt(4));

    await expect(verifyPassword(password, legacy)).resolves.toMatchObject({
      ok: true,
    });
    await expect(verifyPassword('', legacy)).resolves.toMatchObject({
      ok: false,
    });
    await expect(verifyPassword(password, 'not-a-hash')).resolves.toMatchObject(
      { ok: false }
    );
    await expect(verifyPassword(password, null)).resolves.toMatchObject({
      ok: false,
    });
  });

  test('verifying never applies the policy: a six character password still works', async () => {
    // The password an application accepted before the minimum moved to 12
    const legacy = await bcrypt.hash('sixchr', await bcrypt.genSalt(4));

    await expect(verifyPassword('sixchr', legacy)).resolves.toMatchObject({
      ok: true,
    });
  });
});

describe('the pepper', () => {
  const withPepper = passwordPolicy(
    { pepper: 'a-key-that-lives-outside-the-database' },
    { isTest: true }
  );
  const withoutPepper = passwordPolicy({}, { isTest: true });

  test('is off unless an application asks for one', () => {
    expect(withoutPepper.pepper).toEqual({
      allowUnpeppered: true,
      current: null,
      previous: [],
    });
    expect(pepperConfig(undefined)).toEqual({
      allowUnpeppered: true,
      current: null,
      previous: [],
    });
    expect(() => pepperConfig({ current: '' })).toThrow(TypeError);
    expect(() => pepperConfig(['a'])).toThrow(TypeError);
  });

  test('a peppered hash is worthless to whoever holds only the database', async () => {
    const hash = await hashPassword(password, withPepper);

    // The stolen table alone verifies nothing: cracking it needs the key
    await expect(
      verifyPassword(password, hash, withoutPepper)
    ).resolves.toEqual({ ok: false, stale: false });
    await expect(verifyPassword(password, hash, withPepper)).resolves.toEqual({
      ok: true,
      stale: false,
    });
  });

  test('a hash forged under another key never verifies', async () => {
    const forged = await hashPassword(
      password,
      passwordPolicy({ pepper: 'a-key-the-attacker-guessed' }, { isTest: true })
    );

    await expect(verifyPassword(password, forged, withPepper)).resolves.toEqual(
      { ok: false, stale: false }
    );
  });

  test('once the migration is over, an unpeppered hash is refused outright', async () => {
    // What an attacker with write access but no key can produce: a hash of a
    // password they know, planted on someone else's row
    const planted = await hashPassword(password, withoutPepper);
    const migrated = passwordPolicy(
      {
        pepper: {
          allowUnpeppered: false,
          current: 'a-key-that-lives-outside-the-database',
        },
      },
      { isTest: true }
    );

    // While the migration runs, it still verifies: that is the price of not
    // locking anyone out
    await expect(
      verifyPassword(password, planted, withPepper)
    ).resolves.toEqual({ ok: true, stale: true });

    // Once the application says there are none left, it does not
    await expect(verifyPassword(password, planted, migrated)).resolves.toEqual({
      ok: false,
      stale: false,
    });
  });

  test('adopting one does not lock anyone out: old hashes verify and are stale', async () => {
    const legacy = await hashPassword(password, withoutPepper);

    await expect(verifyPassword(password, legacy, withPepper)).resolves.toEqual(
      { ok: true, stale: true }
    );
    await expect(verifyPassword('not-it', legacy, withPepper)).resolves.toEqual(
      { ok: false, stale: false }
    );
  });

  test('rotating one accepts the old key while the new one takes over', async () => {
    const old = await hashPassword(password, withPepper);
    const rotated = passwordPolicy(
      {
        pepper: {
          current: 'the-new-key',
          previous: ['a-key-that-lives-outside-the-database'],
        },
      },
      { isTest: true }
    );

    // Signed in under the old key: it works, and it is marked for rewriting
    await expect(verifyPassword(password, old, rotated)).resolves.toEqual({
      ok: true,
      stale: true,
    });

    const current = await hashPassword(password, rotated);

    await expect(verifyPassword(password, current, rotated)).resolves.toEqual({
      ok: true,
      stale: false,
    });
  });

  test('works under bcrypt too, which has no key input of its own', async () => {
    const policy = passwordPolicy(
      { algorithm: 'bcrypt', pepper: 'a-key' },
      { isTest: true }
    );
    const hash = await hashPassword(password, policy);

    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    await expect(verifyPassword(password, hash, policy)).resolves.toEqual({
      ok: true,
      stale: false,
    });
    await expect(
      verifyPassword(
        password,
        hash,
        passwordPolicy({ algorithm: 'bcrypt' }, { isTest: true })
      )
    ).resolves.toEqual({ ok: false, stale: false });
  });
});

describe('needsRehash', () => {
  const policy = passwordPolicy({ algorithm: 'bcrypt' });

  test('a bcrypt hash below the configured cost is stale', async () => {
    const weak = await bcrypt.hash(password, await bcrypt.genSalt(10));
    const current = await bcrypt.hash(password, await bcrypt.genSalt(12));

    expect(needsRehash(weak, policy)).toBe(true);
    expect(needsRehash(current, policy)).toBe(false);
  });

  test.skipIf(!hasArgon2)(
    'a bcrypt hash is stale as soon as argon2id is what we write',
    () => {
      const auto = passwordPolicy({});

      expect(needsRehash('$2b$12$abcdefghijklmnopqrstuv', auto)).toBe(true);
    }
  );

  test.skipIf(!hasArgon2)(
    'an argon2id hash below the configured parameters is stale',
    async () => {
      const auto = passwordPolicy({});
      const weak = await hashPassword(
        password,
        passwordPolicy({}, { isTest: true })
      );
      const current = await hashPassword(password, auto);

      expect(needsRehash(weak, auto)).toBe(true);
      expect(needsRehash(current, auto)).toBe(false);
    }
  );

  test.skipIf(!hasArgon2)(
    'never downgrades an argon2id hash to bcrypt',
    async () => {
      // Pinned back to bcrypt on purpose: the stronger hash is left alone
      const strong = await hashPassword(password, passwordPolicy({}));

      expect(needsRehash(strong, policy)).toBe(false);
    }
  );

  test('leaves alone what it cannot read', () => {
    expect(needsRehash('not-a-hash', policy)).toBe(false);
    expect(needsRehash(undefined, policy)).toBe(false);
  });
});
