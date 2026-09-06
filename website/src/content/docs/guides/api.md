---
title: JSON API
description: HAL answers with res.resource and res.collection, pagination, Idempotency-Key, rate limiting, request ids, versioning and the health check.
sidebar:
  order: 6
---

Every henri controller can answer JSON, and the answers follow the conventions a Rails API gives you: hypermedia links ([HAL](https://datatracker.ietf.org/doc/html/draft-kelly-json-hal)), idempotent mutations, rate limits, request ids, secure headers, filtered logs and a health check. Most of it is on by default and configured from `config/default.json`; the keys are listed in [Configuration](/configuration/#json-api).

## Answering HAL

`res.resource(record, options)` answers one record and `res.collection(records, options)` a page of them. Both send the public fields of the record and add `_links`, built from the route helpers of the controller and filtered by the roles of the current user: a visitor who may not `DELETE` never sees the `destroy` link.

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

The identifier is the record's `externalId`, the public one every model carries; the primary key stays on the server and is not in the payload. `res.resource()`, `res.collection()`, the `Location` header of a `201` and every href of `_links` are built from it. See [Identifiers](/guides/models/#identifiers).

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

Keys are scoped to the user, the session or the ip, so two users may use the same key. Every mutating route from `config/routes.js` honours the header; `idempotent: false` on a route opts it out, and core's `/login` and `/logout` are never covered. The answers live in memory by default: give `config.api.idempotency.store` the name of a module exporting `{ get, set, delete }` (or a `(henri, { name }) => store` factory) to share them between processes, or set `henri.api.idempotencyStore` from a custom module. `config.api.idempotency: false` turns the feature off.

## Rate limiting

Requests are limited with [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit), per user id when logged in and per ip otherwise (`trustProxy` decides which ip). The answer is a `429` from `res.boom.tooManyRequests` with `data: { limit, retryAfter, windowMs }` and the draft-7 `RateLimit`, `RateLimit-Policy` and `Retry-After` headers.

- Global: `config.rateLimit`, 600 requests per minute by default. It is not enforced in development, where the Next and Vite dev servers fetch hundreds of assets through the router; it is in test and production.
- Authentication: `config.rateLimit.auth`, 10 `POST` per minute per ip on the login path and on `/register`, `/signup`, `/password`, `/forgot-password` and `/reset-password` (`paths` overrides the list).
- Per route: `rateLimit: { windowMs, max }` in `config/routes.js`, always enforced.

`config.rateLimit: false` disables everything, `auth: false` only the authentication limiter. `config.rateLimit.store` names a module exporting an express-rate-limit `Store` (Redis, Memcached, ...) for several processes; in production a warning is logged when `trust proxy` is `true`, because a spoofed `X-Forwarded-For` then chooses the bucket.

## Request ids, headers and logs

- `X-Request-Id` is accepted from the client or generated, exposed as `req.id`, echoed on every answer and written in every log line of the request, so a client can quote it in a bug report.
- [helmet](https://helmetjs.github.io/) sets the secure headers, with a Content Security Policy that lets Next, Turbopack and Vite hot reloading work in development (`unsafe-inline`, `unsafe-eval`, `ws:` and `blob:` there only) and no HSTS outside production. henri drops the `https:` wildcard helmet leaves in `style-src` and `font-src`, so a stylesheet or a font from elsewhere is an origin you name. `config.helmet` is merged over these options; `false` disables helmet. Its default `Cross-Origin-Opener-Policy: same-origin` blocks OAuth popups: override it there when you need them.
- `Permissions-Policy` denies the powerful browser features (camera, microphone, geolocation, payment, and the rest) for every application, since a header that is absent grants them. Name the ones you use with `config.helmet.permissionsPolicy` (`"geolocation=(self)"`), or `false` to send no header. It is henri's own, not one of helmet's, and is taken out of the options before they reach helmet.
- `upgrade-insecure-requests` is sent only to requests that arrived over https (`req.secure`, which honours `trustProxy` and `X-Forwarded-Proto`). On a page served over plain http the directive would rewrite every later request to https, including the redirect a controller answers after a `POST`: the record is written, the browser fails to follow the redirect, and the page never updates. Add it through `config.helmet` if you want it on http too.
- `config.filterParameters` (`password`, `token`, `secret`, `authorization`, matched as substrings like Rails' `filter_parameters`) are masked in everything `henri.pen` prints, query strings included. `henri.pen.redact(object)` applies the same masking to your own output.
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

## Health check

`GET /_henri/health` pings every store and answers `200` with `{ "status": "ok", "stores": { "default": { "adapter": "disk", "ok": true, "latency": 2 } } }`, or `503` and `"status": "unavailable"` when one fails or takes more than two seconds. It runs before the session and the limiters, so a load balancer can call it freely.

## Middleware order

Knowing the order helps when adding your own with `henri.addMiddleware()`: request id, timeout, helmet, compression (production), cors, body parsers, cookies, `res.boom`, the API version reader, `req.pagination`, the health check, static files, then the user module (permit, session, passport, CSRF), the authentication and global limiters, the router (per route: version guard, route limiter, role guard, idempotency, HAL guard, the action), the `404` and the error handler.
