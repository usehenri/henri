const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { cleanup, henri, scaffold } = require('./helpers');

const bin = path.resolve(__dirname, '../../henri/bin/henri.js');

// A minimal application on a drizzle sqlite file, so the queue survives
// between two runs of the command line
const fixture = path.join(__dirname, 'fixtures', 'jobs-app');

/**
 * Core resolves the adapter and @usehenri/jobs from the application
 * directory: link the workspace packages into the fixture's node_modules
 * (ignored by git)
 *
 * @returns {void}
 */
const link = () => {
  for (const name of ['drizzle', 'jobs']) {
    const target = path.join(fixture, 'node_modules', '@usehenri', name);

    fs.mkdirSync(path.dirname(target), { recursive: true });

    if (!fs.existsSync(target)) {
      fs.symlinkSync(
        path.resolve(__dirname, '../../', name),
        target,
        'junction'
      );
    }
  }
};

/**
 * Runs a henri command in the fixture and parses its JSON
 *
 * @param {string[]} args Arguments (--json is added)
 * @param {object} [env={}] Extra environment
 * @returns {object} `{ status, result, stderr }`
 */
const run = (args, env = {}) => {
  const answer = henri([...args, '--json'], {
    cwd: fixture,
    env: { ...process.env, ...env },
    timeout: 120000,
  });

  return {
    result: answer.stdout ? JSON.parse(answer.stdout) : null,
    status: answer.status,
    stderr: answer.stderr,
  };
};

/**
 * Starts `henri jobs --once` as a process of its own
 *
 * @param {object} env Extra environment
 * @returns {Promise<number>} Its exit code
 */
const runner = (env) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, 'jobs', '--once', '--json'], {
      cwd: fixture,
      env: { ...process.env, ...env },
      stdio: 'ignore',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });

