const {
  BOUND,
  argon2Available,
  bindingConfig,
  bindingIdentity,
  hashPassword,
  isBound,
  needsRehash,
  passwordPolicy,
  pepperConfig,
  unbind,
  verifyPassword,
} = require('../base/password');

const password = 'correct-horse-battery-staple';

// Two rows. The uuids are what the adapters generate (v7), and the whole
// point of the exercise is that a hash made for one is useless on the other.
const ALICE = '01998f6a-0d4e-7a11-8f2a-0242ac120002';
const MALLORY = '01998f6a-1b7c-7c33-9d18-0242ac120003';

const policyOf = (extra = {}) => passwordPolicy(extra, { isTest: true });

// Argon2 is an optional dependency: nothing here branches on it, both
// backends have to hold
const hasArgon2 = argon2Available();

describe('binding configuration', () => {
  test('is on by default, and accepts the hashes written before it', () => {
    expect(policyOf().binding).toEqual({ allowUnbound: true, enabled: true });
    expect(bindingConfig(undefined)).toEqual({
      allowUnbound: true,
      enabled: true,
    });
  });

  test('a boolean is the switch, an object is the pair', () => {
    expect(bindingConfig(false)).toEqual({
      allowUnbound: true,
      enabled: false,
    });
    expect(bindingConfig({ allowUnbound: false })).toEqual({
      allowUnbound: false,
      enabled: true,
    });
    expect(bindingConfig({ enabled: false })).toEqual({
      allowUnbound: true,
      enabled: false,
    });
  });

  test('refuses a shape it cannot read rather than guessing', () => {
    expect(() => bindingConfig('yes')).toThrow(/must be a boolean/u);
    expect(() => bindingConfig([true])).toThrow(/must be a boolean/u);
  });

  test('only a uuid is an identity, and its case does not matter', () => {
    expect(bindingIdentity(ALICE)).toBe(ALICE);
    expect(bindingIdentity(ALICE.toUpperCase())).toBe(ALICE);
    // A primary key, an ObjectId and an empty string are not identities: a
    // hash bound to "1" would move to the next table with a row 1
    for (const value of [
      1,
      '1',
      '',
      null,
      undefined,
      {},
      '507f1f77bcf86cd799439011',
    ]) {
      expect(bindingIdentity(value)).toBeNull();
    }
  });
});

describe('a hash bound to its row', () => {
  test('carries the marker, and the hash underneath is unchanged in kind', async () => {
    const policy = policyOf();
    const hash = await hashPassword(password, policy, ALICE);

    expect(isBound(hash)).toBe(true);
    expect(hash.startsWith(BOUND)).toBe(true);
    expect(unbind(hash)).toMatch(hasArgon2 ? /^\$argon2id\$/u : /^\$2[aby]\$/u);
    // It has to fit the column every adapter gives it (varchar(255))
    expect(hash.length).toBeLessThan(255);
  });

  test('verifies against the row it was made for', async () => {
    const policy = policyOf();
    const hash = await hashPassword(password, policy, ALICE);

    await expect(
      verifyPassword(password, hash, policy, ALICE)
    ).resolves.toEqual({ ok: true, stale: false });
  });

  test('does NOT verify against another row: this is the whole point', async () => {
    const policy = policyOf();
    const hash = await hashPassword(password, policy, ALICE);

    // Mallory knows the password and copied the bytes onto her own row
    await expect(
      verifyPassword(password, hash, policy, MALLORY)
    ).resolves.toEqual({ ok: false, stale: false });
  });

  test('the wrong password is still the wrong password', async () => {
    const policy = policyOf();
    const hash = await hashPassword(password, policy, ALICE);

    await expect(
      verifyPassword('not-the-password', hash, policy, ALICE)
    ).resolves.toEqual({ ok: false, stale: false });
  });

  test('cannot be verified without the record, and says so out loud', async () => {
    const policy = policyOf();
    const hash = await hashPassword(password, policy, ALICE);

    // Answering "wrong password" here would be a mystery lockout
    await expect(verifyPassword(password, hash, policy)).rejects.toThrow(
      /bound to the record it belongs to/u
    );
    await expect(
      verifyPassword(password, hash, policy, 'not-a-uuid')
    ).rejects.toThrow(/bound to the record it belongs to/u);
  });

  test('stripping the marker does not turn it back into a usable hash', async () => {
    const policy = policyOf();
    const hash = await hashPassword(password, policy, ALICE);
    const stripped = unbind(hash);

    // An attacker who removes the marker is left with the hash of a digest,
    // not the hash of the password
    expect(isBound(stripped)).toBe(false);
    await expect(
      verifyPassword(password, stripped, policy, ALICE)
    ).resolves.toEqual({ ok: false, stale: false });
    await expect(verifyPassword(password, stripped, policy)).resolves.toEqual({
      ok: false,
      stale: false,
    });
  });

  test('two rows sharing a password do not share a hash', async () => {
    const policy = policyOf();
    const one = await hashPassword(password, policy, ALICE);
    const two = await hashPassword(password, policy, MALLORY);

    expect(unbind(one)).not.toBe(unbind(two));
  });

  test('the identity cannot be slid into the password', async () => {
    const policy = policyOf();
    // Without a separator, hashing (identity + password) would let a row
    // whose uuid is a prefix of another's share a preimage. The uuid is
    // fixed width and the separator is a NUL, so this must not verify.
    const hash = await hashPassword(password, policy, ALICE);
    const slid = `${ALICE}${password}`;

    await expect(verifyPassword(slid, hash, policy, '')).rejects.toThrow();
    await expect(
      verifyPassword(slid, hash, policy, ALICE)
    ).resolves.toMatchObject({ ok: false });
  });
});

