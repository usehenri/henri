// Sign up, sign in, sign out, the password reset, the address confirmation,
// the CSRF protection, and req.user reaching a page through the view engine.
//
// Registration, the reset and the confirmation are henri's endpoints, turned
// on in config/test.json. This file checks that they are wired into the
// application, and the properties an application would lose by hand-rolling
// them: no role through a form, one use per link, and the same answer for an
// address that exists and one that does not.
const {
  PASSWORD,
  agent,
  createUser,
  inertiaVersion,
  page,
  request,
  reset,
  signIn,
  token,
} = require('./helpers');

/** Every message the flows handed to the delivery handler */
const mails = [];

/** Pulls the signed token out of one of them */
const TOKEN = /h1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

/**
 * The token of the last message that was sent
 *
 * @returns {Promise<string>} The token
 */
const lastToken = async () => {
  await henri.accounts.drain();

  const last = mails[mails.length - 1];

  return TOKEN.exec(`${last.text}\n${last.html}`)[0];
};

describe('authentication', () => {
  beforeAll(async () => {
    await reset();
    await inertiaVersion();
    // The mails are read here instead of being handed to a transport
    henri.mailers.onDeliverLater((message) => mails.push(message));
  });

  beforeEach(() => {
    mails.length = 0;
  });

  test('a visitor can sign up and lands signed in', async () => {
    const browser = agent();
    const start = await browser.get('/signup').set('Accept', 'text/html');
    const csrf = token(start);

    expect(csrf).toEqual(expect.any(String));

    const answer = await browser
      .post('/signup')
      .set('Accept', 'text/html')
      .set('X-CSRF-Token', csrf)
      .send({
        company: 'Test Co',
        email: 'newcomer@example.test',
        name: 'A Newcomer',
        password: PASSWORD,
      });

    expect(answer.status).toBe(303);
    expect(answer.headers.location).toBe('/proposals/mine');

    const created = await User.findOne({ email: 'newcomer@example.test' });

    expect(created).toBeTruthy();
    expect(created.company).toBe('Test Co');
    // From config.baseRole, and never what the form asked for
    expect(created.roles).toEqual(['speaker']);
    // Nothing has proved it can read that address yet
    expect(created.confirmedAt).toBeFalsy();

    const mine = await page(browser, '/proposals/mine');

    expect(mine.status).toBe(200);
    expect(mine.body.props.user.email).toBe('newcomer@example.test');
  });

  test('signing up mails the confirmation link', async () => {
    await request()
      .post('/signup')
      .send({
        email: 'mailed@example.test',
        name: 'Mailed',
        password: PASSWORD,
      })
      .expect(201);

    await henri.accounts.drain();

    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('mailed@example.test');
    expect(mails[0].subject).toMatch(/confirm/i);
  });

  test('signing up refuses an email that is taken, with a message per field', async () => {
    const browser = agent();
    const start = await browser.get('/signup').set('Accept', 'text/html');
    const answer = await browser
      .post('/signup')
      .set('Accept', 'text/html')
      .set('X-CSRF-Token', token(start))
      .send({
        email: 'newcomer@example.test',
        name: 'Somebody Else',
        password: PASSWORD,
      });

    // Post/redirect/get: the messages travel in the flash and reach the page
    // as `errors`, where a rendered error would have been
    expect(answer.status).toBe(303);
    expect(answer.headers.location).toBe('/signup');

    const back = await page(browser, '/signup');

    expect(back.body.component).toBe('signup');
    expect(back.body.props.errors.email).toMatch(/already registered/);

    const values = back.body.props.flash.values[0];

    expect(values.email).toBe('newcomer@example.test');
    // What was typed comes back, minus the password
    expect(values.password).toBeUndefined();
  });

  test('signing up refuses a password below the policy, next to the field', async () => {
    const browser = agent();
    const start = await browser.get('/signup').set('Accept', 'text/html');
    const answer = await browser
      .post('/signup')
      .set('Accept', 'text/html')
      .set('X-CSRF-Token', token(start))
      .send({
        email: 'short@example.test',
        name: 'Too Short',
        password: 'short',
      });

    expect(answer.status).toBe(303);

    const back = await page(browser, '/signup');

    expect(back.body.props.errors.password).toMatch(/at least/);
    await expect(User.findOne({ email: 'short@example.test' })).resolves.toBe(
      null
    );

    // A JSON client gets the same refusal as a status: 422, never a 500
    const json = await request()
      .post('/signup')
      .send({ email: 'short@example.test', name: 'Too Short', password: 'x' });

    expect(json.status).toBe(422);
    expect(json.body.data.errors.password).toMatch(/at least/);
  });

  test('a signup cannot grant itself a role', async () => {
    await request()
      .post('/signup')
      .send({
        email: 'sneaky@example.test',
        name: 'Sneaky',
        password: PASSWORD,
        roles: ['admin'],
      })
      .expect(201);

    const created = await User.findOne({ email: 'sneaky@example.test' });

    expect(created.roles).toEqual(['speaker']);
  });

  describe('password reset', () => {
    test('answers the same for an address that exists and one that does not', async () => {
      const user = await createUser({ email: 'forgetful@example.test' });
      const known = await request()
        .post('/password/forgot')
        .send({ email: user.email });
      const unknown = await request()
        .post('/password/forgot')
        .send({ email: 'nobody-at-all@example.test' });

      expect(known.status).toBe(202);
      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toEqual(known.body);
      expect(unknown.text).toBe(known.text);

      await henri.accounts.drain();

      // Only one of the two put a message on the wire, and that happened
      // after both answers had been written
      expect(mails).toHaveLength(1);
      expect(mails[0].to).toBe(user.email);
    });

    test('the link changes the password once and signs the other sessions out', async () => {
      const user = await createUser({ email: 'reset@example.test' });
      const { browser: elsewhere } = await signIn(user);

      expect((await page(elsewhere, '/account')).status).toBe(200);

      await request().post('/password/forgot').send({ email: user.email });

      const link = await lastToken();
      const browser = agent();
      const opened = await browser
        .get(`/password/reset/${link}`)
        .set('Accept', 'text/html');

      // The token leaves the url here: it is in the session, and the form
      // below posts without it
      expect(opened.status).toBe(303);
      expect(opened.headers.location).toBe('/password/reset');
      expect(opened.headers['referrer-policy']).toBe('no-referrer');

      const form = await browser
        .get('/password/reset')
        .set('Accept', 'text/html');
      const changed = await browser
        .post('/password/reset')
        .set('Accept', 'text/html')
        .set('X-CSRF-Token', token(opened) || token(form))
        .send({ password: 'a-brand-new-password' });

      expect(changed.status).toBe(303);
      expect(changed.headers.location).toBe('/proposals/mine');

      // The session that was already open no longer deserializes: /account
      // asks for the speaker role and there is nobody behind that cookie any
      // more
      expect((await page(elsewhere, '/account')).status).toBe(401);

      // The link is spent
      const again = await request()
        .post('/password/reset')
        .send({ password: 'yet-another-password', token: link });

      expect(again.status).toBe(400);

      // And only the new password signs in
      await request()
        .post('/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(401);
      await request()
        .post('/login')
        .send({ email: user.email, password: 'a-brand-new-password' })
        .expect(200);
    });
  });

  describe('email confirmation', () => {
    test('the link confirms the address, once', async () => {
      await request()
        .post('/signup')
        .send({
          email: 'confirming@example.test',
          name: 'Confirming',
          password: PASSWORD,
        })
        .expect(201);

      const link = await lastToken();
      const before = await User.findOne({ email: 'confirming@example.test' });

      expect(before.confirmedAt).toBeFalsy();

      await request().get(`/confirm/${link}`).expect(200);

      const after = await User.findOne({ email: 'confirming@example.test' });

      expect(after.confirmedAt).toBeTruthy();

      const again = await request().get(`/confirm/${link}`);

      expect(again.status).toBe(400);
    });

    test('an address change waits for the new address to be confirmed', async () => {
      const user = await createUser({ email: 'moving@example.test' });
      const { browser, csrf } = await signIn(user);

      mails.length = 0;

      const asked = await browser
        .post('/account/email')
        .set('X-CSRF-Token', csrf)
        .send({ email: 'moved@example.test', password: PASSWORD });

      expect(asked.status).toBe(202);
      // Nothing moved yet
      expect(await User.findOne({ email: user.email })).toBeTruthy();
      expect(await User.findOne({ email: 'moved@example.test' })).toBeFalsy();

      await henri.accounts.drain();

      expect(mails[0].to).toBe('moved@example.test');

      await request()
        .get(`/confirm/${TOKEN.exec(mails[0].text)[0]}`)
        .expect(200);

      expect(await User.findOne({ email: user.email })).toBeFalsy();
      expect(await User.findOne({ email: 'moved@example.test' })).toBeTruthy();
    });
  });

  test('signing in redirects a browser and reaches the pages as req.user', async () => {
    const user = await createUser({
      email: 'signin@example.test',
      name: 'Signed In',
    });
    const { browser } = await signIn(user);
    const home = await page(browser, '/');

    expect(home.status).toBe(200);
    expect(home.body.props.user).toEqual({
      company: null,
      email: 'signin@example.test',
      // The public user carries the public identifier of the record; the
      // primary key stays on the server
      externalId: user.externalId,
      name: 'Signed In',
      roles: ['speaker'],
    });
    expect(home.body.props.user.id).toBeUndefined();
  });

  test('the public user never carries the password hash', async () => {
    const user = await createUser({ email: 'private@example.test' });
    const { browser } = await signIn(user);
    const home = await page(browser, '/');

    expect(home.body.props.user.password).toBeUndefined();
    expect(JSON.stringify(home.body)).not.toContain('$2');
  });

  test('signing in with a wrong password sends the browser back', async () => {
    const user = await createUser({ email: 'wrong@example.test' });
    const browser = agent();
    const start = await browser.get('/login').set('Accept', 'text/html');
    const answer = await browser
      .post('/login')
      .set('Accept', 'text/html')
      .type('form')
      .send({ _csrf: token(start), email: user.email, password: 'not-it' });

    expect(answer.status).toBe(302);
    expect(answer.headers.location).toBe('/login?error=invalid');
  });

  test('an API client gets 401 and the public user, not a redirect', async () => {
    const user = await createUser({ email: 'api@example.test' });
    const bad = await request()
      .post('/login')
      .set('Accept', 'application/json')
      .send({ email: user.email, password: 'not-it' });

    expect(bad.status).toBe(401);

    const good = await request()
      .post('/login')
      .set('Accept', 'application/json')
      .send({ email: user.email, password: PASSWORD });

    expect(good.status).toBe(200);
    expect(good.body.user.email).toBe('api@example.test');
    expect(good.body.user.password).toBeUndefined();
  });

  test('signing out empties the session', async () => {
    const user = await createUser({ email: 'bye@example.test' });
    const { browser, csrf } = await signIn(user);

    expect((await page(browser, '/')).body.props.user).toBeTruthy();

    const out = await browser
      .post('/logout')
      .set('Accept', 'text/html')
      .set('X-CSRF-Token', csrf);

    expect(out.status).toBe(302);
    expect((await page(browser, '/')).body.props.user).toBeNull();
  });

  test('GET /logout is refused', async () => {
    const answer = await request().get('/logout');

    expect(answer.status).toBe(405);
  });

  describe('CSRF', () => {
    test('a request with a session but no token is refused', async () => {
      const user = await createUser({ email: 'csrf@example.test' });
      const { browser } = await signIn(user);
      const answer = await browser
        .post('/proposals')
        .set('Accept', 'application/json')
        .send({ title: 'Anything at all' });

      expect(answer.status).toBe(403);
      expect(answer.body.message).toMatch(/CSRF/);
    });

    test('the same request with the token gets through to the action', async () => {
      const user = await createUser({ email: 'csrf-ok@example.test' });
      const { browser, csrf } = await signIn(user);
      const answer = await browser
        .post('/proposals')
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', csrf)
        .send({ title: 'Anything at all' });

      // 422, not 403: the request reached the controller and the model
      expect(answer.status).toBe(422);
      expect(answer.body.data.errors).toBeTruthy();
    });

    test('a token from another session is refused', async () => {
      const user = await createUser({ email: 'csrf-other@example.test' });
      const { browser } = await signIn(user);
      const other = await agent().get('/login').set('Accept', 'text/html');
      const answer = await browser
        .post('/proposals')
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', token(other))
        .send({ title: 'Anything at all' });

      expect(answer.status).toBe(403);
    });
  });
});
