const fs = require('fs');
const path = require('path');

const { cleanup, henri, read, scaffold } = require('./helpers');

const FIXTURE = path.join(__dirname, 'fixtures', 'types-app');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const FILE = path.join('.henri', 'types.d.ts');

/** Removes what a run of the command left in the fixture */
const clean = () => {
  fs.rmSync(path.join(FIXTURE, '.henri'), { force: true, recursive: true });
};

describe('henri types', () => {
  afterEach(clean);

  test('writes .henri/types.d.ts without booting anything', () => {
    const { status, stdout } = henri(['types'], { cwd: FIXTURE });

    expect(status).toBe(0);
    expect(stdout).toContain(`${FILE} written`);
    expect(stdout).toContain('3 models');
    expect(stdout).toContain('16 path helpers');
    expect(fs.existsSync(path.join(FIXTURE, FILE))).toBe(true);
  });

  test('declares a global per model, with its columns', () => {
    henri(['types'], { cwd: FIXTURE });

    const source = fs.readFileSync(path.join(FIXTURE, FILE), 'utf8');

    expect(source).toContain('declare const Task: TaskModel;');
    expect(source).toContain('  title: string;');
    expect(source).toContain("  status: 'draft' | 'in_review' | 'live';");
    expect(source).toContain('  index_tasks_path: true;');
    expect(source).toMatch(/\/\/ henri:types 1 app=[0-9a-f]{12}\n$/u);
  });

  test('--stdout prints them instead of writing the file', () => {
    const { status, stdout } = henri(['types', '--stdout'], { cwd: FIXTURE });

    expect(status).toBe(0);
    expect(stdout).toContain('declare const Task: TaskModel;');
    expect(fs.existsSync(path.join(FIXTURE, FILE))).toBe(false);
  });

  test('--json says what it read and where it went', () => {
    const { status, stdout } = henri(['types', '--json'], { cwd: FIXTURE });
    const report = JSON.parse(stdout);

    expect(status).toBe(0);
    expect(report.file).toBe(FILE);
    expect(report.skipped).toEqual([]);
    expect(report.models.map(({ name }) => name)).toEqual([
      'Note',
      'Task',
      'User',
    ]);
    expect(report.paths.map(({ name }) => name)).toContain('show_tasks_path');
  });

  test('the declarations the type test compiles are these ones', () => {
    // `types/generated.d.ts` at the root of the repository is what
    // `pnpm test:types` runs `tsc` over, with `types/generated.test-d.ts`
    // next to it asserting -- through `@ts-expect-error` -- that a wrong
    // column, a wrong enum value and a misspelled path helper are all
    // errors. It is this command's output over this fixture, so it can
    // never describe a generator that no longer exists
    const { stdout } = henri(['types', '--stdout'], { cwd: FIXTURE });
    const committed = fs.readFileSync(
      path.join(ROOT, 'types', 'generated.d.ts'),
      'utf8'
    );

    expect(stdout).toBe(committed);
  });

  test('a model henri cannot read is named, and the rest are described', () => {
    const broken = path.join(FIXTURE, 'app', 'models', 'Broken.js');

    fs.writeFileSync(broken, 'module.exports = 42;\n');

    try {
      const { status, stdout } = henri(['types', '--json'], { cwd: FIXTURE });
      const report = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(report.models.map(({ name }) => name)).toContain('Task');
      expect(report.skipped).toEqual([
        { name: 'a model file', why: 'it is not an object' },
      ]);
    } finally {
      fs.rmSync(broken, { force: true });
    }
  });

  test('it refuses to run outside an application', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'henri-t-'));

    try {
      const { status, stderr } = henri(['types'], { cwd: dir });

      expect(status).toBe(3);
      expect(stderr).toContain('not an henri project');
    } finally {
      cleanup(dir);
    }
  });

  describe('in a scaffolded application', () => {
    let dir;
    let app;

    beforeAll(() => {
      ({ app, dir } = scaffold());
    });

    afterAll(() => {
      cleanup(dir);
    });

    test('the sample model and the sample routes are typed', () => {
      const { status } = henri(['types'], { cwd: app });

      expect(status).toBe(0);

      const source = read(app, FILE);

      expect(source).toContain('declare const Task: TaskModel;');
      expect(source).toContain('  index_tasks_path: true;');
    });

    test('jsconfig.json includes the file it writes', () => {
      const jsconfig = JSON.parse(read(app, 'jsconfig.json'));

      expect(jsconfig.include).toContain('.henri/types.d.ts');
      expect(jsconfig.exclude).not.toContain('.henri');
      // Errors stay opt-in: completion with nothing turned on
      expect(jsconfig.compilerOptions.checkJs).toBe(false);
    });

    test('.henri is gitignored, so nothing reaches a diff', () => {
      expect(read(app, '.gitignore')).toContain('/.henri');
    });
  });
});
