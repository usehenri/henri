const supertest = require('supertest');

const Henri = require('../henri');
const tokens = require('../base/tokens');

/** Pulls a signed token out of whatever a mail was rendered into */
const TOKEN = /h1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

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

describe('account flows (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  /** Every message the flows handed to the delivery handler */
  let mails = [];
  let henri;
  let app;
  let unique = 0;

  /**
   * An address nobody used yet
   *
   * @param {string} [prefix] what to call this one
   * @returns {string} the address
   */
  const address = (prefix = 'ada') => {
    unique += 1;

    return `${prefix}-${unique}@usehenri.io`;
  };

  /**
   * Signs an account up through the endpoint
   *
   * @param {object} [attributes] what the form sends
   * @returns {Promise<object>} the supertest response
   */
  const signup = (attributes = {}) =>
    supertest(app)
      .post('/signup')
      .send(
        Object.assign({ email: address(), name: 'Ada', password }, attributes)
      );

  /**
   * The account behind an address, with its password hash
   *
   * @param {string} email the address
   * @returns {Promise<object>} the user
   */
  const account = (email) => henri.user.findByEmail(email);

  /**
   * Everything the flows deferred, once it has settled
   *
   * @returns {Promise<Array<object>>} the messages that were delivered
   */
  const delivered = async () => {
    await henri.accounts.drain();

    return mails;
  };

  /**
   * The token inside the last message that was delivered
   *
   * @returns {Promise<string>} the token
   */
  const lastToken = async () => {
    const sent = await delivered();
    const last = sent[sent.length - 1];

    return TOKEN.exec(`${last.text}\n${last.html}`)[0];
  };

  /**
   * Signs in and answers an agent holding the session
   *
   * @param {string} email the address
   * @param {string} secret the password
   * @returns {Promise<object>} a supertest agent
   */
  const signIn = async (email, secret = password) => {
    const agent = supertest.agent(app);
    // The csrf cookie is handed out on the first request; the agent keeps it
    // and the posts below send it back in the header
    const csrf = cookieOf(await agent.get('/version'), 'henri.csrf');
    const res = await agent.post('/login').send({ email, password: secret });

    expect(res.status).toBe(200);

    return { agent, csrf };
  };

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    app = henri.server.app;

    // The queue would take the deliveries (see the last block); for the rest
    // of the suite the messages are read here instead
    henri.mailers.onDeliverLater((message) => {
      mails.push(message);

      return { captured: true };
    });
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

  beforeEach(() => {
    mails = [];
  });

  describe('configuration', () => {
    test('reads the blocks of config.user', () => {
      const {
        confirmation,
        passwordReset,
        signup: registration,
      } = henri.accounts.settings;

      expect(registration).toMatchObject({
        enabled: true,
        fields: ['name'],
        path: '/signup',
      });
      expect(passwordReset).toMatchObject({ enabled: true, path: '/password' });
      expect(confirmation).toMatchObject({
        enabled: true,
        path: '/confirm',
        required: false,
      });
    });
  });

  describe('registration', () => {
    test('creates an account and opens a session', async () => {
      const email = address();
      const res = await supertest(app)
        .post('/signup')
        .send({ email, name: 'Ada', password });

      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({
        email,
        name: 'Ada',
        roles: ['member'],
      });
      expect(res.body.user.password).toBeUndefined();
      expect(cookieOf(res, 'henri.sid')).toBeTruthy();

      const user = await account(email);

      expect(user.name).toBe('Ada');
      expect(user.password).not.toBe(password);
    });

    test('a form cannot grant itself a role, or write a field nobody permitted', async () => {
      const email = address();

      await supertest(app)
        .post('/signup')
        .send({ age: 32, email, name: 'Ada', password, roles: ['admin'] })
        .expect(201);

      const user = await account(email);

      expect(user.roles).toEqual(['member']);
      expect(user.age).toBeUndefined();
    });

    test('refuses an address that is already registered', async () => {
      const email = address();

      await signup({ email }).expect(201);

      const res = await signup({ email });

      expect(res.status).toBe(422);
      expect(res.body.data.errors).toEqual({ email: 'is already registered' });
    });

    test('refuses a missing address, a broken one and a short password', async () => {
      await expect(
        signup({ email: '' }).then((res) => res.body.data.errors)
      ).resolves.toEqual({ email: 'is required' });
      await expect(
        signup({ email: 'ada' }).then((res) => res.body.data.errors)
      ).resolves.toEqual({ email: 'is not a valid email' });
      await expect(
        signup({ password: 'short' }).then((res) => res.body.data.errors)
      ).resolves.toMatchObject({ password: expect.any(String) });
    });

    test('mails the confirmation link', async () => {
      const email = address();

      await signup({ email }).expect(201);

      const sent = await delivered();

      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(email);
      expect(sent[0].subject).toBe('Confirm your email address');
      expect(sent[0].html).toContain('https://demo.usehenri.io/confirm/h1.');
      expect(sent[0].text).toContain('https://demo.usehenri.io/confirm/h1.');
    });

    test('a browser is redirected, and the errors travel in the flash', async () => {
      const agent = supertest.agent(app);
      const res = await agent
        .post('/signup')
        .set('Accept', 'text/html')
        .send({ email: 'nope', password });

      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('/signup');
    });
  });

  describe('password reset', () => {
    test('answers a known and an unknown address identically', async () => {
      const email = address();

      await signup({ email }).expect(201);
      mails = [];

      const known = await supertest(app)
        .post('/password/forgot')
        .send({ email });
      const unknown = await supertest(app)
        .post('/password/forgot')
        .send({ email: 'nobody-at-all@usehenri.io' });

      expect(known.status).toBe(202);
      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toEqual(known.body);
      expect(unknown.text).toBe(known.text);
      expect(known.headers['content-length']).toBe(
        unknown.headers['content-length']
      );
    });

    test('nothing about the account happens before the answer is written', async () => {
      const email = address();

      await signup({ email }).expect(201);
      mails = [];

      await supertest(app).post('/password/forgot').send({ email });

      // The answer is already back and the lookup has not run yet: there is
      // no account work on the path a client can time
      expect(mails).toHaveLength(0);
      expect(await delivered()).toHaveLength(1);
    });

    test('takes the same time whether or not the address exists', async () => {
      const email = address();

      await signup({ email }).expect(201);
      await henri.accounts.drain();

      const time = async (target) => {
        const started = process.hrtime.bigint();

        await supertest(app).post('/password/forgot').send({ email: target });

        return Number(process.hrtime.bigint() - started) / 1e6;
      };

      // Warm up, then measure both branches interleaved so a slow moment
      // lands on both
      await time(email);
      await time('nobody@usehenri.io');

      const hits = [];
      const misses = [];

      for (let round = 0; round < 12; round += 1) {
        hits.push(await time(email));
        misses.push(await time('nobody@usehenri.io'));
      }

      await henri.accounts.drain();

      expect(Math.abs(median(hits) - median(misses))).toBeLessThan(25);
    }, 30000);

    test('refuses an address that is not one', async () => {
      const res = await supertest(app)
        .post('/password/forgot')
        .send({ email: 'not-an-address' });

      expect(res.status).toBe(422);
      expect(res.body.data.errors).toEqual({ email: 'is not a valid email' });
    });

    test('the link changes the password and signs the other sessions out', async () => {
      const email = address();

      await signup({ email }).expect(201);

      const { agent: elsewhere } = await signIn(email);

      await elsewhere.get('/profile').expect(200);

      await supertest(app).post('/password/forgot').send({ email });

      const token = await lastToken();
      const agent = supertest.agent(app);
      const opened = await agent.get(`/password/reset/${token}`);

      expect(opened.status).toBe(200);
      expect(opened.headers['referrer-policy']).toBe('no-referrer');
      expect(opened.headers['cache-control']).toBe('no-store');

      const csrf = cookieOf(opened, 'henri.csrf');
      const changed = await agent
        .post('/password/reset')
        .set('X-CSRF-Token', csrf)
        .send({ password: 'a-brand-new-password' });

      expect(changed.status).toBe(200);
      expect(changed.body.user.email).toBe(email);

      // The session that asked for the reset is signed in
      await agent.get('/profile').expect(200);
      // The one that was already open is not, which is the whole point
      await elsewhere.get('/profile').expect(401);

      // And the new password is the one that works
      await supertest(app).post('/login').send({ email, password }).expect(401);
      await supertest(app)
        .post('/login')
        .send({ email, password: 'a-brand-new-password' })
        .expect(200);
    }, 30000);

    test('the same link cannot be used twice', async () => {
      const email = address();

      await signup({ email }).expect(201);
      await supertest(app).post('/password/forgot').send({ email });

      const token = await lastToken();

      await supertest(app)
        .post('/password/reset')
        .send({ password: 'first-new-password', token })
        .expect(200);

      const again = await supertest(app)
        .post('/password/reset')
        .send({ password: 'second-new-password', token });

      expect(again.status).toBe(400);
      expect(again.body.data.reason).toBe('signature');

      await supertest(app)
        .post('/login')
        .send({ email, password: 'first-new-password' })
        .expect(200);
    }, 30000);

    test('an expired link is refused', async () => {
      const email = address();

      await signup({ email }).expect(201);

      const user = await account(email);
      const token = await henri.accounts.tokenFor(
        user,
        henri.accounts.PURPOSE.reset,
        { expiresIn: -1000 }
      );
      const res = await supertest(app)
        .post('/password/reset')
        .send({ password: 'another-password', token });

      expect(res.status).toBe(400);
      expect(res.body.data.reason).toBe('expired');
    });

    test('a token minted for one account does not work on another', async () => {
      const mine = address('mine');
      const yours = address('yours');

      await signup({ email: mine }).expect(201);
      await signup({ email: yours }).expect(201);

      const me = await account(mine);
      const you = await account(yours);
      // My seed, your name on the envelope
      const forged = tokens.mint({
        expiresIn: 60000,
        purpose: henri.accounts.PURPOSE.reset,
        secret: henri.config.get('secret'),
        seed: `|${me.password}`,
        subject: henri.accounts.identify(you),
      });
      const res = await supertest(app)
        .post('/password/reset')
        .send({ password: 'not-your-password', token: forged });

      expect(res.status).toBe(400);
      expect(res.body.data.reason).toBe('signature');

      await supertest(app)
        .post('/login')
        .send({ email: yours, password })
        .expect(200);
    }, 30000);

    test('the new password goes through the policy', async () => {
      const email = address();

      await signup({ email }).expect(201);
      await supertest(app).post('/password/forgot').send({ email });

      const token = await lastToken();
      const res = await supertest(app)
        .post('/password/reset')
        .send({ password: 'tiny', token });

      expect(res.status).toBe(422);
      expect(res.body.data.errors.password).toEqual(expect.any(String));

      // And the link still works with an acceptable one
      await supertest(app)
        .post('/password/reset')
        .send({ password: 'a-perfectly-fine-password', token })
        .expect(200);
    }, 30000);

    test('a link that is not one sends a browser back to the form', async () => {
      const res = await supertest(app)
        .get('/password/reset/h1.not.a-token')
        .set('Accept', 'text/html');

      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('/password/forgot');
    });
  });

  describe('email confirmation', () => {
    test('the link confirms the address, once', async () => {
      const email = address();

      await signup({ email }).expect(201);

      const token = await lastToken();

      expect((await account(email)).confirmedAt).toBeFalsy();

      const done = await supertest(app).get(`/confirm/${token}`);

      expect(done.status).toBe(200);
      expect(done.body.user.email).toBe(email);
      expect((await account(email)).confirmedAt).toBeTruthy();

      const again = await supertest(app).get(`/confirm/${token}`);

      expect(again.status).toBe(400);
      expect(again.body.data.reason).toBe('signature');
    });

    test('resending answers the same for a known, an unknown and a confirmed address', async () => {
      const email = address();

      await signup({ email }).expect(201);
      mails = [];

      const known = await supertest(app).post('/confirm').send({ email });
      const unknown = await supertest(app)
        .post('/confirm')
        .send({ email: 'nobody-here@usehenri.io' });

      expect(known.status).toBe(202);
      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toEqual(known.body);

      expect(await delivered()).toHaveLength(1);

      const token = TOKEN.exec(mails[0].text)[0];

      await supertest(app).get(`/confirm/${token}`).expect(200);
      mails = [];

      const confirmed = await supertest(app).post('/confirm').send({ email });

      expect(confirmed.status).toBe(known.status);
      expect(confirmed.body).toEqual(known.body);
      expect(await delivered()).toHaveLength(0);
    }, 30000);

    test('an address change takes effect only once the new address is confirmed', async () => {
      const email = address();
      const wanted = address('moved');

      await signup({ email }).expect(201);

      const { agent, csrf } = await signIn(email);

      mails = [];

      const asked = await agent
        .post('/account/email')
        .set('X-CSRF-Token', csrf)
        .send({ email: wanted, password });

      expect(asked.status).toBe(202);
      // Nothing moved yet
      expect(await account(email)).toBeTruthy();
      expect(await account(wanted)).toBeNull();

      const sent = await delivered();

      expect(sent[0].to).toBe(wanted);

      const token = TOKEN.exec(sent[0].text)[0];

      await supertest(app).get(`/confirm/${token}`).expect(200);

      expect(await account(email)).toBeNull();
      expect((await account(wanted)).confirmedAt).toBeTruthy();
    }, 30000);

    test('an address change needs the current password', async () => {
      const email = address();

      await signup({ email }).expect(201);

      const { agent, csrf } = await signIn(email);
      const res = await agent
        .post('/account/email')
        .set('X-CSRF-Token', csrf)
        .send({ email: address('nope'), password: 'not-my-password' });

      expect(res.status).toBe(422);
      expect(res.body.data.errors.password).toBeTruthy();
    }, 30000);

    test('an anonymous visitor cannot ask for an address change', async () => {
      const res = await supertest(app)
        .post('/account/email')
        .send({ email: address(), password });

      expect(res.status).toBe(401);
    });

    test('keeps unconfirmed accounts out when the application asks it to', async () => {
      const email = address();

      await signup({ email }).expect(201);

      const settings = henri.config.get('user');

      settings.confirmation = { required: true };

      try {
        const refused = await supertest(app)
          .post('/login')
          .send({ email, password });

        expect(refused.status).toBe(403);
        expect(refused.body.data.reason).toBe('unconfirmed');

        const token = await lastToken();

        await supertest(app).get(`/confirm/${token}`).expect(200);
        await supertest(app)
          .post('/login')
          .send({ email, password })
          .expect(200);
      } finally {
        settings.confirmation = true;
      }
    }, 30000);
  });

  describe('delivery', () => {
    test('goes through the job queue when the application has one', async () => {
      const email = address();

      await signup({ email }).expect(201);
      await henri.accounts.drain();

      // Hand the deliveries back to the queue, the way the module of
      // @usehenri/jobs wired them (JobsModule#deliverMail)
      henri.jobs.deliverMail();

      try {
        await supertest(app).post('/password/forgot').send({ email });
        await henri.accounts.drain();

        const queued = await henri.jobs.list({ name: 'henri/mail' });

        expect(queued.length).toBeGreaterThan(0);
        expect(queued[queued.length - 1].args.to).toBe(email);
      } finally {
        henri.mailers.onDeliverLater((message) => {
          mails.push(message);

          return { captured: true };
        });
      }
    }, 30000);
  });
});
