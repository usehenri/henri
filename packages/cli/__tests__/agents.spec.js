const fs = require('fs');
const path = require('path');

const { BUDGET, describe: factsOf, region } = require('../scripts/agents');
const { cleanup, henri, read, scaffold, tmpdir } = require('./helpers');

/**
 * Write a file inside an application, making the directories it needs
 *
 * @param {string} app The application directory
 * @param {string} file The relative path
 * @param {string} content What to write
 * @returns {void}
 */
const write = (app, file, content) => {
  fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
  fs.writeFileSync(path.join(app, file), content);
};

/**
 * The smallest thing this command will describe: a directory `isProject`
 * recognises, with a configuration, a routes file and a controller
 *
 * @param {object} [options] What to put in it
 * @returns {{app: string, dir: string}} The paths
 */
const application = ({
  config = { renderer: 'inertia', stores: { default: { adapter: 'drizzle' } } },
  models = {},
  packages = {},
  routes = "module.exports = { 'get /': 'main#home' };",
} = {}) => {
  const dir = tmpdir('henri-agents-');
  const app = path.join(dir, 'app');
  const ext = config.renderer === 'react' ? 'js' : 'jsx';

  fs.mkdirSync(app, { recursive: true });
  write(
    app,
    'package.json',
    JSON.stringify({ dependencies: packages, henri: true, name: 'sample' })
  );
  write(app, 'config/default.json', JSON.stringify(config));
  write(app, 'config/routes.js', routes);
  write(app, 'app/controllers/main.js', 'module.exports = { home: () => {} };');
  write(app, `app/views/pages/index.${ext}`, 'export default () => null;');

  for (const [name, source] of Object.entries(models)) {
    write(app, `app/models/${name}.js`, source);
  }

  return { app, dir };
};

/** The generated region of a file, markers included */
const generated = (source) =>
  source.slice(
    source.indexOf('<!-- henri:agents'),
    source.indexOf('<!-- /henri:agents -->')
  );

/** The `agents.stale` problems of a `henri doctor --json` run */
const stale = (app) =>
  JSON.parse(
    henri(['doctor', '--json', '--no-reach'], { cwd: app }).stdout
  ).problems.filter((one) => one.check === 'agents.stale');

