const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { check } = require('../scripts/doctor');
const { cleanup, henri, scaffold, tmpdir } = require('./helpers');

const SECRET = 'sk-live-do-not-print-me';

/**
 * A henri application with nothing in it but what the CLI checks
 *
 * @param {string} dir The temporary directory
 * @returns {string} The application directory
 */
const application = (dir) => {
  fs.mkdirSync(path.join(dir, 'app', 'views', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ henri: true, name: 'app' })
  );
  fs.writeFileSync(
    path.join(dir, 'config', 'default.json'),
    JSON.stringify({ port: 3000 })
  );

  return dir;
};

/**
 * An EDITOR: a node script running `body` with the file as its argument
 *
 * @param {string} dir Where to write the script
 * @param {string} name Its name
 * @param {string} body The body, with `file` in scope
 * @returns {string} The EDITOR command
 */
const editor = (dir, name, body) => {
  const script = path.join(dir, `${name}.js`);

  fs.writeFileSync(
    script,
    `const fs = require('fs');\nconst file = process.argv[2];\n${body}\n`
  );

  return `${process.execPath} ${script}`;
};

/**
 * Run the CLI with an editor
 *
 * @param {Array<string>} args The arguments
 * @param {string} app The application directory
 * @param {string} [command] The EDITOR (unset when omitted)
 * @returns {object} The spawnSync result
 */
const run = (args, app, command) =>
  henri(args, {
    cwd: app,
    env: {
      ...process.env,
      EDITOR: command || '',
      VISUAL: '',
    },
  });

