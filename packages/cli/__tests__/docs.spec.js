const fs = require('fs');
const path = require('path');

const { cleanup, henri, tmpdir } = require('./helpers');
const docs = require('../scripts/docs');

/**
 * An application whose node_modules holds a documentation copy of its own,
 * which is what an installed `@usehenri/core` looks like from here
 *
 * @param {string} version the version that package.json declares
 * @returns {string} the application directory
 */
const application = (version) => {
  const dir = tmpdir('henri-docs-');
  const pkg = path.join(dir, 'node_modules', '@usehenri', 'core');

  fs.mkdirSync(path.join(pkg, 'docs', 'guides'), { recursive: true });
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({ main: 'index.js', name: '@usehenri/core', version })
  );
  fs.writeFileSync(path.join(pkg, 'index.js'), 'module.exports = {};');
  fs.writeFileSync(
    path.join(pkg, 'docs', 'guides', 'routes.md'),
    '---\ntitle: Routes\ndescription: What this version says.\n---\n\nThe routes of the installed version.\n'
  );

  return dir;
};

describe('henri docs', () => {
  let dir;

  beforeAll(() => {
    dir = tmpdir('henri-docs-repo-');
  });

  afterAll(() => {
    cleanup(dir);
  });

  test('lists every page with what it covers', () => {
    const { status, stdout } = henri(['docs'], { cwd: dir });

    expect(status).toBe(0);
    expect(stdout).toContain('guides/routes');
    expect(stdout).toContain('configuration');
    expect(stdout).toContain('henri docs <page>');
  });

  test('prints one page as markdown, with where it is published', () => {
    const { status, stdout } = henri(['docs', 'guides/routes'], { cwd: dir });

    expect(status).toBe(0);
    expect(stdout).toContain('https://usehenri.io/guides/routes/');
    expect(stdout).toContain('config/routes.js');
    // The frontmatter is not part of the page
    expect(stdout).not.toContain('sidebar:');
  });

  test('--json answers the page and where it was read from', () => {
    const { status, stdout } = henri(['docs', 'configuration', '--json'], {
      cwd: dir,
    });
    const answer = JSON.parse(stdout);

    expect(status).toBe(0);
    expect(answer.slug).toBe('configuration');
    expect(answer.title).toBe('Configuration');
    expect(answer.url).toBe('https://usehenri.io/configuration/');
    expect(answer.text).toContain('config/');
    expect(answer.source.dir).toBeTruthy();
  });

  test('--json without a page answers the index', () => {
    const { status, stdout } = henri(['docs', '--json'], { cwd: dir });
    const answer = JSON.parse(stdout);

    expect(status).toBe(0);
    expect(answer.count).toBeGreaterThan(10);
    expect(answer.pages.map((page) => page.slug)).toContain('guides/agents');
  });

  test('an unknown page exits 1, with the near miss', () => {
    const { status, stderr } = henri(['docs', 'guides/route'], { cwd: dir });

    expect(status).toBe(1);
    expect(stderr).toContain('HENRI_AGENT_UNKNOWN_PAGE');
    expect(stderr).toContain('guides/routes');
  });

  test('a page that leaves the directory is not a page', () => {
    for (const slug of ['../../../etc/passwd', '/etc/passwd', 'guides/../..']) {
      expect(docs.page(slug, dir)).toBe(null);
    }
  });

  describe('where the pages come from', () => {
    let app;

    beforeAll(() => {
      app = application('9.9.9');
    });

    afterAll(() => {
      cleanup(app);
    });

    test('the copy installed in the application wins', () => {
      const found = docs.index(app);

      expect(found.source.package).toBe('@usehenri/core');
      expect(found.source.version).toBe('9.9.9');
      expect(found.pages).toEqual([
        {
          description: 'What this version says.',
          slug: 'guides/routes',
          title: 'Routes',
        },
      ]);

      expect(docs.page('guides/routes', app).text).toContain(
        'the installed version'
      );
    });

    test('and the command reads it, version and all', () => {
      const { status, stdout } = henri(['docs'], { cwd: app });

      expect(status).toBe(0);
      expect(stdout).toContain('@usehenri/core@9.9.9');
      expect(stdout).toContain('guides/routes');
    });

    // Which of the two answers here depends on whether a publish (or
    // scripts/smoke.sh) has left a copy in packages/core: both are the
    // pages of this checkout, so what is asserted is the pages
    test('without one, the pages of this checkout answer', () => {
      const found = docs.index(dir);

      expect(found.pages.length).toBeGreaterThan(10);
      expect(found.pages.map((page) => page.slug)).toContain('guides/routes');
      expect(fs.existsSync(path.join(found.source.dir, 'guides'))).toBe(true);
    });
  });
});
