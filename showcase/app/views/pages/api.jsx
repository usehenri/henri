// The hypermedia explorer: this page calls the JSON API of this same
// application from the browser and shows the answers, headers included, so a
// visitor can see the HAL without opening a terminal.
//
// It uses the browser's own fetch rather than useHenri().fetch() because the
// point is to control the Accept header and read the response headers back.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { PageHeader, card, mono, primary, secondary } from 'components/ui';

/** Response headers worth showing next to the body */
const SHOWN = [
  'content-type',
  'etag',
  'link',
  'x-total-count',
  'x-request-id',
  'cache-control',
  'idempotency-replayed',
];

/**
 * The requests the explorer can make
 *
 * @param {object} sample Ids of records that exist (`{ proposal, event }`)
 * @returns {Array<object>} The request descriptors
 */
const requests = (sample) => [
  {
    accept: 'application/hal+json',
    id: 'collection',
    note: 'A HAL collection: the page under _embedded.proposals, the paging links and the counters, plus the Link and X-Total-Count headers.',
    path: '/proposals?per_page=3',
    title: 'A page of proposals',
  },
  {
    accept: 'application/hal+json',
    id: 'page-2',
    note: 'Page two. prev, next, first and last are computed from the total, and the links carry the query string back.',
    path: '/proposals?per_page=3&page=2',
    title: 'The next page',
  },
  {
    accept: 'application/hal+json',
    id: 'resource',
    note: 'One resource. _links is built from the route helpers of this controller and filtered by the roles of the current user. There is no destroy link because config/routes.js says except: [destroy]: withdrawing is a member route that soft deletes instead.',
    path: `/proposals/${sample.proposal || 1}`,
    title: 'One proposal',
  },
  {
    accept: 'application/json',
    id: 'conditional',
    note: 'Every JSON answer carries a weak ETag. The second request sends it back as If-None-Match and the server answers 304 with no body.',
    path: `/proposals/${sample.proposal || 1}`,
    revalidate: true,
    title: 'ETag and 304',
  },
  {
    accept: 'application/vnd.henri.v1+json',
    id: 'version',
    note: 'The proposals routes declare version: v1, so the versioned media type is served.',
    path: '/proposals?per_page=1',
    title: 'The versioned media type',
  },
  {
    accept: 'application/vnd.henri.v2+json',
    id: 'version-refused',
    note: 'A client asking for a version this route does not serve gets a 406 rather than a wrong shape.',
    path: '/proposals?per_page=1',
    title: 'A version that is not served',
  },
  {
    accept: 'application/json',
    id: 'guarded',
    note: 'The reviews of a proposal are nested under it and carry roles: [admin]. Signed out, this is a 401; signed in as a speaker, a 403. A browser asking for HTML would be redirected to the login page instead.',
    path: `/proposals/${sample.proposal || 1}/reviews`,
    title: 'A route behind a role',
  },
  {
    accept: 'application/json',
    id: 'render-json',
    note: 'Every page also answers JSON: the same object the Inertia page was rendered with, plus the _links of the route. This is an action that uses implicit rendering.',
    path: '/events',
    title: 'A page, as JSON',
  },
  {
    accept: 'application/json',
    id: 'health',
    note: 'The health check pings every store. It runs before the session and the rate limiters, so a load balancer can call it freely.',
    path: '/_henri/health',
    title: 'The health check',
  },
];

/**
 * Runs one request and returns what to display
 *
 * @param {object} request The descriptor
 * @returns {Promise<object>} `{ status, headers, body, sent }`
 */
const run = async (request) => {
  const headers = { Accept: request.accept };
  const response = await fetch(request.path, { headers });
  const text = await response.text();
  const shown = {};

  for (const name of SHOWN) {
    if (response.headers.get(name)) {
      shown[name] = response.headers.get(name);
    }
  }

  const result = {
    body: text,
    headers: shown,
    sent: headers,
    status: `${response.status} ${response.statusText}`,
  };

  if (!request.revalidate || !response.headers.get('etag')) {
    return result;
  }

  const again = await fetch(request.path, {
    headers: { ...headers, 'If-None-Match': response.headers.get('etag') },
  });

  return {
    ...result,
    second: {
      sent: { ...headers, 'If-None-Match': response.headers.get('etag') },
      status: `${again.status} ${again.statusText}`,
    },
  };
};

/**
 * Pretty prints a JSON body, or returns it untouched
 *
 * @param {string} body The response body
 * @returns {string} The body to display
 */
const pretty = (body) => {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body || '(no body)';
  }
};

export default function ApiExplorer() {
  const { data, user } = useHenri();
  const list = requests(data.sample || {});
  const [current, setCurrent] = useState(list[0]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const send = useCallback(async (request) => {
    setBusy(true);
    setCurrent(request);

    try {
      setResult(await run(request));
    } catch (error) {
      setResult({
        body: String(error),
        headers: {},
        sent: {},
        status: 'failed',
      });
    } finally {
      setBusy(false);
    }
  }, []);

  // The first request runs once on mount, in the browser only: this page is
  // server rendered first and effects do not run there
  useEffect(() => {
    if (started.current) {
      return;
    }

    started.current = true;
    send(list[0]);
  }, [list, send]);

  return (
    <Layout>
      <PageHeader
        title="API explorer"
        subtitle="Every route of this application answers JSON as well as HTML. These are real requests, made from your browser to this server."
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[19rem_1fr]">
        <nav className="grid gap-2 self-start">
          {list.map((request) => (
            <button
              key={request.id}
              className={`${
                request.id === current.id ? primary : secondary
              } justify-start text-left`}
              disabled={busy}
              onClick={() => send(request)}
              type="button"
            >
              {request.title}
            </button>
          ))}
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {user
              ? `Signed in as ${user.email} (${(user.roles || []).join(', ')}).`
              : 'Signed out: the guarded request will answer 401.'}
          </p>
        </nav>

        <section className={`${card} overflow-hidden`}>
          <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <p className={`${mono} break-all`}>GET {current.path}</p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {current.note}
            </p>
          </div>

          {result && (
            <div className="px-5 py-4">
              <p className={`${mono} text-zinc-500 dark:text-zinc-400`}>
                Accept: {result.sent.Accept}
              </p>
              <p className="mt-2 text-sm font-medium">{result.status}</p>

              {Object.keys(result.headers).length > 0 && (
                <dl className="mt-3 grid gap-1">
                  {Object.entries(result.headers).map(([name, value]) => (
                    <div key={name} className="flex flex-wrap gap-2">
                      <dt
                        className={`${mono} text-zinc-500 dark:text-zinc-400`}
                      >
                        {name}:
                      </dt>
                      <dd className={`${mono} break-all`}>{value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {result.second && (
                <p className="mt-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
                  Sent again with{' '}
                  <span className={mono}>
                    If-None-Match: {result.second.sent['If-None-Match']}
                  </span>{' '}
                  &rarr; <strong>{result.second.status}</strong>
                </p>
              )}

              <pre className="mt-4 max-h-[28rem] overflow-auto rounded-lg bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-100">
                {pretty(result.body)}
              </pre>
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
