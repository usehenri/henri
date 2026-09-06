/**
 * Runs against the compiled output (`pnpm --filter @usehenri/react build`,
 * done by `pnpm install`).
 */
const React = require('react');
const { renderToString } = require('react-dom/server');
const {
  RouterContext,
} = require('next/dist/shared/lib/router-context.shared-runtime');
const withHenri = require('../dist/lib/withHenri').default;
const {
  HenriContext,
  RequestError,
  request,
  useHenri,
} = require('../dist/lib/withHenri');

const h = React.createElement;

const paths = {
  index_tasks_path: { method: 'get', route: '/tasks' },
  show_tasks_path: { method: 'get', route: '/tasks/:id' },
};

/**
 * Render a page inside a next.js router context
 *
 * @param {React.Element} element the page
 * @param {object} [router] the router
 * @returns {string} the html
 */
function render(element, router = { asPath: '/', pathname: '/', query: {} }) {
  // React separates adjacent text nodes with comments: not what we assert on
  return renderToString(
    h(RouterContext.Provider, { value: router }, element)
  ).replace(/<!-- -->/g, '');
}

/**
 * A fetch stub answering with the given body
 *
 * @param {object} answer `{ status, body, type }`
 * @param {Array} calls where to record the calls
 * @returns {function} the stub
 */
function fakeFetch(answer, calls) {
  return async (url, init) => {
    calls.push({ init, url });

    const { body = {}, status = 200, type = 'application/json' } = answer;
    const text = typeof body === 'string' ? body : JSON.stringify(body);

    return {
      headers: { get: (name) => (name === 'content-type' ? type : null) },
      json: async () => JSON.parse(text),
      ok: status >= 200 && status < 300,
      status,
      statusText: 'status',
      text: async () => text,
    };
  };
}

