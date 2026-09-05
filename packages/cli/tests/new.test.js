const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { version } = require('../package.json');
const bin = path.resolve(__dirname, '../../henri/bin/henri.js');

describe('henri new', () => {
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-new-'));
    const result = spawnSync(
      process.execPath,
      [bin, 'new', 'app', '--skip-install'],
      {
        cwd: dir,
        encoding: 'utf8',
      }
    );

    if (result.status !== 0) {
      throw new Error(`henri new failed: ${result.stdout}${result.stderr}`);
    }
  });

  afterAll(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('scaffolds the app structure', () => {
    for (const file of [
      'package.json',
      'pnpm-workspace.yaml',
      'config/default.json',
      'config/routes.js',
      'app/views/pages/index.js',
      'app/views/next.config.js',
      'eslint.config.js',
    ]) {
      expect(fs.existsSync(path.join(dir, 'app', file))).toBe(true);
    }
  });

  test('depends on the @usehenri packages at the cli version', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, 'app/package.json'), 'utf8')
    );
    const internal = Object.entries(pkg.dependencies).filter(([name]) =>
      name.startsWith('@usehenri/')
    );

    expect(internal.length).toBeGreaterThan(0);
    for (const [, range] of internal) {
      expect(range).toBe(`^${version}`);
    }
    expect(pkg.henri).toBe(version);
  });
});