describe('henri generate agents', () => {
  let dir;
  let app;

  beforeAll(() => {
    ({ app, dir } = scaffold(['--no-git']));
  });

  afterAll(() => {
    cleanup(dir);
  });

  /**
   * A copy of the scaffolded application, so a test that edits AGENTS.md
   * leaves the one every other test reads alone
   *
   * @returns {{app: string, dir: string}} The paths
   */
  const copy = () => {
    const where = tmpdir('henri-agents-copy-');

    fs.cpSync(app, path.join(where, 'app'), { recursive: true });

    return { app: path.join(where, 'app'), dir: where };
  };

  // --- the scaffold and the regeneration agree -------------------------------

  test('regenerating a scaffolded application rewrites the same bytes', () => {
    const { app: same, dir: elsewhere } = copy();

    try {
      const scaffolded = read(same, 'AGENTS.md');
      const { status, stdout } = henri(['generate', 'agents'], { cwd: same });

      expect(status).toBe(0);
      expect(stdout).toContain('updated AGENTS.md');
      // `henri new` and `henri generate agents` take one argument between
      // them -- the directory -- so there is no path where they could differ
      expect(read(same, 'AGENTS.md')).toBe(scaffolded);
    } finally {
      cleanup(elsewhere);
    }
  });

  test('the generated region stays inside its budget', () => {
    const lines = generated(read(app, 'AGENTS.md')).split('\n').length;

    expect(lines).toBeLessThanOrEqual(BUDGET);
    // And a fresh application is well under it: the budget is the ceiling
    // for an application with everything installed, not the target here
    expect(lines).toBeLessThan(120);
  });

  test('it describes the application rather than henri', () => {
    const agents = read(app, 'AGENTS.md');

    expect(agents).toContain('renderer `inertia`, store `drizzle` (sqlite)');
    expect(agents).toContain('Here: `Task`.');
    expect(agents).toContain('`main`, `tasks`');
    expect(agents).toContain('`/tasks` -> `tasks` (index, create, update');
    expect(agents).toContain(
      '`app/controllers/tasks.js` is the worked example'
    );
  });

  // --- a developer's own text ------------------------------------------------

  test('regenerating keeps the text a developer wrote around it', () => {
    const { app: mine, dir: elsewhere } = copy();
    const before = '# Our own notes\n\nRead this first.\n\n';
    const after = '\n## House rules\n\nRun `make check` before a commit.\n';

    try {
      write(mine, 'AGENTS.md', before + read(mine, 'AGENTS.md') + after);
      write(mine, 'app/models/Note.js', 'module.exports = { schema: {} };');

      const { status } = henri(['generate', 'agents'], { cwd: mine });
      const rewritten = read(mine, 'AGENTS.md');

      expect(status).toBe(0);
      expect(rewritten.startsWith(before)).toBe(true);
      expect(rewritten.endsWith(after)).toBe(true);
      // And the region itself caught up with the application
      expect(rewritten).toContain('`Note`');
    } finally {
      cleanup(elsewhere);
    }
  });

  test('a generated section edited by hand is not rewritten', () => {
    const { app: mine, dir: elsewhere } = copy();

    try {
      const edited = read(mine, 'AGENTS.md').replace(
        '## Policies',
        '## Policies (we are strict about these)'
      );

      write(mine, 'AGENTS.md', edited);

      const { status, stdout } = henri(['generate', 'agents'], { cwd: mine });

      expect(status).toBe(0);
      expect(stdout).toContain('skipped AGENTS.md: the generated section was');
      expect(read(mine, 'AGENTS.md')).toBe(edited);

      // --force is the only way past it
      expect(
        henri(['generate', 'agents', '--force'], { cwd: mine }).status
      ).toBe(0);
      expect(read(mine, 'AGENTS.md')).not.toContain('we are strict');
    } finally {
      cleanup(elsewhere);
    }
  });

  test('an AGENTS.md henri did not write is left alone', () => {
    const { app: own, dir: elsewhere } = application();
    const mine = '# Mine\n\nNothing henri wrote.\n';

    try {
      write(own, 'AGENTS.md', mine);

      const { status, stdout } = henri(['generate', 'agents'], { cwd: own });

      expect(status).toBe(0);
      expect(stdout).toContain(
        'skipped AGENTS.md: it has no generated section'
      );
      expect(read(own, 'AGENTS.md')).toBe(mine);

      henri(['generate', 'agents', '--force'], { cwd: own });
      expect(read(own, 'AGENTS.md')).toContain('<!-- henri:agents');
    } finally {
      cleanup(elsewhere);
    }
  });

  test('a missing AGENTS.md is written whole', () => {
    const { app: fresh, dir: elsewhere } = application();

    try {
      const { status, stdout } = henri(['generate', 'agents', '--json'], {
        cwd: fresh,
      });

      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        created: ['AGENTS.md', 'CLAUDE.md', '.mcp.json'],
        generator: 'agents',
        skipped: [],
      });
      expect(read(fresh, 'AGENTS.md')).toContain('<!-- /henri:agents -->');
    } finally {
      cleanup(elsewhere);
    }
  });

  // --- nothing about a package the application does not have ------------------

  test('an application with no jobs has no queue paragraph', () => {
    const { app: plain, dir: elsewhere } = application();

    try {
      const agents = region(factsOf(plain));

      expect(agents).not.toContain('## Jobs');
      expect(agents).not.toContain('henri.jobs.perform');
      expect(agents).not.toContain('dead letter queue');
      expect(agents).not.toContain('app/jobs/');
      expect(agents).not.toContain('henri jobs');
      // And it says so, which is the line that stops an agent reaching for
      // an API this application does not have
      expect(agents).toContain(
        'Do not import what this application does not have: no graphql, jobs, redis, uploads, webhooks'
      );
    } finally {
      cleanup(elsewhere);
    }
  });

  test('installing the queue is what earns the queue paragraph', () => {
    const { app: queued, dir: elsewhere } = application({
      packages: { '@usehenri/jobs': '^1.1.0' },
    });

    try {
      write(queued, 'app/jobs/welcome.js', 'module.exports = { perform: 1 };');

      const agents = region(factsOf(queued));

      expect(agents).toContain('## Jobs (`@usehenri/jobs`)');
      expect(agents).toContain('henri.jobs.perform');
      expect(agents).toContain('Here: `welcome`.');
      expect(agents).toContain('`henri jobs [--once] [--queue=]`');
      expect(agents).toContain('no graphql, redis, uploads, webhooks');
    } finally {
      cleanup(elsewhere);
    }
  });

  test('only the renderer of the application is described', () => {
    const { app: next, dir: elsewhere } = application({
      config: { renderer: 'react', stores: { default: { adapter: 'disk' } } },
    });

    try {
      const agents = region(factsOf(next));

      expect(agents).toContain('renderer `react`, store `disk`');
      expect(agents).toContain('next.js pages (`.js`)');
      expect(agents).toContain('withHenri');
      expect(agents).not.toContain('Inertia');
      expect(agents).not.toContain('import.meta.glob');
      // The disk store is mongoose, so the model API and the schema
      // sentence follow it and not the SQL one
      expect(agents).toContain('doc.deleteOne()');
      expect(agents).not.toContain('henri db:generate');
    } finally {
      cleanup(elsewhere);
    }
  });

  // --- what the models say about themselves ----------------------------------

  test('the marks of the models are read out of their files', () => {
    const { app: marked, dir: elsewhere } = application({
      models: {
        Session: [
          'module.exports = {',
          '  options: {',
          '    paranoid: true,',
          '    retention: { action: "delete", after: "90d" },',
          '  },',
          '  schema: { at: { type: "date" } },',
          '};',
        ].join('\n'),
        User: [
          'module.exports = {',
          '  schema: {',
          '    email: { personal: true, type: "string" },',
          '    ssn: { encrypted: { deterministic: true }, type: "string" },',
          '    title: { type: "string" },',
          '  },',
          '};',
        ].join('\n'),
      },
    });

    try {
      const agents = region(factsOf(marked));

      expect(agents).toContain('`Session` carries paranoid (soft deletes)');
      expect(agents).toContain('a retention rule');
      expect(agents).toContain('`User` carries personal: `email`');
      expect(agents).toContain('encrypted: `ssn`');
      expect(agents).not.toContain('`title`');
      // And the commands those marks make available, and no others
      expect(agents).toContain('henri privacy[:export');
      expect(agents).toContain('henri encryption:rotate');
      expect(agents).toContain('henri retention[:sweep]');
    } finally {
      cleanup(elsewhere);
    }
  });

  test('a model nothing can be read from costs no false claim', () => {
    const { app: odd, dir: elsewhere } = application({
      models: { Built: 'module.exports = buildTheSchemaAtRuntime();' },
    });

    try {
      const agents = region(factsOf(odd));

      expect(agents).toContain('Here: `Built`.');
      expect(agents).not.toContain('Marks this application already made');
    } finally {
      cleanup(elsewhere);
    }
  });

  // --- doctor ----------------------------------------------------------------

  test('henri doctor reports a file the application has outgrown', () => {
    const { app: drifting, dir: elsewhere } = application();

    try {
      henri(['generate', 'agents'], { cwd: drifting });
      expect(stale(drifting)).toEqual([]);

      write(drifting, 'app/models/Post.js', 'module.exports = { schema: {} };');

      expect(stale(drifting)).toHaveLength(1);
      expect(stale(drifting)[0].message).toContain(
        'the application has changed'
      );

      henri(['generate', 'agents'], { cwd: drifting });
      expect(stale(drifting)).toEqual([]);
    } finally {
      cleanup(elsewhere);
    }
  });

  test('a hand-written AGENTS.md is still checked on what it claims', () => {
    const { app: own, dir: elsewhere } = application();

    try {
      write(
        own,
        'AGENTS.md',
        '# Mine\n\nA henri application, renderer `react`, store `drizzle`.\n'
      );

      expect(stale(own)).toHaveLength(1);
      expect(stale(own)[0].message).toContain('the renderer is "inertia"');
    } finally {
      cleanup(elsewhere);
    }
  });
});
