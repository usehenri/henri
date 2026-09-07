// The job assertions, without a queue behind them: what an application that
// has no `@usehenri/jobs` is told, and what the filter accepts. The real
// queue -- rows, args through JSON, a job performed -- is mail-app.spec.js,
// against the demo application and its MongoDB store.
const { clearJobs, enqueued } = require('../jobs');

/**
 * An application whose queue answers from an array
 *
 * @param {Array<object>} rows what `list()` hands back
 * @returns {object} a henri look-alike, with `asked` recording the filters
 */
const application = (rows = []) => {
  const asked = [];
  const discarded = [];

  return {
    asked,
    discarded,
    jobs: {
      enabled: true,
      list: async (filter) => {
        asked.push(filter);

        return rows;
      },
      ready: () => ({
        discard: async (id) => {
          discarded.push(id);

          return true;
        },
      }),
    },
  };
};

describe('enqueued()', () => {
  afterEach(() => {
    delete global.henri;
  });

  test('asks for the waiting jobs, which is what enqueued means', async () => {
    global.henri = application([{ id: 'a', name: 'welcome' }]);

    const jobs = await enqueued();

    expect(jobs).toHaveLength(1);
    expect(global.henri.asked[0]).toMatchObject({ state: 'pending' });
    // Higher than the queue's own console default: a suite asserting that
    // nothing was enqueued wants to see everything there is
    expect(global.henri.asked[0].limit).toBeGreaterThan(50);
  });

  test('a string is the job name', async () => {
    global.henri = application();

    await enqueued('welcome');

    expect(global.henri.asked[0]).toMatchObject({ name: 'welcome' });
  });

  test('a state of null asks for every state', async () => {
    global.henri = application();

    await enqueued({ queue: 'mail', state: null });

    expect(global.henri.asked[0]).toMatchObject({ queue: 'mail', state: null });
  });

  test('a filter the queue cannot answer is refused, never ignored', async () => {
    global.henri = application();

    await expect(enqueued({ job: 'welcome' })).rejects.toThrow(
      /does not filter on job/u
    );
    await expect(enqueued(42)).rejects.toThrow(/job name or a filter object/u);
    await expect(enqueued({ job: 'welcome' })).rejects.toMatchObject({
      code: 'HENRI_ARGUMENT_INVALID',
    });
  });

  test('an application without the package is told what to install', async () => {
    global.henri = {};

    await expect(enqueued()).rejects.toThrow(/npm install @usehenri\/jobs/u);
    await expect(enqueued()).rejects.toMatchObject({
      code: 'HENRI_JOB_QUEUE_UNAVAILABLE',
    });
  });

  test('an application that asked for no queue is told that instead', async () => {
    global.henri = { jobs: { enabled: false } };

    await expect(enqueued()).rejects.toThrow(/asked for no queue/u);
    await expect(enqueued()).rejects.toMatchObject({
      code: 'HENRI_JOB_QUEUE_UNAVAILABLE',
    });
  });

  test('and an empty list is never the answer to a missing queue', async () => {
    global.henri = { jobs: { enabled: false } };

    // The one failure mode a test helper must not have: `toHaveLength(0)`
    // passing because the feature is not installed
    await expect(enqueued()).rejects.toThrow();
  });

  test('nothing running says how to boot', async () => {
    delete global.henri;

    await expect(enqueued()).rejects.toMatchObject({
      code: 'HENRI_BOOT_TESTING_NOT_RUNNING',
    });
  });
});

describe('clearJobs()', () => {
  afterEach(() => {
    delete global.henri;
  });

  test('forgets every job it was asked about, whatever its state', async () => {
    global.henri = application([{ id: 'a' }, { id: 'b' }]);

    expect(await clearJobs()).toBe(2);
    expect(global.henri.asked[0]).toMatchObject({ state: null });
    expect(global.henri.discarded).toEqual(['a', 'b']);
  });

  test('a filter narrows what it forgets', async () => {
    global.henri = application([{ id: 'a' }]);

    expect(await clearJobs({ queue: 'mail' })).toBe(1);
    expect(global.henri.asked[0]).toMatchObject({ queue: 'mail' });
  });
});
