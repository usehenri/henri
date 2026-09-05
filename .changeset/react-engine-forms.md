---
'@usehenri/react': minor
---

React engine, `withHenri` and forms reworked against Next.js 16 and React 19.

Engine

- Fast Refresh works again: the engine hands henri's http server to `next()`
  (`httpServer`) instead of forwarding websocket upgrades itself, which made
  next.js handle each upgrade twice and drop the connection.
- `require('@usehenri/react/engine').build({ cwd, config })` runs `next build`
  without booting henri (no stores, no server), for `henri build` and Docker
  build stages. The `distDir` of `config/next.js` is honoured when checking for
  an existing production build.
- `init()` fails with a clear message when `app/views/pages` is missing and
  warns when `app/views/app` exists (pages router only). `reload()` announces
  that `config/next.js`/`config/webpack.js` changes need a restart; `close()`
  stops the next.js instance.
- A broken `config/webpack.js` hook throws (with the explanation) instead of
  killing the build workers with `process.exit`.

withHenri

- Client-side navigation fetches `asPath` (the real url, query included) as
  JSON instead of the page file path.
- Server side reads only what henri attached to the request (`req._henri`);
  `?data=` and friends in the url can no longer become page props.
- `WithHenri` is a function component: `data` follows the props on navigation,
  `hydrate()` keeps the current data on a non-henri answer and exposes the
  error as `useHenri().error`. `errors`, `graphql`, `csrf` and `localUrl` reach
  the page and the context.
- axios is gone: `fetch()`, `hydrate()` and navigation go through one native
  `fetch` helper (`request`) sending `Accept: application/json`, JSON bodies
  and the `X-CSRF-Token` header when a `csrf` token is present. Failed
  requests reject with a `RequestError` carrying the boom body (`message`,
  `data`, `statusCode`). `fetch()` accepts a `pathFor()` result or a string.
- `pathFor`/`getRoute` replace whole parameter names (`:id` no longer rewrites
  `:identifier`).

Forms

- `Editor` loads Quill with `next/dynamic` (no hydration mismatch) and is
  controlled by the form data, so `clear()` empties it.
- Sanitizers chain (`trim` then `escape`), are registered in an effect, and
  apply to nested names. The form stays disabled until the request settles.
- `Select` renders a real placeholder option, honours `validation` and shows
  its error; server-side field errors (`data.errors` of a 422) are displayed
  under the fields. `Form action` accepts a `pathFor()` result.
- `prop-types` and `shallowequal` dropped.

The `henri g scaffold` React templates are regenerated for this API
(`pathFor`/`getRoute`, `next/link`, valid table markup, guarded show/edit,
redirects after create/update).
