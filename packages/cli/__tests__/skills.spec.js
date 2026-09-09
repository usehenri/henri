const fs = require('fs');
const path = require('path');

const {
  BUDGET,
  DESCRIPTION,
  LAYOUTS,
  SKILLS,
  plan,
  skillFiles,
  skillsFor,
  writeSkillFiles,
} = require('../scripts/skills');
const { cleanup, henri, tmpdir } = require('./helpers');

const FIXTURE = path.join(__dirname, 'fixtures', 'skills-app');

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
 * The smallest thing this command will describe
 *
 * @param {object} [options] What to put in it
 * @returns {{app: string, dir: string}} The paths
 */
const application = ({
  config = { renderer: 'inertia', stores: { default: { adapter: 'drizzle' } } },
  packages = {},
} = {}) => {
  const dir = tmpdir('henri-skills-');
  const app = path.join(dir, 'app');

  fs.mkdirSync(app, { recursive: true });
  write(
    app,
    'package.json',
    JSON.stringify({ dependencies: packages, henri: true, name: 'sample' })
  );
  write(app, 'config/default.json', JSON.stringify(config));
  write(app, 'config/routes.js', "module.exports = { 'get /': 'main#home' };");
  write(app, 'app/controllers/main.js', 'module.exports = { home: () => {} };');
  // `isProject` looks for this, so the command runs at all
  write(app, 'app/views/pages/index.jsx', 'export default () => null;');

  return { app, dir };
};

/** The frontmatter of a skill, parsed the way Claude Code parses it */
const frontmatterOf = (source) => {
  if (!source.startsWith('---\n')) {
    return null;
  }

  const end = source.indexOf('\n---\n', 3);

  if (end === -1) {
    return null;
  }

  const fields = {};

  for (const line of source.slice(4, end).split('\n')) {
    const match = /^([a-z-]+):\s*(.*)$/u.exec(line);

    if (match) {
      fields[match[1]] = match[2].startsWith('"')
        ? JSON.parse(match[2])
        : match[2];
    }
  }

  return { body: source.slice(end + 5), fields };
};

/** Read one generated skill of the fixture */
const fixture = (name) =>
  fs.readFileSync(
    path.join(FIXTURE, '.claude', 'skills', name, 'SKILL.md'),
    'utf8'
  );