describe('withHenri', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('getInitialProps', () => {
    test('server side reads req._henri only (never the url query)', async () => {
      const Page = withHenri(() => null);
      const req = {
        _henri: {
          csrf: 'token',
          data: { tasks: [1] },
          errors: null,
          graphql: { endpoint: '/g', query: false },
          localUrl: 'http://localhost:3000',
          paths,
          user: { email: 'a@b.c' },
        },
      };

      const props = await Page.getInitialProps({
        asPath: '/?data=hijack&user=me',
        pathname: '/',
        query: { data: 'hijack', user: 'me' },
        req,
      });

      expect(props).toEqual({
        csrf: 'token',
        data: { tasks: [1] },
        error: null,
        errors: null,
        // Nothing was flashed: the default empty bag
        flash: {},
        graphql: { endpoint: '/g', query: false },
        // `getInitialProps` fills the defaults in, and a page of an
        // application with one language has no locale
        i18n: null,
        localUrl: 'http://localhost:3000',
        paths,
        user: { email: 'a@b.c' },
      });
    });

    test('server side falls back to the defaults on a fallback page', async () => {
      const Page = withHenri(() => null);
      const props = await Page.getInitialProps({
        pathname: '/about',
        query: { data: 'hijack' },
        req: { _henri: { paths: {}, user: null } },
      });

      expect(props.data).toEqual({});
      expect(props.user).toBeNull();
      expect(props.paths).toEqual({});
    });

    test('client side fetches asPath as JSON', async () => {
      const calls = [];

      global.fetch = fakeFetch(
        { body: { data: { tasks: [2] }, paths, user: null } },
        calls
      );

      const Page = withHenri(() => null);
      const props = await Page.getInitialProps({
        asPath: '/tasks/2?tab=notes',
        pathname: '/tasks/[id]',
        query: { id: '2' },
      });

      expect(calls[0].url).toBe('/tasks/2?tab=notes');
      expect(calls[0].init.headers.Accept).toBe('application/json');
      expect(calls[0].init.method).toBe('GET');
      expect(props.data).toEqual({ tasks: [2] });
      expect(props.paths).toEqual(paths);
    });

    test('client side keeps the page alive when the fetch fails', async () => {
      global.fetch = fakeFetch(
        { body: { message: 'nope', statusCode: 404 }, status: 404 },
        []
      );

      const Page = withHenri(() => null);
      const props = await Page.getInitialProps({
        asPath: '/x',
        pathname: '/x',
      });

      expect(props.data).toEqual({});
      expect(props.error).toEqual({ message: 'nope', status: 404 });
    });

    test('the composed getInitialProps wins', async () => {
      const Inner = () => null;

      Inner.getInitialProps = async () => ({ data: { mine: true }, extra: 1 });

      const Page = withHenri(Inner);
      const props = await Page.getInitialProps({
        pathname: '/',
        req: { _henri: { data: { theirs: true } } },
      });

      expect(props.data).toEqual({ mine: true });
      expect(props.extra).toBe(1);
    });
  });

  describe('rendering', () => {
    test('exposes data, user, paths and the helpers through props and useHenri()', () => {
      const Inner = ({ data, user, pathFor, getRoute, router }) => {
        const context = useHenri();

        return h(
          'div',
          null,
          `${data.name}|${user.email}|${pathFor('show_tasks_path', '7')}|${getRoute('index_tasks_path')}|${router.asPath}|`,
          `${context.data.name}|${context.pathFor('show_tasks_path', { id: 8 })}|${context.localUrl}|${context.csrf}|${String(context.errors)}`
        );
      };
      const Page = withHenri(Inner);
      const html = render(
        h(Page, {
          csrf: 'tok',
          data: { name: 'world' },
          errors: null,
          localUrl: 'http://local',
          paths,
          user: { email: 'a@b.c' },
        }),
        { asPath: '/here', pathname: '/', query: {} }
      );

      expect(html).toContain(
        'world|a@b.c|/tasks/7|/tasks|/here|world|/tasks/8|http://local|tok|null'
      );
      expect(Page.displayName).toBe('withRouter(withHenri(Inner))');
    });

    test('defaults data to an object and user to null', () => {
      const Inner = ({ data, user }) =>
        h('span', null, `${JSON.stringify(data)}|${String(user)}`);
      const Page = withHenri(Inner);

      expect(render(h(Page, {}))).toContain('{}|null');
    });

    test('HenriContext has safe defaults outside withHenri', () => {
      const Inner = () => {
        const { data, getRoute, pathFor, user } =
          React.useContext(HenriContext);

        return h(
          'i',
          null,
          `${JSON.stringify(data)}|${getRoute('x')}|${String(pathFor('x'))}|${String(user)}`
        );
      };
      const warn = console.warn;

      console.warn = () => {};
      try {
        expect(renderToString(h(Inner))).toContain(
          '{}|route-not-found|undefined|null'
        );
      } finally {
        console.warn = warn;
      }
    });
  });

  describe('request()', () => {
    test('sends JSON, asks for JSON and adds the CSRF header when present', async () => {
      const calls = [];

      global.fetch = fakeFetch({ body: { ok: true } }, calls);

      const result = await request({
        body: { name: 'x' },
        csrf: 'tok',
        method: 'post',
        route: '/tasks',
      });

      expect(result).toEqual({ ok: true });
      expect(calls[0].url).toBe('/tasks');
      expect(calls[0].init).toEqual({
        body: '{"name":"x"}',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'tok',
        },
        method: 'POST',
      });
    });

    test('accepts a pathFor() entry as route and omits the CSRF header without a token', async () => {
      const calls = [];

      global.fetch = fakeFetch({ body: 'plain', type: 'text/plain' }, calls);

      const result = await request({
        route: { method: 'delete', route: '/tasks/1' },
      });

      expect(result).toBe('plain');
      expect(calls[0].url).toBe('/tasks/1');
      expect(calls[0].init.headers['X-CSRF-Token']).toBeUndefined();
      expect(calls[0].init.body).toBeUndefined();
    });

    test('rejects with the boom body on a non-2xx answer', async () => {
      global.fetch = fakeFetch(
        {
          body: {
            data: { errors: { name: 'required' } },
            error: 'Unprocessable Entity',
            message: 'validation failed',
            statusCode: 422,
          },
          status: 422,
        },
        []
      );

      let error = null;

      try {
        await request({ method: 'post', route: '/tasks' });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(RequestError);
      expect(error.message).toBe('validation failed');
      expect(error.status).toBe(422);
      expect(error.statusCode).toBe(422);
      expect(error.error).toBe('Unprocessable Entity');
      expect(error.data).toEqual({ errors: { name: 'required' } });
    });
  });

  describe('hydrate()', () => {
    /**
     * Render the page in a browser-like DOM to drive hydrate()
     *
     * @param {object} answer what fetch answers
     * @returns {Promise<object>} what the page saw
     */
    async function drive(answer) {
      const { JSDOM } = require('jsdom');
      const dom = new JSDOM('<!doctype html><div id="root"></div>', {
        url: 'http://localhost/tasks?x=1',
      });
      const seen = [];
      const calls = [];
      let hydrate = null;

      global.window = dom.window;
      global.document = dom.window.document;
      global.fetch = fakeFetch(answer, calls);
      global.IS_REACT_ACT_ENVIRONMENT = true;

      try {
        const { act } = React;
        const { createRoot } = require('react-dom/client');
        const Inner = (props) => {
          const context = useHenri();

          hydrate = context.hydrate;
          seen.push({ data: props.data, error: context.error });

          return null;
        };
        const Page = withHenri(Inner);
        const root = createRoot(dom.window.document.getElementById('root'));

        await act(async () => {
          root.render(
            h(
              RouterContext.Provider,
              { value: { asPath: '/tasks', pathname: '/tasks', query: {} } },
              h(Page, { data: { tasks: ['first'] }, paths })
            )
          );
        });

        let result;

        await act(async () => {
          result = await hydrate();
        });

        await act(async () => {
          root.unmount();
        });

        return { calls, last: seen[seen.length - 1], result };
      } finally {
        delete global.window;
        delete global.document;
        delete global.IS_REACT_ACT_ENVIRONMENT;
      }
    }

    test('replaces data with the JSON of the current url', async () => {
      const { calls, last, result } = await drive({
        body: { data: { tasks: ['second'] }, paths },
      });

      expect(calls[0].url).toBe('http://localhost/tasks?x=1');
      expect(result).toEqual({ tasks: ['second'] });
      expect(last.data).toEqual({ tasks: ['second'] });
      expect(last.error).toBeNull();
    });

    test('keeps the data and exposes the error on an HTML answer', async () => {
      const { last, result } = await drive({
        body: '<html>login</html>',
        type: 'text/html',
      });

      expect(result).toBeNull();
      expect(last.data).toEqual({ tasks: ['first'] });
      expect(last.error).toBeInstanceOf(Error);
      expect(last.error.message).toContain('not a henri page');
    });

    test('keeps the data and exposes the error on a failed request', async () => {
      const { last } = await drive({
        body: { message: 'Unauthorized', statusCode: 401 },
        status: 401,
      });

      expect(last.data).toEqual({ tasks: ['first'] });
      expect(last.error.message).toBe('Unauthorized');
      expect(last.error.status).toBe(401);
    });
  });
});
