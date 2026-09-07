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
// What `resourceOf()` in packages/cli/scripts/generate.js hands a template:
// the fields the command line named, annotated with what the model file
// says about each of them
const context = {
  doc: 'Post',
  fields: [
    { enum: null, name: 'title', required: true },
    { enum: null, name: 'body', required: false },
  ],
  hasEnums: false,
  // What a url of one record carries: `externalId`, or the `slug` of a
  // model that declared one (see base/slug.js)
  identifier: 'externalId',
  lower: 'post',
  plural: 'posts',
};

/** The same resource with an enum column, which is a <Select> */
const withEnum = {
  ...context,
  fields: [
    ...context.fields,
    { enum: ['draft', 'live'], name: 'status', required: false },
  ],
  hasEnums: true,
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
    expect(code).not.toMatch(
      /\{\{\s*(doc|lower|plural|this|fields|name|enum|hasEnums|#|\/)/
    );
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

  test('the form renders an input per field, required where it is', () => {
    const { code } = compile('_form');

    expect(code).toContain('name="title"');
    expect(code).toContain('name="body"');
    expect(code).toContain('const PostForm');
    expect(code).toContain('<FormError');
    // The model says which: `title` is required and `body` is not
    expect(code).toMatch(/name="title"[^>]+required/);
    expect(code).not.toMatch(/name="body"[^>]+required/);
    expect(code).not.toContain('<Select');
  });

  test('an enum column is a Select of the list the controller sends', () => {
    const { ast, code } = compile('_form', withEnum);

    expect(ast.program.body.length).toBeGreaterThan(1);
    expect(code).toContain(
      "import { Button, Form, FormError, Input, Select } from '@usehenri/react/forms'"
    );
    expect(code).toMatch(/<Select[^>]+choices=\{enums\.status \|\| \[\]\}/);
    // The values themselves are never written into the page
    expect(code).not.toContain('draft');
    expect(compile('new', withEnum).code).toContain('enums={enums}');
    expect(compile('edit', withEnum).code).toContain('enums={enums}');
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

  test('templates survive several fields and none', () => {
    expect(
      () => compile('index', { ...context, fields: [] }).ast
    ).not.toThrow();
    expect(() =>
      compile('_form', {
        ...context,
        fields: ['a', 'b', 'c', 'd'].map((name) => ({ name })),
      })
    ).not.toThrow();
  });

  test('a model with a slug links with the slug and never the uuid', () => {
    const slugged = { ...context, identifier: 'slug' };

    for (const view of ['index', 'show', 'edit']) {
      const { code } = compile(view, slugged);

      expect(code).toContain('item.slug');
      expect(code).not.toContain('externalId');
      expect(() => compile(view, slugged).ast).not.toThrow();
    }
  });
});
