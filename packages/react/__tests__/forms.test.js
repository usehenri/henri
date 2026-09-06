/**
 * Runs against the compiled output (`pnpm --filter @usehenri/react build`,
 * done by `pnpm install`).
 */
const React = require('react');
const { renderToString } = require('react-dom/server');
const { HenriContext } = require('../dist/lib/withHenri');
const {
  Button,
  Editor,
  Form,
  FormError,
  Input,
  Radio,
  Select,
  messageFor,
  sanitize,
} = require('../dist/lib/forms');

const h = React.createElement;

/**
 * A henri context with a recording fetch
 *
 * @param {object} [options] `{ answer, reject }`
 * @returns {{ value: object, calls: object }} the context value and calls
 */
function fakeHenri({ answer = { ok: true }, reject = null } = {}) {
  const calls = { fetch: [], hydrate: 0 };
  const value = {
    data: {},
    fetch: async (target, body) => {
      calls.fetch.push({ body, target });

      if (reject) {
        throw reject;
      }

      return answer;
    },
    hydrate: async () => {
      calls.hydrate += 1;
    },
    paths: {},
    user: null,
  };

  return { calls, value };
}

/**
 * Render a form tree in the DOM with react-dom/client
 *
 * @param {React.Element} element the tree
 * @returns {Promise<{ container: Element, unmount: function }>} the mount
 */
async function mount(element) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>');

  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;

  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const container = dom.window.document.getElementById('root');
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return {
    act,
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      delete global.window;
      delete global.document;
      delete global.IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

/**
 * Fire a React change event on a DOM input
 *
 * @param {function} act react's act
 * @param {Element} input the input
 * @param {string} value the value
 * @returns {Promise<void>} done
 */
async function type(act, input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    'value'
  ).set;

  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new global.window.Event('input', { bubbles: true }));
  });
}

/**
 * Submit a form
 *
 * @param {function} act react's act
 * @param {Element} form the form
 * @returns {Promise<void>} done
 */
async function submit(act, form) {
  await act(async () => {
    form.dispatchEvent(
      new global.window.Event('submit', { bubbles: true, cancelable: true })
    );
  });
}

