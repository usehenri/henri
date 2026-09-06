const { build, close, target } = require('./helpers');
const { Runner } = require('../src/runner');

/**
 * What the queue hands OpenTelemetry, and what it never does.
 *
 * Core owns the tracer and the rule (`base/telemetry.js`): what leaves the
 * process is henri's own or an identifier that means nothing on its own.
 * The queue is the one place where an application's *data* is right there
 * -- a job's arguments -- so the test that they never reach a span is the
 * one worth having, and it gets its own case.
 *
 * `henri.telemetry` is stubbed rather than imported: the queue peer-depends
 * on core and calls three of its methods, and this is what it may assume of
 * them.
 */
describe(`the queue and telemetry (${target.name})`, () => {
  const adapters = [];
  let jobs = null;
  let henri = null;
  let spans = [];
  let measured = [];

  /** The two calls `@usehenri/jobs` makes of `henri.telemetry` */
  const telemetry = () => ({
    enabled: true,
    /**
     * A histogram that keeps what it was given
     *
     * @param {string} name the instrument name
     * @returns {object} the recorder
     */
    histogram: (name) => ({
      /**
       * Record one measurement
       *
       * @param {number} value the measurement
       * @param {object} attributes its dimensions
       * @returns {void}
       */
      record: (value, attributes) => measured.push({ attributes, name, value }),
    }),
    /**
     * Register an observable (never called back here)
     *
     * @returns {boolean} registered
     */
    observe: () => true,
    /**
     * Run something inside a span
     *
     * @param {string} name the span name
     * @param {object} options its attributes and boundary
     * @param {Function} fn what to run
     * @returns {*} whatever it answered
     */
    span: (name, options, fn) => {
      spans.push({ name, ...options });

      return fn();
    },
  });

  beforeAll(async () => {
    const built = await build();

    jobs = built.jobs;
    henri = built.henri;
    adapters.push(built.adapter);
  });

  afterAll(() => close(adapters));

  beforeEach(async () => {
    for (const state of ['dead', 'done', 'pending', 'running']) {
      await jobs.store.remove({ state });
    }

    spans = [];
    measured = [];
    henri.telemetry = telemetry();
    global.__henriJobsRuns = [];
  });

  afterEach(() => {
    delete henri.telemetry;
  });

  test('one span per job run, named for the job', async () => {
    const job = await jobs.perform('ok', { hello: 'world' });

    await new Runner(jobs, { concurrency: 1, recurring: false }).once();

    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('henri.job ok');
    expect(spans[0].boundary).toBe('jobs');
    expect(spans[0].kind).toBe('consumer');
    expect(spans[0].attributes).toEqual({
      'henri.job.attempt': 1,
      'henri.job.id': job.id,
      'henri.job.name': 'ok',
      'henri.job.queue': 'default',
    });
  });

  // The rule of base/telemetry.js, on the one boundary that has the
  // application's own data in its hand
  test('and never the arguments the job was given', async () => {
    await jobs.perform('ok', {
      email: 'ada@example.com',
      token: 'hunter2',
    });

    await new Runner(jobs, { concurrency: 1, recurring: false }).once();

    const written = JSON.stringify(spans);

    expect(written).not.toContain('ada@example.com');
    expect(written).not.toContain('hunter2');
    expect(written).not.toContain('email');
    expect(Object.keys(spans[0].attributes).sort()).toEqual([
      'henri.job.attempt',
      'henri.job.id',
      'henri.job.name',
      'henri.job.queue',
    ]);
  });

  test('a job that failed still ran inside its span, and still failed', async () => {
    await jobs.perform('boom');

    const result = await new Runner(jobs, {
      concurrency: 1,
      recurring: false,
    }).once();

    expect(result.failed).toBe(1);
    expect(spans.map((span) => span.name)).toEqual(['henri.job boom']);
  });

  test('the claim is measured, whatever it claimed', async () => {
    await new Runner(jobs, { concurrency: 1, recurring: false }).once();

    const claims = measured.filter(
      (entry) => entry.name === 'henri.jobs.claim.duration'
    );

    expect(claims.length).toBeGreaterThan(0);
    expect(claims[0].value).toBeGreaterThanOrEqual(0);
    expect(claims[0].attributes).toEqual({ 'henri.jobs.claimed': 0 });
  });

  test('without a telemetry the queue performs exactly as it did', async () => {
    delete henri.telemetry;

    const job = await jobs.perform('ok', { hello: 'world' });

    await new Runner(jobs, { concurrency: 1, recurring: false }).once();

    expect((await jobs.get(job.id)).state).toBe('done');
    expect(spans).toEqual([]);
    expect(measured).toEqual([]);
  });
});
