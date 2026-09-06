const tokens = require('../base/tokens');

const secret = 'a-secret-that-is-not-in-the-database';

describe('signed account tokens', () => {
  test('round trips a token bound to a purpose and a seed', () => {
    const token = tokens.mint({
      expiresIn: 60000,
      purpose: 'password-reset',
      secret,
      seed: 'hash-of-the-password',
      subject: 'ada',
    });

    expect(token.startsWith('h1.')).toBe(true);
    expect(
      tokens.verify({
        purpose: 'password-reset',
        secret,
        seed: 'hash-of-the-password',
        token,
      })
    ).toEqual({
      ok: true,
      payload: {
        data: null,
        expiresAt: expect.any(Number),
        purpose: 'password-reset',
        subject: 'ada',
      },
      reason: null,
    });
  });

  test('carries signed data, which anyone can read', () => {
    const token = tokens.mint({
      data: { email: 'new@usehenri.io' },
      expiresIn: 60000,
      purpose: 'email-change',
      secret,
      seed: 'ada@usehenri.io|',
      subject: 'ada',
    });

    expect(tokens.peek(token).data).toEqual({ email: 'new@usehenri.io' });
  });

  test('a token of one purpose is not one of another', () => {
    const token = tokens.mint({
      expiresIn: 60000,
      purpose: 'confirmation',
      secret,
      seed: 'seed',
      subject: 'ada',
    });

    expect(
      tokens.verify({ purpose: 'password-reset', secret, seed: 'seed', token })
    ).toMatchObject({ ok: false, reason: 'purpose' });
  });

  test('a token stops verifying once the seed moves', () => {
    const token = tokens.mint({
      expiresIn: 60000,
      purpose: 'password-reset',
      secret,
      seed: 'first-hash',
      subject: 'ada',
    });

    expect(
      tokens.verify({
        purpose: 'password-reset',
        secret,
        seed: 'second-hash',
        token,
      })
    ).toMatchObject({ ok: false, reason: 'signature' });
  });

  test('expires, and says so only after the signature checked out', () => {
    const token = tokens.mint({
      expiresIn: 1000,
      now: 1000,
      purpose: 'confirmation',
      secret,
      seed: 'seed',
      subject: 'ada',
    });

    expect(
      tokens.verify({
        now: 1999,
        purpose: 'confirmation',
        secret,
        seed: 'seed',
        token,
      })
    ).toMatchObject({ ok: true });
    expect(
      tokens.verify({
        now: 2001,
        purpose: 'confirmation',
        secret,
        seed: 'seed',
        token,
      })
    ).toMatchObject({ ok: false, reason: 'expired' });
    expect(
      tokens.verify({
        now: 2001,
        purpose: 'confirmation',
        secret,
        seed: 'moved',
        token,
      })
    ).toMatchObject({ ok: false, reason: 'signature' });
  });

  test('a rotated secret invalidates the links that were in flight', () => {
    const token = tokens.mint({
      expiresIn: 60000,
      purpose: 'password-reset',
      secret,
      seed: 'seed',
      subject: 'ada',
    });

    expect(
      tokens.verify({
        purpose: 'password-reset',
        secret: 'the-new-secret',
        seed: 'seed',
        token,
      })
    ).toMatchObject({ ok: false, reason: 'signature' });
  });

  test('refuses a token whose claims were edited', () => {
    const token = tokens.mint({
      expiresIn: 1000,
      purpose: 'password-reset',
      secret,
      seed: 'seed',
      subject: 'ada',
    });
    const [version, , mac] = token.split('.');
    const claims = tokens.peek(token);
    const forged = Buffer.from(
      JSON.stringify({
        exp: claims.expiresAt + 86400000,
        pur: claims.purpose,
        sub: 'grace',
      }),
      'utf8'
    ).toString('base64url');

    expect(
      tokens.verify({
        purpose: 'password-reset',
        secret,
        seed: 'seed',
        token: `${version}.${forged}.${mac}`,
      })
    ).toMatchObject({ ok: false, reason: 'signature' });
  });

  test('refuses what is not a token at all', () => {
    for (const token of [
      '',
      'nope',
      'h1.nope',
      'h1..',
      'h2.aaa.bbb',
      `h1.${'a'.repeat(5000)}.bbb`,
      null,
      undefined,
      { toString: () => 'h1.a.b' },
    ]) {
      expect(tokens.peek(token)).toBeNull();
      expect(
        tokens.verify({ purpose: 'confirmation', secret, seed: '', token })
      ).toMatchObject({ ok: false, reason: 'malformed' });
    }
  });

  test('needs a secret, a purpose and a subject', () => {
    expect(() =>
      tokens.mint({ expiresIn: 1, purpose: 'x', secret: '', subject: 'ada' })
    ).toThrow(/secret/);
    expect(() =>
      tokens.mint({ expiresIn: 1, purpose: '', secret, subject: 'ada' })
    ).toThrow(/purpose/);
    expect(() =>
      tokens.mint({ expiresIn: 1, purpose: 'x', secret, subject: '' })
    ).toThrow(/subject/);
  });
});