describe('forms', () => {
  let warn;
  let error;
  let warnings;

  beforeEach(() => {
    warnings = [];
    warn = console.warn;
    error = console.error;
    console.warn = (...args) => warnings.push(args.join(' '));
    console.error = (...args) => warnings.push(args.join(' '));
  });

  afterEach(() => {
    console.warn = warn;
    console.error = error;
  });

  describe('sanitize()', () => {
    test('chains the rules and handles nested names', () => {
      const data = { name: '  <b>x</b> ', profile: { bio: '  hi ' } };
      const clean = sanitize(data, {
        name: { escape: true, trim: true },
        'profile.bio': { trim: true },
      });

      expect(clean.name).toBe('&lt;b&gt;x&lt;&#x2F;b&gt;');
      expect(clean.profile.bio).toBe('hi');
      expect(data.name).toBe('  <b>x</b> ');
    });

    test('leaves values without rules alone', () => {
      expect(
        sanitize({ done: true, n: 3 }, { done: {}, other: { trim: true } })
      ).toEqual({ done: true, n: 3 });
    });
  });

  describe('server rendering', () => {
    test('renders the fields from the data, nested names included', () => {
      const html = renderToString(
        h(
          Form,
          { data: { profile: { name: 'Ada' }, role: 'admin' }, name: 'f' },
          h(Input, { name: 'profile.name' }),
          h(Radio, { group: 'role', label: 'Admin', name: 'admin' }),
          h(Radio, { group: 'role', label: 'User', name: 'user' }),
          h(Button, { label: 'Go' })
        )
      );

      expect(html).toContain('<form id="f">');
      expect(html).toContain('name="profile.name" value="Ada"');
      expect(html).toMatch(
        /<input type="radio"[^>]*name="role" checked="" value="admin"/
      );
      expect(html).toMatch(/<input type="radio"[^>]*name="role" value="user"/);
      expect(html).toContain('<button type="submit"');
      expect(warnings).toEqual([]);
    });

    test('Select renders a placeholder option and picks _id objects', () => {
      const choices = [
        { _id: 'a', name: 'Alpha' },
        { _id: 'b', name: 'Beta' },
      ];
      const html = renderToString(
        h(
          Form,
          { data: { owner: { _id: 'b', name: 'Beta' } } },
          h(Select, {
            choices,
            name: 'owner',
            placeholder: 'Pick one',
            required: true,
          })
        )
      );

      expect(html).toContain('<option value="" disabled="">Pick one</option>');
      expect(html).toContain('<option value="b" selected="">Beta</option>');

      const empty = renderToString(
        h(
          Form,
          {},
          h(Select, { choices, name: 'owner', placeholder: 'Pick one' })
        )
      );

      expect(empty).toContain('<option value="" selected="">Pick one</option>');
    });

    test('Select picks the public identifier of a record', () => {
      const choices = [
        { externalId: 'aaa', name: 'Alpha' },
        { externalId: 'bbb', name: 'Beta' },
      ];
      const html = renderToString(
        h(
          Form,
          { data: { owner: { externalId: 'bbb', name: 'Beta' } } },
          h(Select, { choices, name: 'owner' })
        )
      );

      expect(html).toContain('<option value="bbb" selected="">Beta</option>');
    });

    test('Editor renders a textarea on the server', () => {
      const html = renderToString(
        h(Form, { data: { body: '<p>hi</p>' } }, h(Editor, { name: 'body' }))
      );

      expect(html).toContain('<textarea');
      expect(html).not.toContain('ql-editor');
    });

    test('components warn once outside a form', () => {
      renderToString(
        h('div', null, h(Input, { name: 'a' }), h(Input, { name: 'b' }))
      );

      expect(warnings.filter((line) => line.includes('Input')).length).toBe(1);
    });
  });

  describe('messageFor()', () => {
    test('maps rules to messages and passes server messages through', () => {
      expect(messageFor({ isLength: 'Too short' }, 'isLength')).toBe(
        'Too short'
      );
      expect(messageFor({}, 'is required')).toBe('is required');
      expect(messageFor({}, null)).toBe('');
    });
  });

  describe('submission', () => {
    test('sends the sanitized data through fetch, then hydrates, onSuccess and clears', async () => {
      const { calls, value } = fakeHenri({ answer: { task: { _id: '1' } } });
      const successes = [];
      const { act, container, unmount } = await mount(
        h(
          HenriContext.Provider,
          { value },
          h(
            Form,
            {
              action: { method: 'patch', route: '/tasks/1' },
              onSuccess: (...args) => successes.push(args),
            },
            h(Input, { name: 'name', sanitation: { trim: true } }),
            h(Input, { name: 'profile.city' }),
            h(Button, { label: 'Save' })
          )
        )
      );

      const [name, city] = container.querySelectorAll('input');

      await type(act, name, '  Ada  ');
      await type(act, city, 'London');
      expect(name.value).toBe('  Ada  ');

      await submit(act, container.querySelector('form'));

      expect(calls.fetch).toEqual([
        {
          body: { name: 'Ada', profile: { city: 'London' } },
          target: { method: 'patch', route: '/tasks/1' },
        },
      ]);
      expect(calls.hydrate).toBe(1);
      expect(successes).toEqual([
        [{ name: 'Ada', profile: { city: 'London' } }, { task: { _id: '1' } }],
      ]);
      expect(name.value).toBe('');
      expect(container.querySelector('button').disabled).toBe(false);

      await unmount();
    });

    test('a route string action posts by default and method wins', async () => {
      const { calls, value } = fakeHenri();
      const { act, container, unmount } = await mount(
        h(
          HenriContext.Provider,
          { value },
          h(
            Form,
            { action: '/tasks', data: { name: 'x' } },
            h(Input, { name: 'name' })
          ),
          h(
            Form,
            {
              action: { method: 'post', route: '/tasks' },
              data: { name: 'y' },
              method: 'put',
            },
            h(Input, { name: 'name' })
          )
        )
      );
      const forms = container.querySelectorAll('form');

      await submit(act, forms[0]);
      await submit(act, forms[1]);

      expect(calls.fetch.map((call) => call.target)).toEqual([
        { method: 'post', route: '/tasks' },
        { method: 'put', route: '/tasks' },
      ]);

      await unmount();
    });

    test('shows the server message and per-field errors, keeps the data and unlocks', async () => {
      const err = new Error('validation failed');

      err.data = { errors: { name: 'is required' } };

      const { value } = fakeHenri({ reject: err });
      const failures = [];
      const { act, container, unmount } = await mount(
        h(
          HenriContext.Provider,
          { value },
          h(
            Form,
            {
              action: '/tasks',
              data: { name: 'keep me' },
              onError: (...args) => failures.push(args),
            },
            h(FormError),
            h(Input, { errorMsg: { isLength: 'Too short' }, name: 'name' }),
            h(Button, { label: 'Save' })
          )
        )
      );

      await submit(act, container.querySelector('form'));

      expect(container.querySelector('.form-error').textContent).toBe(
        'validation failed'
      );
      expect(container.querySelector('.help-block').textContent).toBe(
        'is required'
      );
      expect(container.querySelector('.has-error')).not.toBeNull();
      expect(container.querySelector('input').value).toBe('keep me');
      expect(container.querySelector('button').disabled).toBe(false);
      expect(failures[0][0]).toBe('validation failed');
      expect(failures[0][1]).toBe(err);

      await unmount();
    });

    test('validates on change, rule by rule, with errorMsg', async () => {
      const { calls, value } = fakeHenri();
      const { act, container, unmount } = await mount(
        h(
          HenriContext.Provider,
          { value },
          h(
            Form,
            { action: '/tasks' },
            h(Input, {
              errorMsg: { isEmail: 'Not an email', isLength: 'Too short' },
              name: 'email',
              validation: { isEmail: true, isLength: { min: 3 } },
            })
          )
        )
      );
      const input = container.querySelector('input');

      await type(act, input, 'ab');
      expect(container.querySelector('.help-block').textContent).toBe(
        'Not an email'
      );

      await type(act, input, 'a@b.co');
      expect(container.querySelector('.help-block')).toBeNull();

      await type(act, input, '');
      expect(container.querySelector('.help-block')).toBeNull();

      await submit(act, container.querySelector('form'));
      expect(calls.fetch[0].body).toEqual({ email: '' });

      await unmount();
    });

    test('refuses action and handleSubmit together, and calls handleSubmit alone', async () => {
      const { calls, value } = fakeHenri();
      const custom = [];
      const { act, container, unmount } = await mount(
        h(
          HenriContext.Provider,
          { value },
          h(Form, { action: '/x', handleSubmit: () => custom.push('both') }),
          h(
            Form,
            { data: { a: 1 }, handleSubmit: (...args) => custom.push(args) },
            h(Input, { name: 'a' })
          )
        )
      );
      const forms = container.querySelectorAll('form');

      await submit(act, forms[0]);
      expect(custom).toEqual([]);
      expect(warnings.some((line) => line.includes('puzzled'))).toBe(true);

      await submit(act, forms[1]);
      expect(custom.length).toBe(1);
      expect(custom[0][0]).toBeNull();
      expect(custom[0][1]).toEqual({ a: 1 });
      expect(custom[0][2]).toEqual(expect.any(Function));
      expect(calls.fetch).toEqual([]);

      await unmount();
    });

    test('warns when used outside withHenri', async () => {
      const { act, container, unmount } = await mount(
        h(Form, { action: '/x' }, h(Input, { name: 'a' }))
      );

      await submit(act, container.querySelector('form'));
      expect(
        warnings.some((line) =>
          line.includes('outside a page wrapped with withHenri')
        )
      ).toBe(true);

      await unmount();
    });
  });
});
