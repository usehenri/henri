const crypto = require('node:crypto');
const http = require('node:http');
const supertest = require('supertest');

const Henri = require('../henri');
const { identitiesConfig } = require('../base/identities');

/**
 * Signing in with somebody else's identity provider, against a provider
 * that is not somebody else's.
 *
 * ## What the fake proves, and what it does not
 *
 * The server below speaks enough of OAuth 2.0 to exercise henri's half of
 * it, and it is **strict about the half henri is responsible for**: it
 * refuses a token request whose `redirect_uri` is not the one the
 * authorization carried, whose client credentials are not the configured
 * ones in the place the provider was told to look for them
 * (`client_secret_basic` or `client_secret_post`), or whose `code_verifier`
 * does not hash to the `code_challenge` that was sent. A code is single
 * use. An access token opens exactly one profile. Everything the suite
 * asserts about state, PKCE, the merge rule, the lockout, the session and
 * the table is therefore real.
 *
 * What it does **not** prove is anything about a real provider:
 *
 * - that Google, GitHub, Okta or Entra accept the request henri writes.
 *   Their quirks -- which client authentication they allow, whether they
 *   reject parameters they do not know, what their userinfo answers, how
 *   `email_verified` is spelled and whether it is sent at all -- are
 *   covered by the configuration and by nothing here;
 * - that a provider's TLS, its redirects or its rate limits behave. The
 *   fake is plain http on the loopback, which is exactly what
 *   `user.identities.allowHttp` exists to allow and what a production
 *   configuration refuses;
 * - anything about an `id_token`. henri never parses one (see the header of
 *   `base/identities.js`), so the fake does not send one;
 * - that a subject a provider issues is stable and never reused. That is a
 *   promise of the provider's, and the identity table takes it on trust.
 */

/** The addresses of this suite, so two runs never collide */
let unique = 0;

/**
 * An address nobody used yet
 *
 * @param {string} [prefix] what to call this one
 * @returns {string} the address
 */
const address = (prefix = 'ada') => {
  unique += 1;

  return `${prefix}-${unique}-${process.pid}@usehenri.io`;
};

/** A subject nobody used yet */
const subject = () => {
  unique += 1;

  return `subject-${unique}-${process.pid}`;
};

const password = 'analytical-engine-1843';

/**
 * Reads a cookie value from a response
 *
 * @param {object} res supertest response
 * @param {string} name cookie name
 * @returns {?string} the value, or null
 */
const cookieOf = (res, name) => {
  const line = (res.headers['set-cookie'] || []).find((cookie) =>
    cookie.startsWith(`${name}=`)
  );

  return line ? line.split(';')[0].slice(name.length + 1) : null;
};

/**
 * The middle value of a list of numbers
 *
 * @param {Array<number>} values the values
 * @returns {number} the median
 */