describe('henri credentials', () => {
  let dir;
  let app;
  let saves;

  beforeEach(() => {
    dir = tmpdir('henri-credentials-');
    app = application(dir);
    saves = editor(
      dir,
      'save',
      `const values = JSON.parse(fs.readFileSync(file, 'utf8'));
values.mail = { auth: { pass: ${JSON.stringify(SECRET)} } };
fs.writeFileSync(file, JSON.stringify(values, null, 2) + '\\n');
fs.writeFileSync(
  process.env.HENRI_TEST_REPORT,
  JSON.stringify({ file, mode: fs.statSync(file).mode & 0o777 })
);`
    );
  });

  afterEach(() => {
    cleanup(dir);
  });

  const report = () =>
    JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));

  const edit = (args = [], command = saves) =>
    henri(['credentials:edit', '--env', 'dev', ...args], {
      cwd: app,
      env: {
        ...process.env,
        EDITOR: command,
        HENRI_TEST_REPORT: path.join(dir, 'report.json'),
        VISUAL: '',
      },
    });

  test('the first edit writes the key, the file and the ignore line', () => {
    const { status, stdout } = edit();

    expect(status).toBe(0);
    expect(stdout).toContain('Generated config/credentials/dev.key');
    expect(stdout).toContain('Added it to .gitignore');

    const key = path.join(app, 'config', 'credentials', 'dev.key');
    const file = path.join(app, 'config', 'credentials', 'dev.json.enc');

    expect(fs.readFileSync(key, 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.statSync(key).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^henri:v1:/);
    expect(fs.readFileSync(file, 'utf8')).not.toContain(SECRET);
    expect(fs.readFileSync(path.join(app, '.gitignore'), 'utf8')).toContain(
      'config/credentials/*.key'
    );
  });

  test('the plaintext is written 0600 and removed when the editor closes', () => {
    edit();

    const { file, mode } = report();

    expect(mode).toBe(0o600);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.dirname(file))).toBe(false);
  });

  test('a second edit opens what the first one wrote', () => {
    edit();

    const seen = editor(
      dir,
      'seen',
      `fs.writeFileSync(process.env.HENRI_TEST_REPORT, JSON.stringify({ file, content: fs.readFileSync(file, 'utf8') }));`
    );

    edit([], seen);

    expect(JSON.parse(report().content).mail.auth.pass).toBe(SECRET);
  });

  test('show prints the values, --json prints the key paths only', () => {
    edit();

    const plain = run(['credentials:show', '--env', 'dev'], app);

    expect(plain.status).toBe(0);
    expect(JSON.parse(plain.stdout).mail.auth.pass).toBe(SECRET);

    const asJson = run(['credentials:show', '--env', 'dev', '--json'], app);
    const result = JSON.parse(asJson.stdout);

    expect(result).toEqual({
      command: 'show',
      env: 'dev',
      file: 'config/credentials/dev.json.enc',
      keys: ['secret', 'mail.auth.pass'],
    });
    expect(asJson.stdout).not.toContain(SECRET);
  });

  test('HENRI_CREDENTIALS_KEY opens the file without the key file', () => {
    edit();

    const key = fs
      .readFileSync(path.join(app, 'config', 'credentials', 'dev.key'), 'utf8')
      .trim();

    fs.rmSync(path.join(app, 'config', 'credentials', 'dev.key'));

    const { status, stdout } = henri(
      ['credentials:show', '--env', 'dev', '--json'],
      { cwd: app, env: { ...process.env, HENRI_CREDENTIALS_KEY: key } }
    );

    expect(status).toBe(0);
    expect(JSON.parse(stdout).keys).toContain('mail.auth.pass');
  });

  test('a missing key is a failure naming the file, not a new one', () => {
    edit();

    const key = path.join(app, 'config', 'credentials', 'dev.key');
    const before = fs.readFileSync(
      path.join(app, 'config', 'credentials', 'dev.json.enc'),
      'utf8'
    );

    fs.rmSync(key);

    const { status, stderr } = henri(
      ['credentials:edit', '--env', 'dev', '--json'],
      { cwd: app, env: { ...process.env, EDITOR: saves, VISUAL: '' } }
    );
    const { error } = JSON.parse(stderr);

    expect(status).toBe(1);
    expect(error.message).toContain('config/credentials/dev.key is missing');
    expect(error.hint).toContain('HENRI_CREDENTIALS_KEY');
    expect(fs.existsSync(key)).toBe(false);
    expect(
      fs.readFileSync(
        path.join(app, 'config', 'credentials', 'dev.json.enc'),
        'utf8'
      )
    ).toBe(before);
  });

  test('rotate re-encrypts under a new key and keeps the values', () => {
    edit();

    const keyFile = path.join(app, 'config', 'credentials', 'dev.key');
    const file = path.join(app, 'config', 'credentials', 'dev.json.enc');
    const before = {
      content: fs.readFileSync(file, 'utf8'),
      key: fs.readFileSync(keyFile, 'utf8').trim(),
    };

    const { status, stdout } = run(['credentials:rotate', '--env', 'dev'], app);

    expect(status).toBe(0);
    expect(stdout).toContain('Re-encrypted config/credentials/dev.json.enc');
    expect(stdout).toContain('Wrote the new key to config/credentials/dev.key');
    expect(stdout).not.toContain(SECRET);

    const after = {
      content: fs.readFileSync(file, 'utf8'),
      key: fs.readFileSync(keyFile, 'utf8').trim(),
    };

    expect(after.key).toMatch(/^[0-9a-f]{64}$/);
    expect(after.key).not.toBe(before.key);
    expect(after.content).not.toBe(before.content);
    expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);

    // The values survived, and the old key opens nothing
    const opened = run(['credentials:show', '--env', 'dev'], app);

    expect(JSON.parse(opened.stdout).mail.auth.pass).toBe(SECRET);

    fs.rmSync(keyFile);

    const stale = henri(['credentials:show', '--env', 'dev', '--json'], {
      cwd: app,
      env: { ...process.env, HENRI_CREDENTIALS_KEY: before.key },
    });

    expect(stale.status).toBe(1);
    expect(JSON.parse(stale.stderr).error.message).toContain(
      'could not be decrypted'
    );
  });

  test('rotate prints the new key when the environment held the old one', () => {
    edit();

    const keyFile = path.join(app, 'config', 'credentials', 'dev.key');
    const old = fs.readFileSync(keyFile, 'utf8').trim();

    fs.rmSync(keyFile);

    const { status, stdout } = henri(['credentials:rotate', '--env', 'dev'], {
      cwd: app,
      env: { ...process.env, HENRI_CREDENTIALS_KEY: old },
    });
    const printed = (stdout.match(/[0-9a-f]{64}/u) || [])[0];

    expect(status).toBe(0);
    expect(printed).toBeDefined();
    expect(printed).not.toBe(old);
    // A deployment that has no key file is not given one
    expect(fs.existsSync(keyFile)).toBe(false);

    const opened = henri(['credentials:show', '--env', 'dev'], {
      cwd: app,
      env: { ...process.env, HENRI_CREDENTIALS_KEY: printed },
    });

    expect(JSON.parse(opened.stdout).mail.auth.pass).toBe(SECRET);

    // --json never prints it
    const asJson = henri(['credentials:rotate', '--env', 'dev', '--json'], {
      cwd: app,
      env: { ...process.env, HENRI_CREDENTIALS_KEY: printed },
    });

    expect(asJson.stdout).not.toMatch(/[0-9a-f]{64}/u);
    expect(JSON.parse(asJson.stdout).command).toBe('rotate');
  });

  test('rotate needs the current key, and changes nothing without it', () => {
    edit();

    const file = path.join(app, 'config', 'credentials', 'dev.json.enc');
    const before = fs.readFileSync(file, 'utf8');

    fs.rmSync(path.join(app, 'config', 'credentials', 'dev.key'));

    const { status, stderr } = henri(
      ['credentials:rotate', '--env', 'dev', '--json'],
      {
        cwd: app,
        env: { ...process.env, HENRI_CREDENTIALS_KEY: 'ab'.repeat(32) },
      }
    );

    expect(status).toBe(1);
    expect(JSON.parse(stderr).error.message).toContain(
      'could not be decrypted'
    );
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  test('a wrong key says so without quoting anything', () => {
    edit();

    const { status, stderr } = henri(
      ['credentials:show', '--env', 'dev', '--json'],
      {
        cwd: app,
        env: { ...process.env, HENRI_CREDENTIALS_KEY: 'ab'.repeat(32) },
      }
    );
    const { error } = JSON.parse(stderr);

    expect(status).toBe(1);
    expect(error.message).toContain('could not be decrypted');
    expect(stderr).not.toContain(SECRET);
  });

  test('without an editor it says which variables to set', () => {
    const { status, stderr } = run(
      ['credentials:edit', '--env', 'dev', '--json'],
      app
    );
    const { error } = JSON.parse(stderr);

    expect(status).toBe(2);
    expect(error.code).toBe('USAGE');
    expect(error.message).toContain('EDITOR and VISUAL');
    expect(fs.existsSync(path.join(app, 'config', 'credentials'))).toBe(true);
  });

  test('an editor that fails leaves the credentials alone', () => {
    edit();

    const file = path.join(app, 'config', 'credentials', 'dev.json.enc');
    const before = fs.readFileSync(file, 'utf8');
    const angry = editor(dir, 'angry', 'process.exit(3);');
    const { status, stderr } = edit(['--json'], angry);

    expect(status).toBe(1);
    expect(JSON.parse(stderr).error.message).toContain('exited with 3');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  test('what is saved must be a JSON object', () => {
    edit();

    const file = path.join(app, 'config', 'credentials', 'dev.json.enc');
    const before = fs.readFileSync(file, 'utf8');
    const broken = editor(dir, 'broken', "fs.writeFileSync(file, '{ oops');");
    const { status, stderr } = edit(['--json'], broken);

    expect(status).toBe(1);
    expect(JSON.parse(stderr).error.message).toBe(
      'What you saved is not valid JSON'
    );
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  test('an unknown command prints the usage', () => {
    const { status, stderr } = run(['credentials:nope', '--json'], app);

    expect(status).toBe(2);
    expect(JSON.parse(stderr).error.message).toBe(
      'Unknown credentials command "nope"'
    );
  });
});

describe('henri doctor and the credentials keys', () => {
  let dir;
  let app;
  let key;

  beforeAll(() => {
    ({ app, dir } = scaffold(['--no-git']));
    key = path.join(app, 'config', 'credentials', 'dev.key');

    fs.mkdirSync(path.dirname(key), { recursive: true });
    fs.writeFileSync(key, `${'a'.repeat(64)}\n`, { mode: 0o600 });
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('the scaffold ignores them from the first commit', () => {
    expect(fs.readFileSync(path.join(app, '.gitignore'), 'utf8')).toMatch(
      /^config\/credentials\/\*\.key$/m
    );
    expect(check(app).problems.map((problem) => problem.check)).not.toContain(
      'credentials.ignored'
    );
  });

  test('reports a key that is not ignored', () => {
    const ignore = path.join(app, '.gitignore');
    const original = fs.readFileSync(ignore, 'utf8');

    fs.writeFileSync(ignore, original.replace(/^config\/credentials.*$/m, ''));

    const { problems } = check(app);

    fs.writeFileSync(ignore, original);

    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'credentials.ignored',
        file: '.gitignore',
        level: 'error',
      })
    );
  });

  test('reports a key that reached the index', () => {
    const git = (...args) =>
      execFileSync('git', args, { cwd: app, stdio: 'ignore' });

    git('init', '--quiet');
    git('config', 'user.email', 'doctor@usehenri.io');
    git('config', 'user.name', 'doctor');
    git('add', '--force', 'config/credentials/dev.key');

    const { ok, problems } = check(app);

    expect(ok).toBe(false);
    expect(problems).toContainEqual(
      expect.objectContaining({
        check: 'credentials.committed',
        file: 'config/credentials/dev.key',
        level: 'error',
      })
    );
    expect(
      problems.find((problem) => problem.check === 'credentials.committed').hint
    ).toContain('git rm --cached');
  });
});
