---
title: JSON API
description: HAL answers with res.resource and res.collection, pagination, Idempotency-Key, rate limiting, request ids, versioning, the health endpoints and graceful shutdown.
sidebar:
  order: 7
---

Every henri controller can answer JSON, and the answers follow the conventions a Rails API gives you: hypermedia links ([HAL](https://datatracker.ietf.org/doc/html/draft-kelly-json-hal)), idempotent mutations, rate limits, request ids, secure headers, filtered logs, liveness and readiness endpoints and a shutdown that drains. Most of it is on by default and configured from `config/default.json`; the keys are listed in [Configuration](/configuration/#json-api).

## Answering HAL

`res.resource(record, options)` answers one record and `res.collection(records, options)` a page of them. Both send the public fields of the record and add `_links`, built from the route helpers of the controller and filtered by the roles of the current user: a visitor who may not `DELETE` never sees the `destroy` link. With a [policy](/guides/policies/) for the model, they are filtered again against the record itself, so two people with the same role reading the same proposal get different links — and a controller that presents its records before sending them names what the rules should read with `subject`.

```js
// app/controllers/tasks.js
module.exports = {
  async index(req, res) {
    const {
      records: tasks,
      page,
      perPage,
      total,
    } = await Task.paginate(req.pagination());

    return res.negotiate({
      html: () => res.render('/tasks', { data: { tasks } }),
      json: () => res.collection(tasks, { page, perPage, total }),
    });
  },

  async create(req, res) {
    const task = await Task.create(req.permit('title', 'done'));

    return res.negotiate({
      html: () => res.redirect(`/tasks/${task.externalId}`),
      json: () => res.resource(task, { status: 201 }),
    });
  },
};
```

A resource looks like this:

```json
{
  "_links": {
    "self": { "href": "/tasks/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11" },
    "collection": { "href": "/tasks" },
    "edit": { "href": "/tasks/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11/edit" },
    "update": {
      "href": "/tasks/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11",
      "method": "PATCH"
    },
    "destroy": {
      "href": "/tasks/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11",
      "method": "DELETE"
    }
  },
  "externalId": "0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11",
  "title": "Ship it",
  "done": false
}
```

The identifier is the record's `externalId`, the public one every model carries; the primary key stays on the server and is not in the payload. `res.resource()`, `res.collection()`, the `Location` header of a `201` and every href of `_links` are built from it. So is every foreign key the model declared: a record that belongs to another answers with that record's `externalId`, not with its primary key, and the lookups behind a whole page are batched into one statement per model. A controller that presents its records before sending them calls `henri.model.publish()` first -- a plain object carries no model, so nothing downstream can tell a foreign key from any other number. See [Identifiers](/guides/models/#identifiers) and [Foreign keys](/guides/models/#foreign-keys).

A collection embeds its items under `_embedded.<type>` and carries the paging links and counters, plus `Link` and `X-Total-Count` headers:

```json
{
  "_links": {
    "self": { "href": "/tasks?page=2&per_page=25" },
    "first": { "href": "/tasks?page=1&per_page=25" },
    "prev": { "href": "/tasks?page=1&per_page=25" },
    "next": { "href": "/tasks?page=3&per_page=25" },
    "last": { "href": "/tasks?page=4&per_page=25" },
    "create": { "href": "/tasks", "method": "POST" },
    "new": { "href": "/tasks/new" }
  },
  "_embedded": { "tasks": [{ "...": "..." }] },
  "count": 25,
  "page": 2,
  "perPage": 25,
  "total": 100
}
```

Options: `type` names the controller when it is not the route's (`res.resource(user, { type: 'users' })`), `links` adds your own (`{ rel: href }` or HAL link objects), `status` sets the status; a `201` also sets `Location` to the `self` link. The content type is `application/hal+json` when the client asks for it and `application/json` otherwise. Authenticated answers carry `Cache-Control: no-store`; every JSON answer has a weak `ETag` and `If-None-Match` gets a `304`.

`res.negotiate({ html, json })` runs `html` for browsers (and clients accepting `*/*`) and `json` for `application/json`, `application/hal+json` and the versioned media type below. `res.render()` keeps answering `{ data, user, paths, ... }` to JSON clients and now adds `_links` too.

Routes expanded from `resources` and `crud` are expected to answer HAL: a JSON answer without `_links` on one of them is reported once per route in the log, and refused with a `500` when `config.api.strict` is `true`. The page object the [Inertia](/guides/views/#inertia) engine answers a client-side visit with (`X-Inertia`) is a rendered page, not an API answer, and is never checked. `henri generate scaffold` and `henri generate crud` write controllers in the shape above, and `henri generate test <name>` asserts the links when the name has a `resources` or `crud` route.

## Pagination

`req.pagination()` reads `?page=` and `?per_page=` and returns `{ page, perPage, skip, limit, offset }`, defaulting to `config.api.perPage` (25) and capped at `config.api.maxPerPage` (100). Pass `page`, `perPage` and `total` to `res.collection()` and the paging links are computed for you.

[`Model.paginate()`](/guides/models/#pagination) is the other half: `await Task.paginate(req.pagination())` answers `{ records, page, perPage, total, pages }` on every adapter, so an index action is one query instead of a find and a count.

## Idempotency

Clients retrying a `POST`, `PUT`, `PATCH` or `DELETE` send an `Idempotency-Key` header (any ASCII string up to 255 characters), with the same semantics as Stripe:

| Situation                                       | Answer                                                 |
| ----------------------------------------------- | ------------------------------------------------------ |
| First request with the key                      | Executed; status, headers and body stored for 24 hours |
| Same key, same request, already answered        | The stored answer, with `Idempotency-Replayed: true`   |
| Same key, same request, still in flight         | `409` with `Retry-After: 1`                            |
| Same key, different method, path or body        | `422`                                                  |
| First answer was a `5xx` or the request aborted | Nothing stored, the client may retry                   |

Keys are scoped to the user, the session or the ip, so two users may use the same key. Every mutating route from `config/routes.js` honours the header; `idempotent: false` on a route opts it out, and core's `/login` and `/logout` are never covered. `config.api.idempotency: false` turns the feature off.

The answers live in this process's memory unless the application says otherwise, which stops being idempotent the moment it runs two processes: [`config.shared`](/configuration/#the-shared-object) names one backend for these keys, the rate limit and the sign-in lockout at once. `config.api.idempotency.store` still names a module of its own (exporting `{ get, set, delete }`, or a `(henri, { name }) => store` factory) and still wins over it, and `henri.api.idempotencyStore` can be replaced after the boot.

A shared store that does not answer is the one case where the request is always refused — `503` with a `Retry-After`, whatever `shared.onError` says. Serving a mutating request whose first answer cannot be read is what the header exists to prevent.

## Rate limiting

Requests are limited with [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit), per user id when logged in and per ip otherwise (`trustProxy` decides which ip). The answer is a `429` from `res.boom.tooManyRequests` with `data: { limit, retryAfter, windowMs }` and the draft-7 `RateLimit`, `RateLimit-Policy` and `Retry-After` headers.

- Global: `config.rateLimit`, 600 requests per minute by default. It is not enforced in development, where the Next and Vite dev servers fetch hundreds of assets through the router; it is in test and production.
- Authentication: `config.rateLimit.auth`, 10 `POST` per minute per ip on the login path and on `/register`, `/signup`, `/password`, `/forgot-password` and `/reset-password` (`paths` overrides the list).
- Per route: `rateLimit: { windowMs, max }` in `config/routes.js`, always enforced.

`config.rateLimit: false` disables everything, `auth: false` only the authentication limiter. In production a warning is logged when `trust proxy` is `true`, because a spoofed `X-Forwarded-For` then chooses the bucket.

The counters are kept in this process unless the application says where else, which means a limit of 600 is really 600 per process: [`config.shared`](/configuration/#the-shared-object) names one backend for the limiter, the sign-in lockout and the idempotency keys at once (`pnpm add @usehenri/redis`), and `config.rateLimit.store` still names an express-rate-limit `Store` of its own and still wins over it. The boot line says which it is:

```text
info  api  rate limit  600 requests per 60s per user or ip, counted in redis (fail closed)
info  api  rate limit  600 requests per 60s per user or ip, counted in this process
```

When the shared store does not answer, `shared.onError` decides: `closed` (the default) refuses the request with a `503` and a `Retry-After`, `open` serves it uncounted. Either way it is logged, at most once every ten seconds.

## Request ids, headers and logs

- `X-Request-Id` is accepted from the client or generated, exposed as `req.id`, echoed on every answer and written in every log line of the request, so a client can quote it in a bug report.
- [helmet](https://helmetjs.github.io/) sets the secure headers, with a Content Security Policy that lets Next, Turbopack and Vite hot reloading work in development (`unsafe-inline`, `unsafe-eval`, `ws:` and `blob:` there only) and no HSTS outside production. henri drops the `https:` wildcard helmet leaves in `style-src` and `font-src`, so a stylesheet or a font from elsewhere is an origin you name. `config.helmet` is merged over these options; `false` disables helmet. Its default `Cross-Origin-Opener-Policy: same-origin` blocks OAuth popups: override it there when you need them.
- `Permissions-Policy` denies the powerful browser features (camera, microphone, geolocation, payment, and the rest) for every application, since a header that is absent grants them. Name the ones you use with `config.helmet.permissionsPolicy` (`"geolocation=(self)"`), or `false` to send no header. It is henri's own, not one of helmet's, and is taken out of the options before they reach helmet.
- `upgrade-insecure-requests` is sent only to requests that arrived over https (`req.secure`, which honours `trustProxy` and `X-Forwarded-Proto`). On a page served over plain http the directive would rewrite every later request to https, including the redirect a controller answers after a `POST`: the record is written, the browser fails to follow the redirect, and the page never updates. Add it through `config.helmet` if you want it on http too.
- `config.filterParameters` (`password`, `token`, `secret`, `authorization`, matched as substrings like Rails' `filter_parameters`) are masked in everything `henri.pen` prints, query strings included. `henri.pen.redact(object)` applies the same masking to your own output. Setting the list replaces the defaults, so one name is masked whatever it says: anything containing `encryption`, which is where the [key that opens the encrypted columns](/guides/encryption/) lives. What a line looks like, and what is never masked, is [Logs and error reporting](/guides/logs/).
- `config.bodyLimit` (`1mb`) bounds JSON and form bodies; `config.requestTimeout` (30 seconds) answers `503` to requests still running after it.

## Versioning

A client asking for `Accept: application/vnd.henri.v1+json` gets JSON and `req.apiVersion` is `'v1'` (`null` otherwise). A route with `version: 'v1'` refuses other versions with a `406`. Put versioned routes under a `scope`:

```js
module.exports = {
  'resources artworks': {
    controller: 'artworks',
    scope: 'api/v1',
    version: 'v1',
  },
};
```

## Health checks

Liveness and readiness are different questions with opposite consequences — a failed liveness probe restarts the container, a failed readiness probe takes it out of the load balancer — so henri answers them separately:

| Path                 | Question                | Answer                                                                                                                                      |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /livez`         | Is the process running? | Always `200` while it can answer. It never touches a store: a database outage must not restart a process that is otherwise healthy.         |
| `GET /readyz`        | Can it serve traffic?   | `200`, or `503` while the boot is still running, while the process is shutting down, and when a store fails or takes more than two seconds. |
| `GET /healthz`       | The same as `/readyz`   | The older, ambiguous name, answered as readiness for a proxy that only knows it.                                                            |
| `GET /_henri/health` | The same as `/readyz`   | Kept as an alias, so a deployment already pointing at it keeps working.                                                                     |

```json
{
  "status": "ok",
  "stores": { "default": { "adapter": "drizzle", "ok": true, "latency": 2 } },
  "shared": { "adapter": "redis", "ok": true, "latency": 1 },
  "uptime": 42
}
```

A `503` says `"status": "unavailable"` and a `reason` (`starting`, `shutting down`, `a store did not answer`, `the shared store did not answer`); a store that failed is `{ "adapter": "drizzle", "ok": false, "error": "timeout" }` — `timeout` or `unreachable`, never the driver's own message, which carries the connection string it could not reach. The message is in the log.

`shared` only appears when [`config.shared`](/configuration/#the-shared-object) names one. A process whose counters cannot be counted is not ready either: with the default `onError: "closed"` it refuses every rate limited or idempotent request, so it should leave the load balancer until the store is back.

All four run before the session and the limiters — and before the router, so an application route on one of those paths never sees the request — unauthenticated, so a load balancer can call them freely: it has no credentials.

`/healthz` is the ambiguous one: the name says "health" without saying which of the two questions it answers, so one deployment wires it to liveness and the next to readiness. henri answers readiness there, which is what `/_henri/health` has always done and the safer of the two guesses. Point a liveness probe at `/livez` and leave `/healthz` to whatever cannot be configured.

## Graceful shutdown

On `SIGINT` or `SIGTERM` the server drains before the modules stop, so a rolling deploy does not cut a request in half:

1. Readiness answers `503` while the port is still open, so a load balancer that polls has a chance to stop sending. `shutdown.delay` (`0`) keeps serving that long before the next step.
2. The listener closes — the port stops accepting — and the idle keep-alive sockets are hung up, which is what would otherwise hold the close open for their whole idle timeout.
3. The requests in flight run to their end, up to `shutdown.drain` (10 seconds). What is still open then is destroyed, and the log says how many.
4. `henri.stop()` stops the modules, backwards; the process exits with `1` when one of them failed.

`shutdown.signals: false` leaves the signals to your application, which then calls `henri.server.shutdown('SIGTERM')` itself. A `henri jobs` runner never listens on a port and drains its own way: it stops claiming, finishes the jobs it holds and writes their outcomes. See [Shutdown](/configuration/#shutdown).

## The description of it all

`henri openapi` writes the [OpenAPI 3.1 description](/guides/openapi/) of everything on this page for one application: its routes, its HAL envelopes, its error bodies, the statuses each guard answers and the endpoints henri mounts. It is generated from the routes and the models, and it says in the document itself where henri cannot know what a controller answers.

## Middleware order

Knowing the order helps when adding your own with `henri.addMiddleware()`: request id, timeout, helmet, compression (production), cors, body parsers, cookies, `res.boom`, the API version reader, `req.pagination`, the health endpoints, static files, then the user module (permit, session, passport, CSRF), the authentication and global limiters, the router (per route: version guard, route limiter, role guard, idempotency, HAL guard, the action), the `404` and the error handler.
