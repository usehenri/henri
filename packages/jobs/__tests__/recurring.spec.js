const { adapterFor, build, close, sharedKey, target } = require('./helpers');
const { Runner } = require('../src/runner');

const HOUR = 3600000;

describe(`recurring (${target.name})`, () => {
  const adapters = [];

  afterAll(() => close(adapters));

  /**
   * A queue with a recurring schedule
   *
   * @param {object} recurring The `jobs.recurring` configuration
   * @param {string} [key] The database key
   * @returns {Promise<object>} The queue
   */
  const withSchedule = async (recurring, key) => {
    const adapter = await adapterFor(key);

    adapters.push(adapter);

    const built = await build({ adapter, config: { recurring } });

    return built.jobs;
  };

  test('enqueues nothing before the first slot is due', async () => {
    const jobs = await withSchedule({
      hourly: { cron: '0 * * * *', job: 'ok' },
    });
    const runner = new Runner(jobs);

    expect(await runner.schedule(Date.now())).toEqual([]);
    expect(await jobs.count()).toBe(0);
  });

  test('enqueues the job once the slot is due', async () => {
    const jobs = await withSchedule({
      hourly: { cron: '0 * * * *', job: 'ok' },
    });
    const runner = new Runner(jobs);

    await runner.schedule(Date.now());

    // Pretend the slot the schedule is waiting for has come
    const row = await jobs.store.schedule('hourly');

    await jobs.store.resetSchedule({
      name: 'hourly',
      next: Date.now() - 1000,
      now: Date.now(),
      spec: row.spec,
    });

    const enqueued = await runner.schedule(Date.now());

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].name).toBe('ok');
    expect(enqueued[0].uniqueKey).toMatch(/^recurring:hourly:/);
  });

  test('one runner only wins a slot when several race for it', async () => {
    const key = sharedKey('recurring');
    const first = await withSchedule(
      { nightly: { cron: '0 3 * * *', job: 'counter' } },
      key
    );
    const second = await withSchedule(
      { nightly: { cron: '0 3 * * *', job: 'counter' } },
      key
    );
    const runners = [new Runner(first), new Runner(second)];

    await runners[0].schedule(Date.now());
    await first.store.resetSchedule({
      name: 'nightly',
      next: Date.now() - 1000,
      now: Date.now(),
      spec: 'cron:0 3 * * *',
    });

    const results = await Promise.all(
      runners.map((runner) => runner.schedule(Date.now()))
    );

    expect(results.flat()).toHaveLength(1);
    expect(await first.count()).toBe(1);
  });

  test('a missed slot runs once, not once per slot that went by', async () => {
    const jobs = await withSchedule({
      hourly: { cron: '0 * * * *', job: 'ok' },
    });
    const runner = new Runner(jobs);
    const now = Date.now();

    await runner.schedule(now);
    // The runner was down for a day
    await jobs.store.resetSchedule({
      name: 'hourly',
      next: now - 24 * HOUR,
      now,
      spec: 'cron:0 * * * *',
    });

    const first = await runner.schedule(now);

    expect(first).toHaveLength(1);

    // The schedule is back on the next slot, not on the 23 it missed
    const row = await jobs.store.schedule('hourly');

    expect(Number(row.next_run_at)).toBeGreaterThan(now);
    expect(Number(row.next_run_at)).toBeLessThanOrEqual(now + HOUR);
    expect(await runner.schedule(now)).toEqual([]);
    expect(await jobs.count()).toBe(1);
  });

  test('reads `every` as a slot anchored on the epoch', async () => {
    const jobs = await withSchedule({
      often: { every: '15m', job: 'ok', queue: 'timers' },
    });
    const runner = new Runner(jobs);
    const now = Date.now();

    await runner.schedule(now);

    const row = await jobs.store.schedule('often');

    expect(Number(row.next_run_at) % 900000).toBe(0);
    expect(Number(row.next_run_at)).toBeGreaterThan(now);
  });

  test('moves a schedule whose expression changed without running it', async () => {
    const key = sharedKey('respec');
    const jobs = await withSchedule(
      { nightly: { cron: '0 3 * * *', job: 'ok' } },
      key
    );

    await new Runner(jobs).schedule(Date.now());

    const before = await jobs.store.schedule('nightly');

    expect(before.spec).toBe('cron:0 3 * * *');

    const changed = await build({
      adapter: jobs.store.adapter,
      config: { recurring: { nightly: { cron: '0 4 * * *', job: 'ok' } } },
    });

    expect(await new Runner(changed.jobs).schedule(Date.now())).toEqual([]);

    const after = await changed.jobs.store.schedule('nightly');

    expect(after.spec).toBe('cron:0 4 * * *');
    expect(Number(after.next_run_at)).not.toBe(Number(before.next_run_at));
    expect(await jobs.count()).toBe(0);
  });

  test('forgets a schedule the configuration no longer declares', async () => {
    const key = sharedKey('forget');
    const jobs = await withSchedule({ gone: { every: '1h', job: 'ok' } }, key);

    await new Runner(jobs).schedule(Date.now());
    expect(await jobs.store.schedule('gone')).not.toBeNull();

    const empty = await build({ adapter: jobs.store.adapter });

    await new Runner(empty.jobs).schedule(Date.now());

    expect(await jobs.store.schedule('gone')).toBeNull();
  });

  test('refuses a schedule with neither cron nor every', async () => {
    await expect(withSchedule({ broken: { job: 'ok' } })).rejects.toThrow(
      'needs a "cron" or an "every"'
    );
  });

  test('refuses a schedule with both', async () => {
    await expect(
      withSchedule({ broken: { cron: '* * * * *', every: '1h', job: 'ok' } })
    ).rejects.toThrow('pick one');
  });
});