describe('henri jobs', () => {
  describe('usage', () => {
    let dir;
    let app;

    beforeAll(() => {
      ({ app, dir } = scaffold(['--no-git']));
    });

    afterAll(() => {
      cleanup(dir);
    });

    test('refuses an unknown jobs command', () => {
      const { status, stderr } = henri(['jobs:nope', '--json'], { cwd: app });

      expect(status).toBe(2);

      const { error } = JSON.parse(stderr);

      expect(error.message).toBe('Unknown jobs command "nope"');
      expect(error.hint).toContain('install');
    });

    test('says what to install when the application has no queue', () => {
      const { status, stderr } = henri(['jobs:status', '--json'], {
        cwd: app,
        timeout: 120000,
      });

      expect(status).toBe(1);

      const { error } = JSON.parse(stderr);

      expect(error.message).toBe('This application has no job queue');
      expect(error.hint).toContain('@usehenri/jobs');
    });
  });

  describe('a real application', () => {
    const report = path.join(fixture, '.henri', 'performed.log');

    beforeAll(() => {
      link();
      fs.rmSync(path.join(fixture, '.henri'), {
        force: true,
        recursive: true,
      });
      fs.mkdirSync(path.join(fixture, '.henri'), { recursive: true });
    });

    afterAll(() => {
      fs.rmSync(path.join(fixture, '.henri'), {
        force: true,
        recursive: true,
      });
    });

    test('creates the tables, and says so again without changing anything', () => {
      const first = run(['jobs:install']);

      expect(first.status).toBe(0);
      expect(first.result).toMatchObject({
        command: 'install',
        ok: true,
        store: 'default',
        tables: {
          jobs: 'henri_jobs',
          schedules: 'henri_jobs_schedules',
        },
      });
      expect(first.result.statements.join('\n')).toContain(
        'CREATE TABLE IF NOT EXISTS'
      );

      expect(run(['jobs:install']).status).toBe(0);
    });

    test('enqueues a job from the command line', () => {
      const { result, status } = run([
        'jobs',
        'perform',
        'ping',
        '{"hello":"cli"}',
      ]);

      expect(status).toBe(0);
      expect(result.job).toMatchObject({
        args: { hello: 'cli' },
        name: 'ping',
        queue: 'default',
        state: 'pending',
      });
    });

    test('refuses arguments that are not JSON', () => {
      const { status, stderr } = henri(
        ['jobs', 'perform', 'ping', 'nope', '--json'],
        { cwd: fixture, timeout: 120000 }
      );

      expect(status).toBe(2);
      expect(JSON.parse(stderr).error.message).toContain('not JSON');
    });

    test('performs what is due with --once and stops', () => {
      const { result, status } = run(['jobs', '--once'], {
        HENRI_JOBS_REPORT: report,
      });

      expect(status).toBe(0);
      expect(result).toMatchObject({ command: 'run', ok: true, performed: 1 });
      expect(fs.readFileSync(report, 'utf8')).toContain('{"hello":"cli"}');
    });

    test('lists the queue and shows one job with its history', () => {
      const listed = run(['jobs', 'list', '--state=done']);

      expect(listed.status).toBe(0);
      expect(listed.result.jobs).toHaveLength(1);
      expect(listed.result.jobs[0].name).toBe('ping');

      const shown = run(['jobs', 'show', listed.result.jobs[0].id]);

      expect(shown.status).toBe(0);
      expect(shown.result.job.state).toBe('done');
      expect(shown.result.job.duration).toBeGreaterThanOrEqual(0);
    });

    test('says which id it cannot find', () => {
      const { status, stderr } = henri(['jobs', 'show', 'nope', '--json'], {
        cwd: fixture,
        timeout: 120000,
      });

      expect(status).toBe(1);
      expect(JSON.parse(stderr).error.message).toBe('No job with id "nope"');
    });

    test('counts by queue and state, with the schedules', () => {
      const { result, status } = run(['jobs:status']);

      expect(status).toBe(0);
      expect(result.totals.done).toBe(1);
      expect(result.jobs).toEqual(
        expect.arrayContaining(['boom', 'henri/mail', 'ping'])
      );
      expect(result.recurring).toEqual([
        { job: 'ping', name: 'nightly', spec: 'cron:0 3 * * *' },
      ]);
      expect(result.timings[0].runs).toBe(1);
    });

    test('drives the dead letter queue', () => {
      expect(run(['jobs', 'perform', 'boom']).status).toBe(0);
      expect(run(['jobs', '--once']).status).toBe(0);

      const dead = run(['jobs:dead']);

      expect(dead.status).toBe(0);
      expect(dead.result.jobs).toHaveLength(1);
      expect(dead.result.jobs[0].error.message).toBe('boom from the fixture');
      expect(dead.result.jobs[0].error.stack).toContain('boom.js');

      const { id } = dead.result.jobs[0];
      const shown = run(['jobs', 'show', id]);

      expect(shown.result.job.history).toHaveLength(1);
      expect(shown.result.job.history[0].message).toBe('boom from the fixture');

      expect(run(['jobs:retry', id]).result).toMatchObject({ requeued: 1 });
      expect(run(['jobs', '--once']).status).toBe(0);
      expect(run(['jobs:dead']).result.jobs).toHaveLength(1);
      expect(run(['jobs:discard', '--all']).result).toMatchObject({
        discarded: 1,
      });
      expect(run(['jobs:dead']).result.jobs).toHaveLength(0);
    });

    test('says which id it cannot retry or discard', () => {
      for (const command of ['retry', 'discard']) {
        const { status, stderr } = henri(['jobs', command, 'nope', '--json'], {
          cwd: fixture,
          timeout: 120000,
        });

        expect(status).toBe(1);
        expect(JSON.parse(stderr).error.message).toBe('No job with id "nope"');
      }
    });

    test('asks for an id, or --all, before retrying', () => {
      const { status, stderr } = henri(['jobs:retry', '--json'], {
        cwd: fixture,
        timeout: 120000,
      });

      expect(status).toBe(2);
      expect(JSON.parse(stderr).error.message).toContain('Missing id');
    });

    test('performs a job inline with --now', () => {
      const { result, status } = run([
        'jobs',
        'perform',
        'ping',
        '{"inline":true}',
        '--now',
      ]);

      expect(status).toBe(0);
      expect(result).toMatchObject({
        inline: true,
        result: { inline: true },
      });
    });

    test('two runner processes perform each job exactly once', async () => {
      const log = path.join(fixture, '.henri', 'concurrent.log');
      const tokens = [];

      for (let index = 0; index < 12; index += 1) {
        const token = `concurrent-${index}`;

        tokens.push(token);
        expect(
          run(['jobs', 'perform', 'ping', JSON.stringify({ token })]).status
        ).toBe(0);
      }

      const codes = await Promise.all([
        runner({ HENRI_JOBS_REPORT: log }),
        runner({ HENRI_JOBS_REPORT: log }),
      ]);

      expect(codes).toEqual([0, 0]);

      const performed = fs
        .readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line).token);

      // Every job ran, and none of them ran twice
      expect([...performed].sort()).toEqual([...tokens].sort());
      expect(run(['jobs', 'list', '--state=pending']).result.jobs).toEqual([]);
    }, 180000);

    test('prints for humans without --json', () => {
      const answer = henri(['jobs:status'], {
        cwd: fixture,
        timeout: 120000,
      });

      expect(answer.status).toBe(0);
      expect(answer.stdout).toContain('pending');
      expect(answer.stdout).toContain('Recurring:');
      expect(answer.stdout).toContain('nightly -> ping');
    });
  });
});