describe('henri generate skills', () => {
  test('writes one SKILL.md per procedure, where Claude Code looks', () => {
    const { app, dir } = application();

    try {
      const { created } = writeSkillFiles(app);

      expect(created).toEqual(
        SKILLS.map(({ name }) =>
          path.join('.claude', 'skills', name, 'SKILL.md')
        )
      );

      for (const { name } of SKILLS) {
        expect(
          fs.existsSync(path.join(app, '.claude', 'skills', name, 'SKILL.md'))
        ).toBe(true);
      }
    } finally {
      cleanup(dir);
    }
  });

  test('the frontmatter opens the first line, and its name is the directory', () => {
    // Claude Code reads the whole file as body when `---` is not the very
    // first thing in it, so the generated region has to start below the
    // frontmatter rather than above it
    const { app, dir } = application();

    try {
      writeSkillFiles(app);

      for (const { name } of SKILLS) {
        const source = fs.readFileSync(
          path.join(app, '.claude', 'skills', name, 'SKILL.md'),
          'utf8'
        );
        const parsed = frontmatterOf(source);

        expect(parsed).not.toBeNull();
        expect(parsed.fields.name).toBe(name);
        expect(parsed.fields.description.length).toBeGreaterThan(0);
      }
    } finally {
      cleanup(dir);
    }
  });

  test('a description carrying a colon is still valid YAML', () => {
    // Every description below says what the skill is *for* after a colon,
    // which unquoted would end the key. They are written as JSON strings,
    // which are valid double-quoted YAML scalars
    // Filtered rather than skipped inside the loop, so this fails if the
    // colon ever stops being exercised instead of quietly passing on none
    const carry = SKILLS.filter((skill) => skill.description.includes(': '));

    expect(carry.length).toBeGreaterThan(0);

    for (const skill of carry) {
      const line = LAYOUTS.claude.prefix(skill);

      expect(line).toContain(`description: "`);
      expect(JSON.parse(/description: (".*")\n/u.exec(line)[1])).toBe(
        skill.description
      );
    }
  });

  test('a description stays inside its budget, because it is always loaded', () => {
    for (const skill of SKILLS) {
      expect(skill.description.length).toBeLessThanOrEqual(DESCRIPTION);
    }
  });

  test('a body stays inside its budget, because a manual is not a procedure', () => {
    const { app, dir } = application();

    try {
      for (const skill of skillsFor(
        require('../scripts/agents').describe(app)
      )) {
        expect(skill.rendered.split('\n').length).toBeLessThanOrEqual(BUDGET);
      }
    } finally {
      cleanup(dir);
    }
  });

  test('no skill restates a guide: each one points at the documentation', () => {
    // The rule that keeps a skill from becoming a second, rotting copy of a
    // page `henri docs` already serves at the installed version
    const { app, dir } = application();

    try {
      const bodies = skillsFor(require('../scripts/agents').describe(app));

      for (const skill of bodies) {
        expect(skill.rendered).toMatch(/henri docs|`guide`|guides\//u);
      }
    } finally {
      cleanup(dir);
    }
  });

  describe('the facts it derives', () => {
    test('a drizzle store gets the migration commands it really has', () => {
      const { app, dir } = application({
        config: { stores: { default: { adapter: 'drizzle' } } },
      });

      try {
        const [model] = skillsFor(require('../scripts/agents').describe(app));

        expect(model.rendered).toContain('henri db:generate');
        expect(model.rendered).toContain('henri db:migrate');
        expect(model.rendered).not.toContain('sequelize.sync()');
      } finally {
        cleanup(dir);
      }
    });

    test('a mongoose store is told there is no migration, and what that costs', () => {
      const { app, dir } = application({
        config: { stores: { default: { adapter: 'mongoose' } } },
      });

      try {
        const [model] = skillsFor(require('../scripts/agents').describe(app));

        expect(model.rendered).not.toContain('henri db:generate');
        expect(model.rendered).toContain('MongoDB takes the documents');
      } finally {
        cleanup(dir);
      }
    });

    test('an mssql store is told it has no migrations at all', () => {
      const { app, dir } = application({
        config: { stores: { default: { adapter: 'mssql' } } },
      });

      try {
        const [model] = skillsFor(require('../scripts/agents').describe(app));

        expect(model.rendered).not.toContain('henri db:generate');
        expect(model.rendered).toContain('sequelize.sync()');
        expect(model.rendered).toContain('henri db:status --sql');
      } finally {
        cleanup(dir);
      }
    });

    test('tenancy adds the decision a multi-tenant model has to make', () => {
      const on = application({
        config: {
          stores: { default: { adapter: 'drizzle' } },
          tenancy: { from: { user: 'accountId' } },
        },
      });
      const off = application();

      try {
        const [withTenancy] = skillsFor(
          require('../scripts/agents').describe(on.app)
        );
        const [without] = skillsFor(
          require('../scripts/agents').describe(off.app)
        );

        expect(withTenancy.rendered).toContain('HENRI_TENANT_REQUIRED');
        expect(without.rendered).not.toContain('HENRI_TENANT_REQUIRED');
      } finally {
        cleanup(on.dir);
        cleanup(off.dir);
      }
    });

    test('an application without the MCP server is not told to ask its tools', () => {
      const { app, dir } = application();

      try {
        const skills = skillsFor(require('../scripts/agents').describe(app));
        const drive = skills.find(({ name }) => name === 'henri-drive-the-app');

        expect(drive.rendered).toContain('does **not** have `@usehenri/mcp`');
        expect(drive.rendered).toContain('henri routes --json');
      } finally {
        cleanup(dir);
      }
    });

    test('an application with it is pointed at the tools by name', () => {
      const { app, dir } = application({
        packages: { '@usehenri/mcp': '^1.0.0' },
      });

      try {
        const skills = skillsFor(require('../scripts/agents').describe(app));
        const drive = skills.find(({ name }) => name === 'henri-drive-the-app');

        expect(drive.rendered).not.toContain('does **not** have');
        expect(drive.rendered).toContain('runtime_routes');
        expect(drive.rendered).toContain('refuse a production application');
      } finally {
        cleanup(dir);
      }
    });
  });

  describe('regenerating', () => {
    test('is byte identical, so nothing churns', () => {
      const { app, dir } = application();

      try {
        writeSkillFiles(app);

        const first = fixtureLike(app);

        writeSkillFiles(app);

        expect(fixtureLike(app)).toEqual(first);
      } finally {
        cleanup(dir);
      }
    });

    test('keeps what a person wrote outside the markers', () => {
      const { app, dir } = application();
      const file = path.join(
        app,
        '.claude',
        'skills',
        'henri-add-a-model',
        'SKILL.md'
      );

      try {
        writeSkillFiles(app);
        fs.appendFileSync(file, '\n## Our own step\n\nRun the linter twice.\n');
        writeSkillFiles(app);

        expect(fs.readFileSync(file, 'utf8')).toContain(
          'Run the linter twice.'
        );
      } finally {
        cleanup(dir);
      }
    });

    test('keeps a description the team retuned, because it is above the region', () => {
      // The `description` is what decides when a skill loads. It is written
      // once and then never rewritten, which is the point of putting the
      // frontmatter outside the generated region
      const { app, dir } = application();
      const file = path.join(
        app,
        '.claude',
        'skills',
        'henri-add-a-model',
        'SKILL.md'
      );

      try {
        writeSkillFiles(app);
        fs.writeFileSync(
          file,
          fs
            .readFileSync(file, 'utf8')
            .replace(/^description: .*$/mu, 'description: "Ours, thanks"')
        );
        writeSkillFiles(app);

        const source = fs.readFileSync(file, 'utf8');

        expect(frontmatterOf(source).fields.description).toBe('Ours, thanks');
        expect(source).toContain('## 5. Migrate');
      } finally {
        cleanup(dir);
      }
    });

    test('refuses a region edited by hand, and says so', () => {
      const { app, dir } = application();
      const file = path.join(
        app,
        '.claude',
        'skills',
        'henri-add-a-model',
        'SKILL.md'
      );

      try {
        writeSkillFiles(app);
        fs.writeFileSync(
          file,
          fs.readFileSync(file, 'utf8').replace('## 5. Migrate', '## 5. Nope')
        );

        const { skipped, updated } = writeSkillFiles(app);

        expect(updated).not.toContain(
          path.join('.claude', 'skills', 'henri-add-a-model', 'SKILL.md')
        );
        expect(skipped[0].reason).toContain('edited by hand');
        expect(fs.readFileSync(file, 'utf8')).toContain('## 5. Nope');
      } finally {
        cleanup(dir);
      }
    });

    test('--force takes a hand-edited region back', () => {
      const { app, dir } = application();
      const file = path.join(
        app,
        '.claude',
        'skills',
        'henri-add-a-model',
        'SKILL.md'
      );

      try {
        writeSkillFiles(app);
        fs.writeFileSync(
          file,
          fs.readFileSync(file, 'utf8').replace('## 5. Migrate', '## 5. Nope')
        );
        writeSkillFiles(app, { force: true });

        expect(fs.readFileSync(file, 'utf8')).toContain('## 5. Migrate');
      } finally {
        cleanup(dir);
      }
    });

    test("a file with no markers is somebody's own skill and is left alone", () => {
      const { app, dir } = application();
      const file = path.join(
        app,
        '.claude',
        'skills',
        'henri-add-a-model',
        'SKILL.md'
      );

      try {
        write(
          app,
          path.join('.claude', 'skills', 'henri-add-a-model', 'SKILL.md'),
          '---\nname: henri-add-a-model\ndescription: mine\n---\n\nMine.\n'
        );

        const { skipped } = writeSkillFiles(app);

        expect(skipped[0].reason).toContain("somebody's own");
        expect(fs.readFileSync(file, 'utf8')).toContain('Mine.');
      } finally {
        cleanup(dir);
      }
    });

    test('plan() answers what a run would do and writes nothing', () => {
      // `henri doctor` asks this, and a check that wrote would be a bug
      const { app, dir } = application();

      try {
        const planned = plan(app);

        expect(planned.every(({ action }) => action === 'created')).toBe(true);
        expect(fs.existsSync(path.join(app, '.claude'))).toBe(false);
      } finally {
        cleanup(dir);
      }
    });
  });

  describe('the command', () => {
    test('writes them, and --json says what it wrote', () => {
      const { app, dir } = application();

      try {
        const { status, stdout } = henri(['generate', 'skills', '--json'], {
          cwd: app,
        });
        const report = JSON.parse(stdout);

        expect(status).toBe(0);
        expect(report.created).toHaveLength(SKILLS.length);
      } finally {
        cleanup(dir);
      }
    });

    test('refuses a layout it does not have', () => {
      const { app, dir } = application();

      try {
        const { status, stderr } = henri(
          ['generate', 'skills', '--for', 'emacs'],
          { cwd: app }
        );

        expect(status).toBe(2);
        expect(stderr).toContain('Unknown skill layout');
      } finally {
        cleanup(dir);
      }
    });
  });

  test('the skills checked into the fixture are the ones it writes now', () => {
    // `packages/cli/__tests__/fixtures/skills-app` and the files under its
    // `.claude/` are this command's own output, committed, so a change to a
    // procedure has to be a change somebody read. It is the rule
    // `types/generated.d.ts` already follows
    const before = skillFiles().map(({ file }) =>
      fs.readFileSync(path.join(FIXTURE, file), 'utf8')
    );

    henri(['generate', 'skills', '--force'], { cwd: FIXTURE });

    const after = skillFiles().map(({ file }) =>
      fs.readFileSync(path.join(FIXTURE, file), 'utf8')
    );

    expect(after).toEqual(before);
  });

  test('the fixture is the application the skills describe', () => {
    // A drizzle store on sqlite, inertia, tenancy on and the MCP server
    // installed: the branches that would otherwise only be asserted above
    const source = fixture('henri-add-a-model');

    expect(source).toContain('henri db:generate');
    expect(source).toContain('HENRI_TENANT_REQUIRED');
    expect(fixture('henri-drive-the-app')).toContain('runtime_routes');
  });
});

/**
 * Every generated skill of an application, as one comparable value
 *
 * @param {string} app The application directory
 * @returns {object} The files by name
 */
function fixtureLike(app) {
  return Object.fromEntries(
    skillFiles().map(({ file, name }) => [
      name,
      fs.readFileSync(path.join(app, file), 'utf8'),
    ])
  );
}
