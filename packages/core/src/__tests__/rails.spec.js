const supertest = require('supertest');
const Henri = require('../henri');

const password = 'difference-engine';
const adminEmail = 'ada@usehenri.io';

/**
 * Registers and logs a user in, answering an agent
 *
 * @param {object} app the express app
 * @param {string} email the email
 * @param {Array<string>} [roles=null] roles to grant before the login
 * @returns {Promise<object>} the agent
 */
const signUp = async (app, email, roles = null) => {
  const agent = supertest.agent(app);
  const registered = await agent
    .post('/register')
    .send({ email, name: email.split('@')[0], password });

  if (registered.status !== 201) {
    throw new Error(`unable to register ${email}: ${registered.status}`);
  }

  if (roles) {
    const user = await henri.user.findByEmail(email);

    await user.setRoles(roles);
  }

  const logged = await agent.post('/login').send({ email, password });

  if (logged.status !== 200) {
    throw new Error(`unable to log ${email} in: ${logged.status}`);
  }

  return agent;
};

describe('rails ergonomics (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let app;
  let request;
  let admin;
  let noteId;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    app = henri.server.app;
    request = supertest(app);
    admin = await signUp(app, adminEmail, ['admin']);
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

  describe('the routes dsl', () => {
    test('expands root, the resource, its extras, the nested and the namespace', () => {
      const keys = Object.keys(henri.router.routes);

      expect(keys).toContain('get /');
      expect(keys).toEqual(
        expect.arrayContaining([
          'get /notes',
          'post /notes',
          'get /notes/search',
          'post /notes/:id/archive',
          'get /notes/:id',
          'get /notes/:note_id/comments',
          'get /admin/notes',
        ])
      );
      // Only index, create and show were asked for
      expect(keys).not.toContain('get /notes/new');
      expect(keys).not.toContain('get /notes/:id/edit');
      expect(keys).not.toContain('delete /notes/:id');
    });

    test('the path helpers stay <action>_<controller>_path', async () => {
      const res = await request.get('/notes').set('Accept', 'application/json');

      expect(Object.keys(res.body.paths)).toEqual(
        expect.arrayContaining([
          'home_main_path',
          'index_notes_path',
          'create_notes_path',
          'search_notes_path',
          'archive_notes_path',
          'show_notes_path',
          'index_comments_path',
        ])
      );
      expect(res.body.paths.search_notes_path).toEqual({
        method: 'get',
        roles: undefined,
        route: '/notes/search',
      });
      expect(res.body.paths.new_notes_path).toBeUndefined();
      // Namespaced routes are only listed for the roles that may call them
      expect(res.body.paths['index_admin/notes_path']).toBeUndefined();
    });

    test('root serves / through the controller', async () => {
      const res = await request.get('/');

      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<title>Hello!<\/title>/);
    });

    test('a namespaced route keeps its roles and its controller folder', async () => {
      const denied = await request
        .get('/admin/notes')
        .set('Accept', 'application/json');

      expect(denied.status).toBe(401);

      const allowed = await admin
        .get('/admin/notes')
        .set('Accept', 'application/json');

      expect(allowed.status).toBe(200);
      expect(allowed.body.admin).toBe(true);
      expect(henri.router.routes['get /admin/notes'].controller).toBe(
        'admin/notes#index'
      );
    });
  });

  describe('before hooks', () => {
    test('the `all` hook runs on every action of the controller', async () => {
      const index = await request
        .get('/notes')
        .set('Accept', 'application/json');
      const search = await request
        .get('/notes/search')
        .set('Accept', 'application/json');

      expect(index.headers['x-notes']).toBe('loaded');
      expect(search.headers['x-notes']).toBe('loaded');
    });

    test('a hook that answers ends the request', async () => {
      const res = await request
        .get('/notes/9999')
        .set('Accept', 'application/json');

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Note 9999 not found');
    });

    test('a hook that loads the record hands it to the action', async () => {
      const created = await request
        .post('/notes')
        .set('Accept', 'application/json')
        .send({ title: 'Read the docs' });

      expect(created.status).toBe(201);
      noteId = created.body.id;

      const shown = await request
        .get(`/notes/${noteId}`)
        .set('Accept', 'application/json');

      expect(shown.status).toBe(200);
      expect(shown.body.data.note).toMatchObject({ title: 'Read the docs' });
    });
  });

  describe('implicit render', () => {
    test('an action that returns renders its page with the data', async () => {
      const json = await request
        .get('/notes')
        .set('Accept', 'application/json');

      expect(json.status).toBe(200);
      expect(json.body.data.notes.length).toBeGreaterThan(0);
      expect(json.body._links.self.href).toBe('/notes');

      const html = await request.get('/notes').set('Accept', 'text/html');

      expect(html.status).toBe(200);
      expect(html.text).toMatch(/<h1>Notes<\/h1>/);
      expect(html.text).toMatch(/Read the docs/);
    });

    test('a show action renders /<controller>/<action>', async () => {
      const res = await request
        .get(`/notes/${noteId}`)
        .set('Accept', 'text/html');

      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<title>Note<\/title>/);
      expect(res.text).toMatch(/Read the docs/);
    });

    test('an action that answers explicitly is left alone', async () => {
      const res = await request
        .post(`/notes/${noteId}/archive`)
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(true);
      expect(res.body._links.self.href).toBe(`/notes/${noteId}`);
    });

    test('the collection and nested routes render their own pages', async () => {
      const search = await request
        .get('/notes/search?q=docs')
        .set('Accept', 'application/json');

      expect(search.body.data.notes).toHaveLength(1);

      const comments = await request
        .get(`/notes/${noteId}/comments`)
        .set('Accept', 'application/json');

      expect(comments.body.data).toEqual({ comments: [], noteId });
    });
  });

  describe('flash messages', () => {
    test('survive exactly one redirect', async () => {
      const agent = supertest.agent(app);
      const created = await agent
        .post('/notes')
        .set('Accept', 'text/html')
        .send({ title: 'Flashy' });

      expect(created.status).toBe(302);
      expect(created.headers.location).toBe('/notes');

      const first = await agent.get('/notes').set('Accept', 'text/html');

      expect(first.text).toMatch(/<p class="notice">Note \d+ saved<\/p>/);

      const second = await agent.get('/notes').set('Accept', 'text/html');

      expect(second.text).not.toMatch(/class="notice"/);
    });

    test('are exposed to the views and to the json answer', async () => {
      const agent = supertest.agent(app);

      await agent
        .post('/notes')
        .set('Accept', 'text/html')
        .send({ title: 'J' });

      const res = await agent.get('/notes').set('Accept', 'application/json');

      expect(res.body.flash.notice).toEqual([expect.stringMatching(/saved$/)]);

      const again = await agent.get('/notes').set('Accept', 'application/json');

      expect(again.body.flash).toEqual({});
    });

    test('a request that never renders leaves them alone', async () => {
      const agent = supertest.agent(app);

      await agent
        .post('/notes')
        .set('Accept', 'text/html')
        .send({ title: 'K' });

      // /version answers json by hand: it consumes nothing
      await agent.get('/version');

      const res = await agent.get('/notes').set('Accept', 'application/json');

      expect(res.body.flash.notice).toHaveLength(1);
    });
  });
});
