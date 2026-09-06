// The role guard: what a browser gets, what an API client gets, and what the
// path helpers a page receives hold.
const {
  createEvent,
  createProposal,
  createUser,
  inertiaVersion,
  page,
  request,
  reset,
  signIn,
} = require('./helpers');

const BROWSER = 'text/html,application/xhtml+xml';

const GUARDED = [
  '/admin',
  '/admin/proposals',
  '/admin/proposals/withdrawn',
  '/admin/users',
];

describe('roles', () => {
  let speaker;
  let admin;
  let proposal;

  beforeAll(async () => {
    await reset();
    await inertiaVersion();

    speaker = await createUser({ email: 'speaker@example.test' });
    admin = await createUser({
      email: 'admin@example.test',
      name: 'An Admin',
      roles: ['speaker', 'admin'],
    });

    const { event, track } = await createEvent();

    proposal = await createProposal({
      eventId: event.id,
      speakerId: speaker.id,
      state: 'submitted',
      trackId: track.id,
    });
  });

  describe('a browser', () => {
    test.each(GUARDED)(
      'is redirected to the login page from %s',
      async (path) => {
        const answer = await request().get(path).set('Accept', BROWSER);

        expect(answer.status).toBe(302);
        expect(answer.headers.location).toBe('/login');
      }
    );

    test('is still redirected when signed in without the role', async () => {
      const { browser } = await signIn(speaker);
      const answer = await browser.get('/admin').set('Accept', BROWSER);

      expect(answer.status).toBe(302);
      expect(answer.headers.location).toBe('/login');
    });

    test('reaches the committee once it has the role', async () => {
      const { browser } = await signIn(admin);
      const answer = await page(browser, '/admin');

      expect(answer.status).toBe(200);
      // Implicit rendering: the action returned an object without
      // answering, so henri rendered /<controller> for an index action
      expect(answer.body.component).toBe('admin/dashboard');
      expect(answer.body.props.data.counts.submitted).toBe(1);
    });
  });

  describe('an API client', () => {
    test('gets a 401 when it is not signed in', async () => {
      const answer = await request()
        .get('/admin/proposals')
        .set('Accept', 'application/json');

      expect(answer.status).toBe(401);
      expect(answer.body).toMatchObject({
        error: 'Unauthorized',
        statusCode: 401,
      });
    });

    test('gets a 403 naming the role it is missing', async () => {
      const { browser } = await signIn(speaker);
      const answer = await browser
        .get(`/proposals/${proposal.externalId}/reviews`)
        .set('Accept', 'application/json');

      expect(answer.status).toBe(403);
      expect(answer.body).toMatchObject({
        data: { roles: ['admin'] },
        error: 'Forbidden',
        statusCode: 403,
      });
    });

    test('gets the collection once it has the role', async () => {
      const { browser } = await signIn(admin);
      const answer = await browser
        .get(`/proposals/${proposal.externalId}/reviews`)
        .set('Accept', 'application/hal+json');

      expect(answer.status).toBe(200);
      expect(answer.body._embedded.reviews).toEqual([]);
    });
  });

  describe('the path helpers a page receives', () => {
    test('hold no admin route for an anonymous visitor', async () => {
      const answer = await page(request(), '/');
      const { paths } = answer.body.props;

      expect(paths.index_proposals_path).toBeTruthy();
      expect(paths['index_admin/dashboard_path']).toBeUndefined();
      expect(paths.index_reviews_path).toBeUndefined();
      expect(paths.mine_proposals_path).toBeUndefined();
    });

    test('hold the speaker routes but no admin route for a speaker', async () => {
      const { browser } = await signIn(speaker);
      const { paths } = (await page(browser, '/')).body.props;

      expect(paths.mine_proposals_path).toBeTruthy();
      expect(paths.show_accounts_path).toBeTruthy();
      expect(paths['index_admin/dashboard_path']).toBeUndefined();
    });

    test('hold the admin routes for an admin', async () => {
      const { browser } = await signIn(admin);
      const { paths } = (await page(browser, '/')).body.props;

      expect(paths['index_admin/dashboard_path']).toMatchObject({
        method: 'get',
        roles: ['admin'],
        route: '/admin',
      });
      expect(paths['decide_admin/proposals_path']).toBeTruthy();
      expect(paths.index_reviews_path).toBeTruthy();
    });
  });

  test('roles cannot be granted through a profile update', async () => {
    const { browser, csrf } = await signIn(speaker);

    await browser
      .patch('/account')
      .set('Accept', 'text/html')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Renamed', roles: ['admin'] });

    const reloaded = await User.findByKey(speaker.id);

    expect(reloaded.name).toBe('Renamed');
    expect(reloaded.roles).toEqual(['speaker']);
  });

  test('an admin promotes somebody through the member route', async () => {
    const { browser, csrf } = await signIn(admin);
    const answer = await browser
      .post(`/admin/users/${speaker.externalId}/role`)
      .set('Accept', 'text/html')
      .set('X-CSRF-Token', csrf)
      .send({ role: 'admin' });

    expect(answer.status).toBe(302);

    const reloaded = await User.findByKey(speaker.id);

    expect(reloaded.roles).toEqual(['speaker', 'admin']);

    // Put it back, the other tests of this file expect a plain speaker
    await User.setRoles(speaker.id, ['speaker']);
  });
});
