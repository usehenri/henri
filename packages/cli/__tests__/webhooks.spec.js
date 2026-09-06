const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const { cleanup, henri, scaffold } = require('./helpers');

const bin = path.resolve(__dirname, '../../henri/bin/henri.js');

// A minimal application on a drizzle sqlite file, so the endpoints survive
// between two runs of the command line
const fixture = path.join(__dirname, 'fixtures', 'webhooks-app');

/**
 * The fixture depends on the adapter, on the queue and on the webhooks:
 * link the workspace packages into its node_modules (ignored by the
 * repository)
 *
 * @returns {void}
 */
const link = () => {
  for (const name of ['drizzle', 'jobs', 'webhooks']) {
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
 * @returns {object} `{ status, result, stderr }`
 */
const run = (args) => {
  const answer = henri([...args, '--json'], {
    cwd: fixture,
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
 * @returns {Promise<number>} Its exit code
 */
const worker = () =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, 'jobs', '--once', '--json'], {
      cwd: fixture,
      env: process.env,
      stdio: 'ignore',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });

describe('henri webhooks', () => {
  describe('usage', () => {
    let dir;
    let app;

    beforeAll(() => {
      ({ app, dir } = scaffold(['--no-git']));
    });

    afterAll(() => {
      cleanup(dir);
    });

    test('refuses an unknown webhooks command', () => {
      const { status, stderr } = henri(['webhooks:nope', '--json'], {
        cwd: app,
      });

      expect(status).toBe(2);

      const { error } = JSON.parse(stderr);

      expect(error.message).toBe('Unknown webhooks command "nope"');
      expect(error.hint).toContain('rotate');
    });

    test('says what to install when the application has no webhooks', () => {
      const { status, stderr } = henri(['webhooks:list', '--json'], {
        cwd: app,
        timeout: 120000,
      });

      expect(status).toBe(1);

      const { error } = JSON.parse(stderr);

      expect(error.message).toBe('This application has no webhooks');
      expect(error.hint).toContain('@usehenri/webhooks');
    });
  }, 300000);

  // Every test here spawns at least one `henri` process, each of them a full
  // boot: the default timeout is not a useful bound on a loaded machine
  describe('a real application', () => {
    let server = null;
    let received = [];

    beforeAll(async () => {
      link();
      fs.rmSync(path.join(fixture, '.henri'), {
        force: true,
        recursive: true,
      });
      fs.mkdirSync(path.join(fixture, '.henri'), { recursive: true });

      server = http.createServer((request, response) => {
        const chunks = [];

        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => {
          received.push({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: request.headers,
          });
          response.writeHead(200);
          response.end('ok');
        });
      });

      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    });

    afterAll(async () => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }

      fs.rmSync(path.join(fixture, '.henri'), {
        force: true,
        recursive: true,
      });
    });

    test('creates the table, and says so again without changing anything', () => {
      const first = run(['webhooks:install']);

      expect(first.status).toBe(0);
      expect(first.result).toMatchObject({
        command: 'install',
        ok: true,
        store: 'default',
        table: 'henri_webhooks',
      });
      expect(run(['webhooks:install']).status).toBe(0);
      expect(run(['webhooks:list']).result.endpoints).toEqual([]);
    });

    test('registers an endpoint and prints its secret once', () => {
      const { port } = server.address();
      const added = run([
        'webhooks:add',
        `http://127.0.0.1:${port}/hooks`,
        '--events',
        'invoice.*',
        '--owner',
        'tenant-a',
        '--description',
        'the receiving server of this test',
        '--header',
        'X-Acme-Env: test',
      ]);

      expect(added.status).toBe(0);
      expect(added.result.secret).toMatch(/^whsec_/u);
      expect(added.result.endpoint).toMatchObject({
        events: ['invoice.*'],
        headers: { 'x-acme-env': 'test' },
        owner: 'tenant-a',
      });

      const id = added.result.endpoint.id;
      const shown = run(['webhooks:show', id]);

      expect(shown.result.endpoint.description).toBe(
        'the receiving server of this test'
      );
      // Not unless it is asked for by name
      expect(shown.result.secrets).toBeUndefined();
      expect(run(['webhooks:show', id, '--reveal']).result.secrets).toEqual([
        added.result.secret,
      ]);

      // And the listing filters by tenant
      expect(
        run(['webhooks:list', '--owner', 'tenant-a']).result.endpoints
      ).toHaveLength(1);
      expect(
        run(['webhooks:list', '--owner', 'tenant-b']).result.endpoints
      ).toHaveLength(0);
    });

    test('sends a delivery the receiver can verify with its secret', async () => {
      received = [];

      const [endpoint] = run(['webhooks:list']).result.endpoints;
      const secret = run(['webhooks:show', endpoint.id, '--reveal']).result
        .secrets[0];
      const sent = run([
        'webhooks:send',
        endpoint.id,
        'invoice.paid',
        '--data',
        '{"total":4200}',
      ]);

      expect(sent.status).toBe(0);
      expect(sent.result.delivery.job).toBeTruthy();

      expect(await worker()).toBe(0);
      expect(received).toHaveLength(1);

      const { verify } = require('@usehenri/webhooks');

      expect(
        verify({
          body: received[0].body,
          headers: received[0].headers,
          secret,
        })
      ).toMatchObject({ id: sent.result.delivery.id, ok: true });
      expect(received[0].headers['x-acme-env']).toBe('test');
      expect(JSON.parse(received[0].body)).toMatchObject({
        data: { total: 4200 },
        type: 'invoice.paid',
      });

      // The delivery is a job, so the queue is where it is accounted for
      const status = run(['webhooks:status']);

      expect(status.result).toMatchObject({
        endpoints: { total: 1 },
        queue: 'webhooks',
      });
      expect(status.result.deliveries.done).toBe(1);
    });

    test('rotates, disables, enables and removes', () => {
      const [endpoint] = run(['webhooks:list']).result.endpoints;
      const rotated = run(['webhooks:rotate', endpoint.id, '--grace', '24h']);

      expect(rotated.result.secret).toMatch(/^whsec_/u);
      expect(
        run(['webhooks:show', endpoint.id, '--reveal']).result.secrets
      ).toHaveLength(2);

      expect(
        run(['webhooks:disable', endpoint.id, '--reason', 'the test did'])
          .result.endpoint
      ).toMatchObject({ disabled: true, disabledReason: 'the test did' });
      expect(
        run(['webhooks:list', '--disabled']).result.endpoints
      ).toHaveLength(1);
      expect(
        run(['webhooks:enable', endpoint.id]).result.endpoint.disabled
      ).toBe(false);

      expect(
        run(['webhooks:update', endpoint.id, '--events', 'order.*,invoice.*'])
          .result.endpoint.events
      ).toEqual(['order.*', 'invoice.*']);

      expect(run(['webhooks:remove', endpoint.id]).result).toMatchObject({
        ok: true,
        removed: true,
      });
      expect(run(['webhooks:list']).result.endpoints).toEqual([]);
    });

    test('refuses a url a delivery would never open', () => {
      const { status, stderr } = henri(
        ['webhooks:add', 'file:///etc/passwd', '--events', '*', '--json'],
        { cwd: fixture, timeout: 120000 }
      );

      expect(status).toBe(1);
      expect(JSON.parse(stderr).error.message).toMatch(/is not delivered to/u);
    });

    test('says what is missing rather than guessing', () => {
      expect(
        JSON.parse(
          henri(['webhooks:show', '--json'], { cwd: fixture, timeout: 120000 })
            .stderr
        ).error.message
      ).toBe('Missing endpoint id');
      expect(
        JSON.parse(
          henri(['webhooks:add', 'https://acme.example/h', '--json'], {
            cwd: fixture,
            timeout: 120000,
          }).stderr
        ).error.message
      ).toBe('Missing --events');
    });

    test('the human output names the endpoint and its secret', () => {
      const { port } = server.address();
      const answer = henri(
        [
          'webhooks:add',
          `http://127.0.0.1:${port}/hooks`,
          '--events',
          'plain.text',
        ],
        { cwd: fixture, timeout: 120000 }
      );

      expect(answer.status).toBe(0);
      expect(answer.stdout).toContain('whsec_');
      expect(answer.stdout).toContain('hand it to the receiver now');
      expect(
        henri(['webhooks'], { cwd: fixture, timeout: 120000 }).stdout
      ).toContain('plain.text');
    });
  }, 300000);
});