describe('the hashes that were already there', () => {
  test('an unbound hash still verifies, and asks to be written again', async () => {
    const policy = policyOf();
    // What the previous version of henri wrote
    const legacy = await hashPassword(password, policy, null);

    expect(isBound(legacy)).toBe(false);

    // It verifies, and `stale` is how the sign-in path knows to rebind it
    await expect(
      verifyPassword(password, legacy, policy, ALICE)
    ).resolves.toEqual({ ok: true, stale: true });
  });

  test('an unbound hash is not stale when nothing can bind it', async () => {
    const policy = policyOf();
    const legacy = await hashPassword(password, policy, null);

    // A user model without an externalId: nothing to bind to, nothing to do
    await expect(verifyPassword(password, legacy, policy)).resolves.toEqual({
      ok: true,
      stale: false,
    });
  });

  test('the residual: while allowUnbound is on, a planted unbound hash works', async () => {
    // This is the honest limit of the defence and it is pinned here so that
    // nobody has to rediscover it. An attacker who can write the table can
    // write an unbound hash of a password they know, and while the migration
    // is running it is accepted -- the binding stops a hash being *moved*,
    // not a database being writable. `allowUnbound: false` is what shuts it,
    // and the test below is that.
    const policy = policyOf();

    expect(policy.binding).toEqual({ allowUnbound: true, enabled: true });

    const planted = await hashPassword('the-password-they-know', policy, null);

    await expect(
      verifyPassword('the-password-they-know', planted, policy, MALLORY)
    ).resolves.toMatchObject({ ok: true });
  });

  test('allowUnbound: false ends the migration by refusing them', async () => {
    const policy = policyOf();
    const legacy = await hashPassword(password, policy, null);
    const strict = policyOf({ binding: { allowUnbound: false } });

    // Right password, right row, refused: the operator declared the
    // migration over and this hash is no longer evidence of anything
    await expect(
      verifyPassword(password, legacy, strict, ALICE)
    ).resolves.toEqual({ ok: false, stale: false });

    // And a bound one still works
    const bound = await hashPassword(password, strict, ALICE);

    await expect(
      verifyPassword(password, bound, strict, ALICE)
    ).resolves.toEqual({ ok: true, stale: false });
  });

  test('binding off writes exactly what it always wrote', async () => {
    const policy = policyOf({ binding: false });
    const hash = await hashPassword(password, policy, ALICE);

    // The identity is ignored: no marker, and it verifies with no identity
    expect(isBound(hash)).toBe(false);
    await expect(verifyPassword(password, hash, policy)).resolves.toEqual({
      ok: true,
      stale: false,
    });
  });
});