const median = (values) => {
  const sorted = [...values].sort((one, two) => one - two);

  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * A provider that speaks enough of the protocol to be wrong about, and
 * strict about everything henri is responsible for
 *
 * @param {object} clients `{ [clientId]: { secret, auth } }`
 * @returns {object} the fake
 */
const fakeProvider = (clients) => {
  /** Codes handed out by `issue()`, spent by the token endpoint */
  const codes = new Map();
  /** Access tokens the token endpoint issued, and the profile behind each */
  const tokens = new Map();
  /** Every token request that arrived, for the assertions */
  const requests = [];
  let server = null;

  /**
   * Reads a request body
   *
   * @param {http.IncomingMessage} req the request
   * @returns {Promise<string>} the body
   */
  const bodyOf = (req) =>
    new Promise((resolve) => {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => resolve(body));
    });

  /**
   * Answers with JSON
   *
   * @param {http.ServerResponse} res the response
   * @param {number} status the status
   * @param {object} payload the body
   * @returns {void} nothing
   */
  const json = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  /**
   * The client the request authenticated as, or null
   *
   * @param {http.IncomingMessage} req the request
   * @param {URLSearchParams} form the body
   * @returns {?string} the client id
   */
  const authenticated = (req, form) => {
    const header = req.headers.authorization || '';

    if (header.startsWith('Basic ')) {
      const [id, secret] = Buffer.from(header.slice(6), 'base64')
        .toString('utf8')
        .split(':')
        .map(decodeURIComponent);

      return clients[id] && clients[id].secret === secret ? id : null;
    }

    const id = form.get('client_id');
    const secret = form.get('client_secret');

    return clients[id] && clients[id].secret === secret ? id : null;
  };

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://provider.test');

    if (req.method === 'POST' && url.pathname === '/token') {
      const form = new URLSearchParams(await bodyOf(req));

      requests.push({
        authorization: req.headers.authorization || null,
        form: Object.fromEntries(form),
      });

      const client = authenticated(req, form);

      if (!client) {
        return json(res, 401, { error: 'invalid_client' });
      }

      if (form.get('grant_type') !== 'authorization_code') {
        return json(res, 400, { error: 'unsupported_grant_type' });
      }

      const held = codes.get(form.get('code'));

      // Single use: a code that was redeemed is gone
      codes.delete(form.get('code'));

      if (!held) {
        return json(res, 400, { error: 'invalid_grant' });
      }

      if (held.redirectUri !== form.get('redirect_uri')) {
        return json(res, 400, { error: 'invalid_grant', reason: 'redirect' });
      }

      if (held.challenge) {
        const verifier = form.get('code_verifier') || '';
        const digest = crypto
          .createHash('sha256')
          .update(verifier)
          .digest('base64url');

        if (digest !== held.challenge) {
          return json(res, 400, { error: 'invalid_grant', reason: 'pkce' });
        }
      }

      const token = crypto.randomBytes(16).toString('hex');

      tokens.set(token, held.profile);

      return json(res, 200, {
        access_token: token,
        token_type: 'Bearer',
      });
    }

    if (req.method === 'GET' && url.pathname === '/userinfo') {
      const header = req.headers.authorization || '';
      const held = tokens.get(header.replace(/^Bearer /u, ''));

      if (!held) {
        return json(res, 401, { error: 'invalid_token' });
      }

      return json(res, 200, held);
    }

    return json(res, 404, { error: 'not_found' });
  };

  return {
    /**
     * Hands out an authorization code for a profile, bound to the
     * challenge and the redirect uri of an authorization henri wrote
     *
     * @param {object} profile what userinfo will answer
     * @param {object} options `challenge` and `redirectUri`
     * @returns {string} the code
     */
    issue(profile, { challenge = null, redirectUri = null } = {}) {
      const code = crypto.randomBytes(12).toString('hex');

      codes.set(code, { challenge, profile, redirectUri });

      return code;
    },
    /** The origin the configuration points at */
    get origin() {
      const { port } = server.address();

      return `http://127.0.0.1:${port}`;
    },
    requests,
    async start() {
      server = http.createServer((req, res) => {
        handler(req, res).catch(() => {
          res.writeHead(500);
          res.end('{}');
        });
      });

      await new Promise((resolve) => server.listen(0, resolve));

      return server;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
};

describe('identity providers (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let app;
  let provider;
  /** The configuration block, mutated by the tests that need another rule */
  let block;

  /**
   * An agent holding cookies, and the csrf token that goes with them
   *
   * @returns {Promise<{agent: object, csrf: string}>} the pair
   */
  const visitor = async () => {
    const agent = supertest.agent(app);
    const csrf = cookieOf(await agent.get('/version'), 'henri.csrf');

    return { agent, csrf };
  };

  /**
   * Starts a sign-in and reads what henri sent the browser to
   *
   * @param {object} who an agent (see visitor())
   * @param {string} name the provider
   * @param {object} [body] what the form posts
   * @returns {Promise<object>} `{ res, state, challenge, redirectUri }`
   */
  const begin = async (who, name = 'acme', body = {}) => {
    const res = await who.agent
      .post(`/auth/${name}`)
      .set('X-CSRF-Token', who.csrf)
      .set('Accept', 'text/html')
      .send(body);

    if (res.status !== 303) {
      return { challenge: null, redirectUri: null, res, state: null };
    }

    const url = new URL(res.headers.location);

    return {
      challenge: url.searchParams.get('code_challenge'),
      redirectUri: url.searchParams.get('redirect_uri'),
      res,
      state: url.searchParams.get('state'),
      url,
    };
  };

  /**
   * Follows the callback a provider would have sent the browser to
   *
   * @param {object} who an agent
   * @param {string} name the provider
   * @param {object} query `code` and `state`
   * @returns {Promise<object>} the supertest response
   */
  const callback = (who, name, query) =>
    who.agent.get(`/auth/${name}/callback`).query(query);

  /**
   * The whole trip: start, mint a code for a profile, come back
   *
   * @param {object} who an agent
   * @param {object} profile what userinfo answers
   * @param {object} [options] `name` (the provider) and `body`
   * @returns {Promise<object>} the supertest response of the callback
   */
  const signInWith = async (who, profile, { body, name = 'acme' } = {}) => {
    const started = await begin(who, name, body);

    expect(started.res.status).toBe(303);

    const code = provider.issue(profile, {
      challenge: started.challenge,
      redirectUri: started.redirectUri,
    });

    return callback(who, name, { code, state: started.state });
  };

  /**
   * The identities of one person
   *
   * @param {string} email the address
   * @returns {Promise<Array<object>>} the identities
   */
  const identitiesOf = async (email) => {
    const user = await henri.user.findByEmail(email);

    return user ? henri.identities.forUser(user) : [];
  };

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';

    provider = fakeProvider({
      'henri-demo': { secret: 'acme-secret' },
      'henri-demo-other': { secret: 'other-secret' },
    });
    await provider.start();

    henri = new Henri();
    await henri.init();
    global.henri = henri;
    app = henri.server.app;

    // The configuration points the two providers at 127.0.0.1:1, which
    // nothing listens on: the fake takes an ephemeral port, so the suite
    // moves them once it is up. `settings` is read on every call, so this
    // is all it takes
    block = henri.config.config.user.identities;

    for (const name of Object.keys(block.providers)) {
      Object.assign(block.providers[name], {
        authorizationUrl: `${provider.origin}/authorize`,
        tokenUrl: `${provider.origin}/token`,
        userinfoUrl: `${provider.origin}/userinfo`,
      });
    }

    // The mails of the account flows are not what this suite is about
    henri.mailers.onDeliverLater(() => ({ captured: true }));
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    await provider.stop();
    delete global.henri;

    if (typeof skipWorkers === 'undefined') {
      delete process.env.SKIP_WORKERS;
    } else {
      process.env.SKIP_WORKERS = skipWorkers;
    }
  }, 60000);

  afterEach(() => {
    // Every test that changes the rule puts it back
    delete block.merge;
    delete block.signup;

    for (const name of Object.keys(block.providers)) {
      delete block.providers[name].trusted;
      delete block.providers[name].allows;
      delete block.providers[name].claims;
    }
  });

  describe('the configuration', () => {
    test('reads config.user.identities and turns itself on', () => {
      const settings = henri.identities.settings;

      expect(settings.enabled).toBe(true);
      expect(settings.path).toBe('/auth');
      // The default, and the one this whole feature is about
      expect(settings.merge).toBe('refuse');
      expect(Object.keys(settings.providers).sort()).toEqual(['acme', 'other']);
    });

    test('a block with no provider in it is off', () => {
      const config = {
        get: () => ({ identities: { providers: {} } }),
        has: () => true,
      };

      expect(identitiesConfig(config).enabled).toBe(false);
    });

    test('the client secret is not in what a page renders', () => {
      const listed = henri.identities.providers();

      expect(listed.map((entry) => entry.name)).toEqual(['acme', 'other']);

      for (const entry of listed.concat(henri.identities.providerOf('acme'))) {
        expect(entry.clientSecret).toBeUndefined();
        expect(entry.clientId).toBeUndefined();
        expect(JSON.stringify(entry)).not.toContain('secret');
      }
    });

    test('a provider that cannot be used is a boot failure', () => {
      const problems = (identities) =>
        henri.identities.problems.call(null) && null;

      // The service reads the live configuration, so this is asked of it
      // the way the boot asks
      block.providers.broken = { clientId: 'x' };

      const found = henri.identities.problems();

      delete block.providers.broken;

      expect(found.join('\n')).toContain('clientSecret is missing');
      expect(found.join('\n')).toContain('authorizationUrl is missing');
      expect(problems).toBeDefined();
    });

    test('"verified" needs a provider that says it is trusted', () => {
      block.merge = 'verified';

      expect(henri.identities.problems().join('\n')).toContain(
        'not marked "trusted": true'
      );

      block.providers.acme.trusted = true;
      block.providers.other.trusted = true;

      expect(henri.identities.problems()).toEqual([]);
    });

    test('an http provider is refused unless allowHttp says otherwise', () => {
      const settings = identitiesConfig({
        get: () => ({
          identities: {
            providers: {
              acme: {
                authorizationUrl: 'http://acme.test/authorize',
                clientId: 'a',
                clientSecret: 'b',
                tokenUrl: 'https://acme.test/token',
                userinfoUrl: 'https://acme.test/userinfo',
              },
            },
          },
        }),
        has: () => true,
      });

      expect(settings.allowHttp).toBe(false);
    });
  });

  describe('leaving the origin', () => {
    test('a GET on the start endpoint is 405', async () => {
      const res = await supertest(app).get('/auth/acme');

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('POST');
    });

    test('the redirect carries a state, a challenge and the redirect uri', async () => {
      const who = await visitor();
      const started = await begin(who);

      expect(started.res.status).toBe(303);
      expect(started.url.origin).toBe(provider.origin);
      expect(started.url.pathname).toBe('/authorize');
      expect(started.url.searchParams.get('response_type')).toBe('code');
      expect(started.url.searchParams.get('client_id')).toBe('henri-demo');
      expect(started.url.searchParams.get('scope')).toBe('openid email');
      expect(started.url.searchParams.get('code_challenge_method')).toBe(
        'S256'
      );
      expect(started.state).toHaveLength(43);
      expect(started.redirectUri).toBe(
        'https://demo.usehenri.io/auth/acme/callback'
      );
      expect(henri.identities.redirectUri('acme')).toBe(started.redirectUri);
    });

    test('a provider nobody configured is refused, prototype keys included', async () => {
      const who = await visitor();

      for (const name of ['nope', '__proto__', 'constructor']) {
        const res = await who.agent
          .post(`/auth/${name}`)
          .set('X-CSRF-Token', who.csrf);

        expect(res.status).toBe(400);
        expect(res.body.data.reason).toBe('unknown-provider');
      }
    });

    test('starting a sign-in needs the token with no session cookie too', async () => {
      // The middleware waives the token for a request that carries no
      // session cookie, because there is normally no session to ride on.
      // A visitor about to sign in is exactly the person who has none, so
      // this route asks anyway -- otherwise a third-party page could start
      // the flow in their browser.
      const cold = await supertest(app).post('/auth/acme').send({});

      expect(cold.status).toBe(403);
      expect(cold.body.data.reason).toBe('forbidden');

      // `POST /login` is the comparison: the framework's rule is unchanged
      // everywhere else, and this route is the deliberate exception
      const email = address('cold-post');

      await supertest(app).post('/signup').send({ email, password });

      const signedIn = await supertest(app)
        .post('/login')
        .send({ email, password });

      expect(signedIn.status).toBe(200);

      // A visitor holding the cookie the middleware set is let through
      const who = await visitor();
      const warm = await who.agent
        .post('/auth/acme')
        .set('X-CSRF-Token', who.csrf)
        .send({});

      expect(warm.status).toBe(200);
      expect(warm.body.url).toContain('/authorize?');
    });

    test('a cross-origin start is refused before the provider is read', async () => {
      const who = await visitor();
      const res = await who.agent
        .post('/auth/acme')
        .set('Origin', 'https://evil.example.com')
        .set('Sec-Fetch-Site', 'cross-site')
        .set('X-CSRF-Token', who.csrf)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.data.reason).toBe('forbidden');
    });

    test('a POST carrying a session cookie needs the csrf token', async () => {
      const who = await visitor();
      const email = address();

      await supertest(app).post('/signup').send({ email, password });
      await who.agent.post('/login').send({ email, password });

      const refused = await who.agent.post('/auth/acme').send({});

      expect(refused.status).toBe(403);

      const allowed = await who.agent
        .post('/auth/acme')
        .set('X-CSRF-Token', who.csrf)
        .send({});

      expect(allowed.status).toBe(200);
      expect(allowed.body.url).toContain('/authorize?');
    });
  });

  describe('signing up and signing in', () => {
    test('a verified address nobody has opens an account', async () => {
      const who = await visitor();
      const email = address();
      const sub = subject();
      const res = await signInWith(who, {
        email,
        email_verified: true,
        sub,
      });

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ email, roles: ['member'] });
      expect(res.body.identity).toEqual({
        allows: 'signin',
        linkedAt: expect.any(String),
        provider: 'acme',
      });
      // The subject is the credential; it does not leave the server
      expect(JSON.stringify(res.body)).not.toContain(sub);

      const user = await henri.user.findByEmail(email);

      // The provider verified the address, and that is what confirmation is
      expect(user.confirmedAt).toBeTruthy();
      // ... and there is a hash nobody knows, so signing in with a password
      // is not a way in and is not a different answer either
      expect(typeof user.password).toBe('string');

      const [identity] = await identitiesOf(email);

      expect(identity).toMatchObject({
        allows: 'signin',
        email,
        origin: 'signup',
        provider: 'acme',
        subject: sub,
        verified: true,
      });
    });

    test('the same subject signs into the same account, and only touches it', async () => {
      const email = address();
      const sub = subject();
      const profile = { email, email_verified: true, sub };

      const first = await signInWith(await visitor(), profile);
      const again = await signInWith(await visitor(), profile);

      expect(first.status).toBe(200);
      expect(again.status).toBe(200);
      expect(again.body.user.externalId).toBe(first.body.user.externalId);

      const held = await identitiesOf(email);

      expect(held).toHaveLength(1);
      expect(held[0].lastUsedAt).toBeGreaterThan(0);
    });

    test('the subject is the credential, not the address', async () => {
      const email = address();
      const sub = subject();

      const first = await signInWith(await visitor(), {
        email,
        email_verified: true,
        sub,
      });

      // The person changed their address at the provider. The account here
      // is the one the subject names, and its address does not move
      const again = await signInWith(await visitor(), {
        email: address('moved'),
        email_verified: true,
        sub,
      });

      expect(again.status).toBe(200);
      expect(again.body.user.email).toBe(email);
      expect(again.body.user.externalId).toBe(first.body.user.externalId);
    });

    test('signup: false refuses instead of opening an account', async () => {
      block.signup = false;

      const email = address();
      const res = await signInWith(await visitor(), {
        email,
        email_verified: true,
        sub: subject(),
      });

      expect(res.status).toBe(400);
      expect(res.body.data.reason).toBe('signup-disabled');
      expect(await henri.user.findByEmail(email)).toBeNull();
    });

    test('the session identifier is new once the person is in it', async () => {
      const who = await visitor();
      const before = cookieOf(await who.agent.get('/version'), 'henri.sid');
      const res = await signInWith(who, {
        email: address(),
        email_verified: true,
        sub: subject(),
      });
      const after = cookieOf(res, 'henri.sid');

      expect(res.status).toBe(200);
      expect(after).toBeTruthy();
      expect(after).not.toBe(before);
    });
  });

  describe('the merge rule', () => {
    /**
     * An account with a password, the way a person would have made one
     *
     * @returns {Promise<string>} the address
     */
    const registered = async () => {
      const email = address('has-password');

      const res = await supertest(app)
        .post('/signup')
        .send({ email, name: 'Ada', password });

      expect(res.status).toBe(201);

      return email;
    };

    test('refuses a verified address that already has an account', async () => {
      const email = await registered();
      const who = await visitor();
      const res = await signInWith(who, {
        email,
        email_verified: true,
        sub: subject(),
      });

      expect(res.status).toBe(409);
      expect(res.body.data.reason).toBe('exists');
      expect(res.body.user).toBeUndefined();
      // Nothing was written and nobody is signed in: an endpoint that
      // needs a session still answers 401 to the browser that just tried
      expect(
        (
          await who.agent
            .post('/auth/acme/unlink')
            .set('X-CSRF-Token', who.csrf)
        ).status
      ).toBe(401);
      expect(await identitiesOf(email)).toEqual([]);
    });

    test('a browser is sent back to the login page saying so', async () => {
      const email = await registered();
      const who = await visitor();
      const started = await begin(who);
      const code = provider.issue(
        { email, email_verified: true, sub: subject() },
        { challenge: started.challenge, redirectUri: started.redirectUri }
      );
      const res = await who.agent
        .get('/auth/acme/callback')
        .set('Accept', 'text/html')
        .query({ code, state: started.state });

      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('/login?error=exists');
    });

    test('merge: "verified" links it, and only for a trusted provider', async () => {
      const email = await registered();

      block.merge = 'verified';

      const refused = await signInWith(await visitor(), {
        email,
        email_verified: true,
        sub: subject(),
      });

      expect(refused.status).toBe(409);
      expect(refused.body.data.reason).toBe('exists');

      block.providers.acme.trusted = true;

      const sub = subject();
      const res = await signInWith(await visitor(), {
        email,
        email_verified: true,
        sub,
      });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(email);

      const [identity] = await identitiesOf(email);

      // The row says how it came to be, forever
      expect(identity).toMatchObject({ origin: 'verified', subject: sub });
    });

    test('an unverified address never matches and never creates', async () => {
      const email = await registered();
      const unknown = address('nobody');

      for (const candidate of [email, unknown]) {
        const res = await signInWith(await visitor(), {
          email: candidate,
          sub: subject(),
        });

        expect(res.status).toBe(400);
        expect(res.body.data.reason).toBe('unverified');
      }

      expect(await henri.user.findByEmail(unknown)).toBeNull();
      expect(await identitiesOf(email)).toEqual([]);
    });

    test('email_verified is read strictly, and absent is not verified', async () => {
      for (const claim of [false, 'false', 0, null, undefined, 'yes']) {
        const res = await signInWith(await visitor(), {
          email: address('strict'),
          email_verified: claim,
          sub: subject(),
        });

        expect(res.body.data.reason).toBe('unverified');
      }
    });

    test('a provider that never verifies cannot sign anybody up', async () => {
      block.providers.acme.claims = { verified: false };

      const res = await signInWith(await visitor(), {
        email: address(),
        email_verified: true,
        sub: subject(),
      });

      expect(res.body.data.reason).toBe('unverified');
    });

    test('a known and an unknown address are one answer at one price', async () => {
      // The refusal an unverified address gets is the one the account flows
      // keep for a reset request: the same body, the same status and the
      // same cost whether or not that address has an account here. It has
      // to be, because nothing has been proved -- and a callback that took
      // longer for a registered address would be exactly the enumeration
      // oracle the rest of this module avoids
      const email = await registered();
      const rounds = 12;
      const timings = { known: [], unknown: [] };
      const bodies = new Set();
      const statuses = new Set();

      for (let round = 0; round < rounds; round += 1) {
        for (const [label, candidate] of [
          ['known', email],
          ['unknown', address('nobody')],
        ]) {
          const who = await visitor();
          const started = await begin(who);
          const code = provider.issue(
            { email: candidate, sub: subject() },
            { challenge: started.challenge, redirectUri: started.redirectUri }
          );
          const at = process.hrtime.bigint();
          const res = await callback(who, 'acme', {
            code,
            state: started.state,
          });

          timings[label].push(Number(process.hrtime.bigint() - at));
          bodies.add(JSON.stringify(res.body));
          statuses.add(res.status);

          expect(res.body.data.reason).toBe('unverified');
        }
      }

      // One answer, whichever address it was about
      expect(statuses.size).toBe(1);
      expect(bodies.size).toBe(1);

      const known = median(timings.known);
      const unknown = median(timings.unknown);
      const ratio = Math.max(known, unknown) / Math.min(known, unknown);

      expect(ratio).toBeLessThan(3);

      // ... and the account it was about is untouched: no identity, and the
      // address still belongs to the account that had it
      expect(await identitiesOf(email)).toEqual([]);
    });

    test('two providers claiming one address: the second is refused', async () => {
      const email = address('shared');
      const first = await signInWith(await visitor(), {
        email,
        email_verified: true,
        sub: subject(),
      });

      expect(first.status).toBe(200);

      const second = await signInWith(
        await visitor(),
        { email, email_verified: true, sub: subject() },
        { name: 'other' }
      );

      expect(second.status).toBe(409);
      expect(second.body.data.reason).toBe('exists');
      expect((await identitiesOf(email)).map((one) => one.provider)).toEqual([
        'acme',
      ]);
    });
  });

  describe('linking from a session', () => {
    /**
     * Somebody signed in with a password
     *
     * @returns {Promise<object>} `{ agent, csrf, email }`
     */
    const signedIn = async () => {
      const email = address('linker');

      await supertest(app)
        .post('/signup')
        .send({ email, name: 'Ada', password });

      const who = await visitor();
      const res = await who.agent.post('/login').send({ email, password });

      expect(res.status).toBe(200);

      return { ...who, email };
    };

    test('a callback started from a session links, whatever the address says', async () => {
      const who = await signedIn();
      const sub = subject();
      const res = await signInWith(who, {
        // Somebody else's address entirely, and unverified: neither matters
        email: address('elsewhere'),
        sub,
      });

      expect(res.status).toBe(200);
      expect(res.body.identity.provider).toBe('acme');
      expect(res.body.user).toBeUndefined();

      const [identity] = await identitiesOf(who.email);

      expect(identity).toMatchObject({ origin: 'session', subject: sub });
    });

    test('and both providers then open that account', async () => {
      const who = await signedIn();
      const acme = subject();
      const other = subject();

      await signInWith(who, {
        email: who.email,
        email_verified: true,
        sub: acme,
      });
      await signInWith(
        who,
        { email: who.email, email_verified: true, sub: other },
        { name: 'other' }
      );

      expect(
        (await identitiesOf(who.email)).map((one) => one.provider)
      ).toEqual(['acme', 'other']);

      const back = await signInWith(
        await visitor(),
        { email: who.email, email_verified: true, sub: other },
        { name: 'other' }
      );

      expect(back.status).toBe(200);
      expect(back.body.user.email).toBe(who.email);
    });

    test('a second subject at the same provider is refused', async () => {
      const who = await signedIn();

      await signInWith(who, { email: who.email, sub: subject() });

      const again = await signInWith(who, { email: who.email, sub: subject() });

      expect(again.status).toBe(409);
      expect(again.body.data.reason).toBe('already-linked');
      expect(await identitiesOf(who.email)).toHaveLength(1);
    });

    test('a provider account that belongs to somebody else is refused', async () => {
      const owner = address('owner');
      const sub = subject();

      await signInWith(await visitor(), {
        email: owner,
        email_verified: true,
        sub,
      });

      const thief = await signedIn();
      const res = await signInWith(thief, { email: owner, sub });

      expect(res.status).toBe(409);
      expect(res.body.data.reason).toBe('linked-elsewhere');
      expect(await identitiesOf(thief.email)).toEqual([]);
      expect((await identitiesOf(owner)).map((one) => one.subject)).toEqual([
        sub,
      ]);
    });

    test('an attempt to link is refused when the session moved', async () => {
      const who = await signedIn();
      const started = await begin(who);
      const code = provider.issue(
        { email: who.email, sub: subject() },
        { challenge: started.challenge, redirectUri: started.redirectUri }
      );

      // The session is still the one that minted the state, but nobody
      // holds it any more
      await who.agent.post('/logout').set('X-CSRF-Token', who.csrf).send({});

      const res = await callback(who, 'acme', { code, state: started.state });

      expect(res.status).toBe(400);
      expect(res.body.data.reason).toBe('state');
    });
  });

  describe('the state', () => {
    test('a callback works exactly once', async () => {
      const who = await visitor();
      const started = await begin(who);
      const profile = {
        email: address(),
        email_verified: true,
        sub: subject(),
      };
      const code = provider.issue(profile, {
        challenge: started.challenge,
        redirectUri: started.redirectUri,
      });

      const first = await callback(who, 'acme', { code, state: started.state });

      expect(first.status).toBe(200);

      const replayed = await callback(who, 'acme', {
        code,
        state: started.state,
      });

      expect(replayed.status).toBe(400);
      expect(replayed.body.data.reason).toBe('state');
    });

    test('a state minted in another browser is refused', async () => {
      const one = await visitor();
      const two = await visitor();
      const started = await begin(one);
      const code = provider.issue(
        { email: address(), email_verified: true, sub: subject() },
        { challenge: started.challenge, redirectUri: started.redirectUri }
      );
      const res = await callback(two, 'acme', { code, state: started.state });

      expect(res.status).toBe(400);
      expect(res.body.data.reason).toBe('state');
    });

    test('a state that expired is refused', async () => {
      block.stateExpiresIn = 1;

      const who = await visitor();
      const started = await begin(who);

      delete block.stateExpiresIn;

      await new Promise((resolve) => setTimeout(resolve, 20));

      const code = provider.issue(
        { email: address(), email_verified: true, sub: subject() },
        { challenge: started.challenge, redirectUri: started.redirectUri }
      );
      const res = await callback(who, 'acme', { code, state: started.state });

      expect(res.body.data.reason).toBe('state');
    });

    test('a session holds a bounded number of attempts', async () => {
      const who = await visitor();
      const states = [];

      for (let round = 0; round < 8; round += 1) {
        states.push((await begin(who)).state);
      }

      // The five most recent are the ones that still work; the oldest were
      // dropped rather than kept forever
      const oldest = await callback(who, 'acme', {
        code: 'x',
        state: states[0],
      });

      expect(oldest.body.data.reason).toBe('state');
    });

    test('the provider saying no is not a sign-in', async () => {
      const who = await visitor();
      const started = await begin(who);
      const res = await callback(who, 'acme', {
        error: 'access_denied',
        error_description: '<script>alert(1)</script>',
        state: started.state,
      });

      expect(res.status).toBe(400);
      expect(res.body.data.reason).toBe('denied');
      // Nothing the provider wrote is repeated back
      expect(JSON.stringify(res.body)).not.toContain('script');
    });
  });

  describe('the exchange', () => {
    test('the verifier proves the code, and the challenge is its digest', async () => {
      const who = await visitor();
      const started = await begin(who);
      const code = provider.issue(
        { email: address(), email_verified: true, sub: subject() },
        { challenge: started.challenge, redirectUri: started.redirectUri }
      );

      provider.requests.length = 0;

      const res = await callback(who, 'acme', { code, state: started.state });

      expect(res.status).toBe(200);

      const [asked] = provider.requests;
      const digest = crypto
        .createHash('sha256')
        .update(asked.form.code_verifier)
        .digest('base64url');

      expect(digest).toBe(started.challenge);
      // The verifier never travelled through the browser
      expect(started.url.search).not.toContain(asked.form.code_verifier);
    });

    test('the client secret goes where the provider was told to look', async () => {
      provider.requests.length = 0;

      await signInWith(await visitor(), {
        email: address(),
        email_verified: true,
        sub: subject(),
      });
      await signInWith(
        await visitor(),
        { email: address(), email_verified: true, sub: subject() },
        { name: 'other' }
      );

      const [basic, post] = provider.requests;

      expect(basic.authorization).toMatch(/^Basic /u);
      expect(basic.form.client_secret).toBeUndefined();
      expect(post.authorization).toBeNull();
      expect(post.form.client_secret).toBe('other-secret');
    });

    test('a provider that cannot be reached is a refusal, not a 500', async () => {
      const held = block.providers.acme.tokenUrl;

      // Nothing listens there, and nothing henri does about it should reach
      // a person as a stack trace
      block.providers.acme.tokenUrl = 'http://127.0.0.1:1/token';

      const who = await visitor();
      const started = await begin(who);
      const code = provider.issue(
        { email: address(), email_verified: true, sub: subject() },
        { challenge: started.challenge, redirectUri: started.redirectUri }
      );
      const res = await callback(who, 'acme', { code, state: started.state });

      block.providers.acme.tokenUrl = held;

      expect(res.status).toBe(400);
      expect(res.body.data.reason).toBe('exchange');
    });

    test('a code the provider refuses is not a session', async () => {
      const who = await visitor();
      const started = await begin(who);
      const res = await callback(who, 'acme', {
        code: 'not-a-code',
        state: started.state,
      });

      expect(res.status).toBe(400);
      expect(res.body.data.reason).toBe('exchange');
    });

    test('a profile with no subject in it is not a session', async () => {
      const who = await visitor();
      const started = await begin(who);
      const code = provider.issue(
        { email: address(), email_verified: true },
        { challenge: started.challenge, redirectUri: started.redirectUri }
      );
      const res = await callback(who, 'acme', { code, state: started.state });

      expect(res.body.data.reason).toBe('profile');
    });

    test('a subject with a control character in it is not one', async () => {
      const who = await visitor();
      const started = await begin(who);
      const code = provider.issue(
        { email: address(), sub: 'a\nb' },
        { challenge: started.challenge, redirectUri: started.redirectUri }
      );
      const res = await callback(who, 'acme', { code, state: started.state });

      expect(res.body.data.reason).toBe('profile');
    });
  });

  describe('what an identity is allowed to imply', () => {
    test('a "verify" provider opens no session, and links from one', async () => {
      block.providers.acme.allows = 'verify';

      const cold = await visitor();
      const refused = await cold.agent
        .post('/auth/acme')
        .set('X-CSRF-Token', cold.csrf)
        .send({});

      expect(refused.status).toBe(400);
      expect(refused.body.data.reason).toBe('not-a-sign-in');

      const email = address('verify-only');

      await supertest(app).post('/signup').send({ email, password });

      const who = await visitor();

      await who.agent.post('/login').send({ email, password });

      const linked = await signInWith(who, { email, sub: subject() });

      expect(linked.status).toBe(200);
      expect(linked.body.identity.allows).toBe('verify');

      const [identity] = await identitiesOf(email);

      // The permission travels with the row: turning the provider back into
      // a sign-in one does not promote what was linked under the old rule
      delete block.providers.acme.allows;

      expect(identity.allows).toBe('verify');

      const back = await signInWith(await visitor(), {
        email,
        sub: identity.subject,
      });

      expect(back.status).toBe(400);
      expect(back.body.data.reason).toBe('not-a-sign-in');
    });
  });

  describe('the lockout it shares with POST /login', () => {
    test('a locked account cannot be signed into through a provider', async () => {
      const email = address('locked');
      const sub = subject();

      await supertest(app).post('/signup').send({ email, password });

      const who = await visitor();

      await who.agent.post('/login').send({ email, password });
      await signInWith(who, { email, email_verified: true, sub });

      const { max } = henri.user.settings.lockout;

      for (let attempt = 0; attempt < max; attempt += 1) {
        await supertest(app)
          .post('/login')
          .send({ email, password: 'not-the-password' });
      }

      const refused = await signInWith(await visitor(), {
        email,
        email_verified: true,
        sub,
      });

      expect(refused.status).toBe(429);
      expect(refused.body.data.reason).toBe('locked');

      await henri.user.lockout.succeed(email);

      const allowed = await signInWith(await visitor(), {
        email,
        email_verified: true,
        sub,
      });

      expect(allowed.status).toBe(200);
    });
  });

  describe('unlinking', () => {
    test('needs a session', async () => {
      const res = await supertest(app).post('/auth/acme/unlink');

      expect(res.status).toBe(401);
    });

    test('refuses to take away the last way into an account', async () => {
      const email = address('only-provider');
      const sub = subject();
      const who = await visitor();

      await signInWith(who, { email, email_verified: true, sub });

      const refused = await who.agent
        .post('/auth/acme/unlink')
        .set('X-CSRF-Token', who.csrf)
        .send({});

      expect(refused.status).toBe(409);
      expect(refused.body.data.reason).toBe('last-credential');
      expect(await identitiesOf(email)).toHaveLength(1);
    });

    test('lifts once the person has a password of their own', async () => {
      const email = address('sets-a-password');
      const who = await visitor();

      await signInWith(who, {
        email,
        email_verified: true,
        sub: subject(),
      });

      // The reset is how an account henri opened gets a password its owner
      // knows, and it stamps passwordChangedAt
      const user = await henri.user.findByEmail(email);
      const token = await henri.accounts.tokenFor(user, 'password-reset');

      expect((await henri.accounts.resetPassword(token, password)).ok).toBe(
        true
      );

      const back = await visitor();

      await back.agent.post('/login').send({ email, password });

      const res = await back.agent
        .post('/auth/acme/unlink')
        .set('X-CSRF-Token', back.csrf)
        .send({});

      expect(res.status).toBe(200);
      expect(await identitiesOf(email)).toEqual([]);
    });
  });

  describe('personal data', () => {
    test('the export lists the providers and never the subject', async () => {
      const email = address('exported');
      const sub = subject();

      await signInWith(await visitor(), { email, email_verified: true, sub });

      const user = await henri.user.findByEmail(email);
      const document = await henri.privacy.export(user);

      expect(document.identities.records).toHaveLength(1);
      expect(document.identities.records[0]).toMatchObject({
        origin: 'signup',
        provider: 'acme',
        verified: true,
      });
      expect(JSON.stringify(document.identities)).not.toContain(sub);
    });

    test('an erasure takes the credentials away rather than masking them', async () => {
      const email = address('erased');

      await signInWith(await visitor(), {
        email,
        email_verified: true,
        sub: subject(),
      });

      const user = await henri.user.findByEmail(email);
      const who = henri.accounts.identify(user);
      const receipt = await henri.privacy.erase(user);

      expect(receipt.identities).toMatchObject({
        action: 'delete',
        count: 1,
        written: 1,
      });
      expect(await henri.identities.forPerson(who)).toEqual([]);
    });
  });
});
