// The inbox and the job assertions against a real application: the demo app
// on @usehenri/disk, with `@usehenri/jobs` installed and `app/jobs` holding a
// file, so `deliverLater()` really does write a row that a runner would
// claim. What is proved here is what the unit tests cannot: that the two
// doors are the two doors, that the row carries what the test says it does,
// and that a message performed off the queue comes back as a delivery.
const path = require('node:path');

const {
  clearInbox,
  clearJobs,
  enqueued,
  inbox,
  request,
  setup,
  teardown,
} = require('../index.js');

/** The demo application of this repository */
const APP = path.resolve(__dirname, '..', '..', 'demo');

const ada = { email: 'ada@example.com', name: 'Ada' };

describe('mail and jobs (demo app, disk store)', () => {
  const previous = process.cwd();

  beforeAll(async () => {
    process.chdir(APP);
    await setup();
  }, 60000);

  afterAll(async () => {
    await teardown();
    process.chdir(previous);
  });

  beforeEach(async () => {
    clearInbox();
    await clearJobs();
  });

  test('the queue is what this application has', () => {
    expect(henri.jobs.enabled).toBe(true);
  });

  test('deliver() puts the rendered message in the inbox', async () => {
    await henri.mailers.welcome.confirm(ada).deliver();

    const [mail] = inbox();

    expect(inbox()).toHaveLength(1);
    expect(mail.to).toEqual([ada.email]);
    expect(mail.from).toBe('no-reply@example.com');
    expect(mail.subject).toBe(`Confirm ${ada.email}`);
    expect(mail.mailer).toBe('welcome');
    expect(mail.action).toBe('confirm');
    expect(mail.deferred).toBe(false);
    // The view was rendered, and so was the text part derived from it
    expect(mail.html).toContain('Hello Ada');
    expect(mail.html).toContain('abc123');
    expect(mail.text).toContain('abc123');
  });

  test('deliverLater() is in the inbox and in the queue, once each', async () => {
    await henri.mailers.welcome.confirm(ada).deliverLater();

    const [mail] = inbox();
    const [job] = await enqueued();

    expect(inbox()).toHaveLength(1);
    expect(mail.deferred).toBe(true);
    expect(mail.subject).toBe(`Confirm ${ada.email}`);

    expect(await enqueued()).toHaveLength(1);
    expect(job.name).toBe('henri/mail');
    // The row carries the rendered message, which is what a runner sends
    expect(job.args.subject).toBe(`Confirm ${ada.email}`);
    expect(job.args.to).toBe(ada.email);
    expect(job.state).toBe('pending');
  });

  test('performing the job adds the delivery to the inbox', async () => {
    await henri.mailers.welcome.confirm(ada).deliverLater();

    const [job] = await enqueued();

    await henri.jobs.performNow(job.name, job.args);

    // Two things happened -- an enqueue and a delivery -- and the inbox says
    // which was which
    expect(inbox().map((mail) => mail.deferred)).toEqual([true, false]);
    expect(inbox({ deferred: false })[0].subject).toBe(`Confirm ${ada.email}`);
  });

  test('a job the application enqueues carries its arguments', async () => {
    await henri.jobs.perform('echo', { hello: 'world' });

    const [job] = await enqueued('echo');

    expect(job.args).toEqual({ hello: 'world' });
    expect(job.queue).toBe('default');
    expect(await enqueued('nothing')).toHaveLength(0);
  });

  test('clearJobs() empties the queue whatever the state', async () => {
    await henri.jobs.perform('echo', { hello: 'world' });
    await henri.mailers.welcome.confirm(ada).deliverLater();

    expect(await clearJobs()).toBe(2);
    expect(await enqueued({ state: null })).toHaveLength(0);
  });

  test('the inbox is emptied between tests, so this one starts at zero', () => {
    expect(inbox()).toHaveLength(0);
  });

  test('signing up sends the confirmation mail, which is the whole point', async () => {
    const email = `inbox-${process.pid}-${Date.now()}@example.test`;
    const answer = await request()
      .post('/signup')
      .send({ email, name: 'Ada', password: 'analytical-engine-1843' });

    // The flows mail out of band, so the request answers before the mail is
    // rendered: `drain()` is what waits for it
    await henri.accounts.drain();

    const [mail] = inbox();

    expect(answer.status).toBeLessThan(400);
    expect(inbox()).toHaveLength(1);
    expect(mail.mailer).toBe('auth');
    expect(mail.action).toBe('confirm');
    expect(mail.deferred).toBe(true);
    expect(mail.to).toEqual([email]);
    expect(mail.html).toContain('/confirm/');
    // And the queue holds the delivery, because this application has one
    expect(await enqueued({ name: 'henri/mail' })).toHaveLength(1);
  });
});