describe('the marker and the rest of the machinery', () => {
  test('needsRehash sees through it, or bound hashes would never improve', async () => {
    const cheap = policyOf({ bcryptRounds: 4, memoryCost: 8192, timeCost: 1 });
    const hash = await hashPassword(password, cheap, ALICE);

    expect(isBound(hash)).toBe(true);
    // At the parameters it was written with, nothing to do
    expect(needsRehash(hash, cheap)).toBe(false);

    // Raise them and the bound hash must be recognised as behind, not
    // dismissed as an unknown format
    const stronger = policyOf({
      bcryptRounds: 12,
      memoryCost: 65536,
      timeCost: 4,
    });

    expect(needsRehash(hash, stronger)).toBe(true);
  });

  test('a pepper and a binding compose, and rotation still works', async () => {
    const first = policyOf({ pepper: 'the-first-key' });
    const hash = await hashPassword(password, first, ALICE);

    await expect(verifyPassword(password, hash, first, ALICE)).resolves.toEqual(
      { ok: true, stale: false }
    );

    // Rotated: the old key moves to `previous`, the hash still verifies and
    // is reported stale so the sign-in path rewrites it
    const rotated = policyOf({
      pepper: { current: 'the-second-key', previous: ['the-first-key'] },
    });

    await expect(
      verifyPassword(password, hash, rotated, ALICE)
    ).resolves.toEqual({ ok: true, stale: true });

    // And the wrong key does not open it
    const wrong = policyOf({ pepper: 'a-key-nobody-has' });

    await expect(verifyPassword(password, hash, wrong, ALICE)).resolves.toEqual(
      { ok: false, stale: false }
    );
  });

  test('a peppered bound hash is worthless on another row too', async () => {
    const policy = policyOf({ pepper: 'the-key' });
    const hash = await hashPassword(password, policy, ALICE);

    await expect(
      verifyPassword(password, hash, policy, MALLORY)
    ).resolves.toEqual({ ok: false, stale: false });
  });

  test('binding does not cost the pepper: without the key it stays shut', async () => {
    // The binding must not have replaced the pepper by accident. A stolen
    // table is still uncrackable without the key, bound or not.
    const policy = policyOf({ pepper: 'the-key' });
    const hash = await hashPassword(password, policy, ALICE);
    const keyless = policyOf();

    expect(keyless.pepper.current).toBeNull();
    await expect(
      verifyPassword(password, hash, keyless, ALICE)
    ).resolves.toEqual({ ok: false, stale: false });
  });

  test('the pepper is not the binding key: they are separately derived', async () => {
    const policy = policyOf({ pepper: 'the-key' });
    const bound = await hashPassword(password, policy, ALICE);
    const plain = await hashPassword(password, policy, null);

    // Nothing about the peppered-but-unbound hash verifies the bound one
    expect(unbind(bound)).not.toBe(plain);
    await expect(
      verifyPassword(password, plain, policy, ALICE)
    ).resolves.toMatchObject({ ok: true });
  });

  test('an empty or malformed stored value is never a match', async () => {
    const policy = policyOf();

    for (const value of ['', null, undefined, 42, BOUND]) {
      await expect(
        verifyPassword(password, value, policy, ALICE)
      ).resolves.toMatchObject({ ok: false });
    }
  });

  test('a bound bcrypt hash is under the 72 byte ceiling whatever the password', async () => {
    // Bound hashes always go through a 44 byte digest, so two long passwords
    // sharing a 72 byte prefix cannot collide
    const policy = policyOf({ algorithm: 'bcrypt' });
    const long = 'a'.repeat(72);
    const longer = `${long}-and-something-else`;
    const hash = await hashPassword(long, policy, ALICE);

    await expect(verifyPassword(long, hash, policy, ALICE)).resolves.toEqual({
      ok: true,
      stale: false,
    });
    await expect(verifyPassword(longer, hash, policy, ALICE)).resolves.toEqual({
      ok: false,
      stale: false,
    });
  });

  test('an unpeppered binding still refuses a relocated hash', async () => {
    // Without a pepper the binding is unkeyed, which is documented: it stops
    // the copy, not the recompute. The copy has to stay stopped.
    const policy = policyOf();

    expect(policy.pepper.current).toBeNull();

    const hash = await hashPassword(password, policy, ALICE);

    await expect(
      verifyPassword(password, hash, policy, MALLORY)
    ).resolves.toEqual({ ok: false, stale: false });
  });

  test('pepperConfig is untouched by any of this', () => {
    expect(pepperConfig(undefined)).toEqual({
      allowUnpeppered: true,
      current: null,
      previous: [],
    });
  });
});
