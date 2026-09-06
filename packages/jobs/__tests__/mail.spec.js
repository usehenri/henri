const path = require('path');

const { build, close, target } = require('./helpers');
const { MAIL_JOB } = require('../src/jobs');
const { Runner } = require('../src/runner');

/**
 * `henri.mailers.deliverLater()` renders a message and hands the rendered
 * nodemailer payload to whatever `onDeliverLater()` registered. That seam is
 * what turns the mailers into a real queue: core registers the handler (see
 * `packages/core/src/4.jobs.js`), and the payload is performed by the job
 * this package ships.
 *
 * The stand-in below is the mailers module's half of the contract, so this
 * suite covers the round trip without booting a view engine.
 */
const fakeMailers = () => {
  const state = { handler: null };

  return {
    /**
     * Hand a rendered message to the handler, as the mailers module does
     *
     * @param {object} message A nodemailer payload
     * @param {object} [options={}] The options of the deliverLater() call
     * @returns {Promise<*>} What the handler answered
     */
    deliverLater: (message, options = {}) =>
      state.handler
        ? state.handler(message, options)
        : Promise.resolve({ deferred: true, handler: 'inline' }),

    /**
     * Register the delivery handler
     *
     * @param {?function} handler The handler, or null
     * @returns {boolean} success
     */
    onDeliverLater: (handler) => {
      state.handler = handler;

      return true;
    },
  };
};

describe(`mail delivery (${target.name})`, () => {
  const adapters = [];
  const sent = [];
  let jobs = null;
  let mailers = null;

  beforeAll(async () => {
    const built = await build();

    jobs = built.jobs;
    adapters.push(built.adapter);

    mailers = fakeMailers();
    built.henri.mail = {
      send: async (message) => {
        sent.push(message);

        return { messageId: `sent-${sent.length}` };
      },
    };
    built.henri.mailers = mailers;

    // What packages/core/src/4.jobs.js does once the queue is started
    mailers.onDeliverLater((message, options) =>
      jobs.enqueue(MAIL_JOB, message, options)
    );
  });

  afterAll(() => close(adapters));

  beforeEach(async () => {
    for (const state of ['pending', 'running', 'done', 'dead']) {
      await jobs.store.remove({ state });
    }

    sent.length = 0;
  });

  test('ships a job that sends a rendered message', () => {
    expect(jobs.names()).toContain(MAIL_JOB);
    expect(jobs.definitions[MAIL_JOB].queue).toBe('mailers');
  });

  test('a later delivery reaches the queue and is performed', async () => {
    const message = {
      from: 'henri@example.com',
      html: '<h1>Hello</h1>',
      subject: 'Hello',
      text: 'Hello',
      to: 'ada@example.com',
    };

    const enqueued = await mailers.deliverLater(message);

    expect(enqueued.name).toBe(MAIL_JOB);
    expect(enqueued.queue).toBe('mailers');
    expect(enqueued.state).toBe('pending');
    expect(sent).toHaveLength(0);

    await new Runner(jobs).once();

    expect(sent).toEqual([message]);
    expect((await jobs.get(enqueued.id)).state).toBe('done');
  });

  test('maps the delay of the call onto the queue, not a second scheme', async () => {
    const later = await mailers.deliverLater(
      { subject: 'Later', to: 'ada@example.com' },
      { wait: '1h' }
    );

    expect(new Date(later.runAt).getTime()).toBeGreaterThan(
      Date.now() + 3500000
    );

    const when = new Date(Date.now() + 86400000);
    const dated = await mailers.deliverLater(
      { subject: 'Dated', to: 'ada@example.com' },
      { at: when, queue: 'newsletters' }
    );

    expect(dated.runAt).toBe(when.toISOString());
    expect(dated.queue).toBe('newsletters');
  });

  test('carries a rendered body of any reasonable size', async () => {
    const html = `<p>${'x'.repeat(200 * 1024)}</p>`;
    const enqueued = await mailers.deliverLater({
      html,
      subject: 'Big',
      to: 'ada@example.com',
    });

    await new Runner(jobs).once();

    expect(sent[0].html).toHaveLength(html.length);
    expect((await jobs.get(enqueued.id)).state).toBe('done');
  });

  test('says so instead of truncating a body over the limit', async () => {
    const built = await build({ config: { maxArgsBytes: 1024 } });

    adapters.push(built.adapter);

    await expect(
      built.jobs.enqueue(MAIL_JOB, { html: 'x'.repeat(2048) })
    ).rejects.toThrow('over the 1024 bytes limit');
  });

  test('a mail that fails to send is retried, then buried with its error', async () => {
    const built = await build();

    adapters.push(built.adapter);
    built.henri.mail = {
      send: async () => {
        throw new Error('smtp refused the message');
      },
    };

    const enqueued = await built.jobs.enqueue(
      MAIL_JOB,
      { subject: 'Doomed' },
      { maxAttempts: 1 }
    );

    await new Runner(built.jobs).once();

    const job = await built.jobs.get(enqueued.id);

    expect(job.state).toBe('dead');
    expect(job.error.message).toBe('smtp refused the message');
    expect(await built.jobs.dead.count()).toBe(1);
  });

  test('an application may override the job with its own file', async () => {
    const built = await build({
      cwd: path.join(__dirname, 'fixtures', 'override'),
    });

    adapters.push(built.adapter);

    expect(built.jobs.definitions[MAIL_JOB].queue).toBe('own-mailers');
    expect(await built.jobs.performNow(MAIL_JOB, { subject: 'Own' })).toBe(
      'the application sent it'
    );
  });
});
