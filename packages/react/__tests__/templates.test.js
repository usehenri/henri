/**
 * The react scaffold templates of the cli (`henri g scaffold`), filled the
 * way `packages/cli/scripts/generate.js` fills them, must be valid JSX.
 */
const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');
const { parse } = require('@babel/parser');

const dir = path.resolve(__dirname, '../../cli/scripts/generate');
const views = ['_form', 'index', 'new', 'edit', 'show'];
const context = {
  doc: 'Post',
  keys: ['title', 'body'],
  lower: 'post',
  plural: 'posts',
};

/**
 * Fill a template and parse it as an ES module with JSX
 *
 * @param {string} view the view name
 * @param {object} [values] the template context
 * @returns {{ ast: object, code: string }} the parsed code
 */
function compile(view, values = context) {
  const source = fs.readFileSync(path.join(dir, `react-${view}.hbs`), 'utf8');
  const code = handlebars.compile(source)(values);
  const ast = parse(code, { plugins: ['jsx'], sourceType: 'module' });

  return { ast, code };
}

describe('react scaffold templates', () => {
  test.each(views)('react-%s.hbs parses as JSX', (view) => {
    const { ast, code } = compile(view);

    expect(ast.program.body.length).toBeGreaterThan(1);
    expect(code).not.toMatch(/\{\{\s*(doc|lower|plural|this|keys|#|\/)/);
    expect(code).not.toContain('_scaffold');
  });

  test('every page is wrapped with withHenri and exports a default', () => {
    for (const view of views.filter((name) => name !== '_form')) {
      const { ast, code } = compile(view);
      const exported = ast.program.body.find(
        (node) => node.type === 'ExportDefaultDeclaration'
      );

      expect(code).toContain("import withHenri from '@usehenri/react'");
      expect(exported.declaration.callee.name).toBe('withHenri');
    }
  });

  test('the pages use the plural path helpers, never hardcoded urls', () => {
    const helpers = {
      edit: ['update_posts_path', 'show_posts_path', 'index_posts_path'],
      index: [
        'destroy_posts_path',
        'show_posts_path',
        'edit_posts_path',
        'new_posts_path',
      ],
      new: ['create_posts_path', 'index_posts_path'],
      show: ['edit_posts_path', 'index_posts_path'],
    };

    for (const [view, names] of Object.entries(helpers)) {
      const { code } = compile(view);

      for (const name of names) {
        expect(code).toContain(name);
      }
      expect(code).not.toMatch(/href="\//);
    }
  });

  test('the index lists every key with valid table markup', () => {
    const { code } = compile('index');

    expect(code).toMatch(/<th[^>]*>title<\/th>/);
    expect(code).toMatch(/<th[^>]*>body<\/th>/);
    expect(code).toContain("String(item.title ?? '')");
    // One "Actions" column follows the keys
    expect(code).toMatch(/colSpan=\{\s*2 \+ 1\s*\}/);
    expect(code).not.toContain('<td><td>');
    expect(code).toContain('posts.length === 0');
  });

  test('show and edit guard against a missing record', () => {
    for (const view of ['show', 'edit']) {
      const { code } = compile(view);

      expect(code).toContain('post = null');
      expect(code).toContain('Post not found');
      expect(code).not.toContain('[0]._id');
    }
  });

  test('the form renders an input per key', () => {
    const { code } = compile('_form');

    expect(code).toContain('name="title"');
    expect(code).toContain('name="body"');
    expect(code).toContain('const PostForm');
    expect(code).toContain('<FormError');
  });

  test('the pages are styled with tailwind, dark mode included', () => {
    for (const view of views) {
      const { code } = compile(view);

      expect(code).toMatch(/className=/);
      expect(code).toMatch(/dark:[a-z]/);
      // No tailwind config file to look for: the theme is the stylesheet
      expect(code).not.toContain('tailwind.config');
    }
  });

  test('templates survive names with several keys and none', () => {
    expect(() => compile('index', { ...context, keys: [] }).ast).not.toThrow();
    expect(() =>
      compile('_form', { ...context, keys: ['a', 'b', 'c', 'd'] })
    ).not.toThrow();
  });
});
