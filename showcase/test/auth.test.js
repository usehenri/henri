// Sign up, sign in, sign out, the CSRF protection, and req.user reaching a
// page through the view engine.
const {
  agent,
  createUser,
  inertiaVersion,
  page,
  request,
  reset,
  signIn,
  token,
} = require('./helpers');

describe('authentication', () => {
  beforeAll(async () => {
    await reset();
    await inertiaVersion();
  });

  test('a visitor can sign up and lands signed in', async () => {
    const browser = agent();
    const start = await browser.get('/signup').set('Accept', 'text/html');
    const csrf = token(start);

    expect(csrf).toEqual(expect.any(String));

    const answer = await browser
      .post('/signup')
      .set('X-Inertia', 'true')
      .set('X-CSRF-Token', csrf)
      .send({
        company: 'Test Co',
        email: 'newcomer@example.test',
        name: 'A Newcomer',
        password: 'lineup-showcase',
      });

    expect(answer.status).toBe(302);
    expect(answer.headers.location).toBe('/proposals/mine');

    const created = await User.findOne({ email: 'newcomer@example.test' });

    expect(created).toBeTruthy();
    // From config.baseRole, and never what the form asked for
    expect(created.roles).toEqual(['speaker']);

    const mine = await page(browser, '/proposals/mine');

    expect(mine.status).toBe(200);
    expect(mine.body.props.user.email).toBe('newcomer@example.test');
  });

  test('signing up refuses an email that is taken, with a message per field', async () => {
    const browser = agent();
    const start = await browser.get('/signup').set('Accept', 'text/html');
    const answer = await browser
      .post('/signup')
      .set('X-Inertia', 'true')
      .set('X-CSRF-Token', token(start))
      .send({
        email: 'newcomer@example.test',
        name: 'Somebody Else',
        password: 'lineup-showcase',
      });

    expect(answer.status).toBe(200);
    expect(answer.body.component).toBe('signup');
    expect(answer.body.props.errors.email).toMatch(/already registered/);
  });

  test('a signup cannot grant itself a role', async () => {
    const browser = agent();
    const start = await browser.get('/signup').set('Accept', 'text/html');

    await browser
      .post('/signup')
      .set('X-Inertia', 'true')
      .set('X-CSRF-Token', token(start))
      .send({
        email: 'sneaky@example.test',
        name: 'Sneaky',
        password: 'lineup-showcase',
        roles: ['admin'],
      });

    const created = await User.findOne({ email: 'sneaky@example.test' });

    expect(created.roles).toEqual(['speaker']);
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
      .send({ email: user.email, password: 'lineup-showcase' });

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
