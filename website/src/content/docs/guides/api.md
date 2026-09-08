---
title: JSON API
description: HAL answers with res.resource and res.collection, embedded relations, streamed CSV exports, pagination, Idempotency-Key, rate limiting, request ids, versioning, the health endpoints and graceful shutdown.
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

Routes expanded from `resources` and `crud` are expected to answer HAL: a JSON answer without `_links` on one of them is reported once per route in the log, and refused with a `500` when `config.api.strict` is `true` — which is also what refuses an answer that does not match what the action [declared it answers](/guides/controllers/#answers-what-an-action-answers). The page object the [Inertia](/guides/views/#inertia) engine answers a client-side visit with (`X-Inertia`) is a rendered page, not an API answer, and is never checked. `henri generate scaffold` and `henri generate crud` write controllers in the shape above, and `henri generate test <name>` asserts the links when the name has a `resources` or `crud` route.

## Pagination

`req.pagination()` reads `?page=` and `?per_page=` and returns `{ page, perPage, skip, limit, offset }`, defaulting to `config.api.perPage` (25) and capped at `config.api.maxPerPage` (100). Pass `page`, `perPage` and `total` to `res.collection()` and the paging links are computed for you.

[`Model.paginate()`](/guides/models/#pagination) is the other half: `await Task.paginate(req.pagination())` answers `{ records, page, perPage, total, pages }` on every adapter, so an index action is one query instead of a find and a count.

The paging links are built from the url as it was requested and only ever set `page` and `per_page`, so everything else it carries — a filter, a sort — rides along and page two of a filtered list is page two of the same list.

## Filtering and sorting

An index action declares what a client may narrow and order its list by, in a `filters` block next to `params`, and everything else is a `422` before the action runs:

```js
filters: {
  index: {
    where: { state: { enum: ['submitted', 'accepted'], type: 'string' } },
    sort: ['submittedAt', 'title'],
    default: '-submittedAt',
  },
},

index: async (req, res) => {
  const { order, where } = await req.filters();
  const { page, perPage, records, total } = await Task.paginate({
    ...req.pagination(),
    order,
    where,
  });

  return res.collection(records, { page, perPage, total });
},
```

`?filter[state]=accepted&filter[submittedAt][gte]=2026-01-01&sort=-submittedAt` is the request. `req.filters()` intersects it with what [the policy says the list is](/guides/policies/#scoping-a-list), so a filter narrows a list and can never widen it, and it appends the record's `externalId` to the order so paging is exact. The whole of it — the operators, what can never be declared, and why a substring search is opt-in per field — is in [Filtering and sorting](/guides/filtering/).

## Embedding relations

A client that wants an invoice and its lines makes two requests, and a page of twenty invoices makes twenty one. `_embedded` is HAL's answer to that, and an action says what may go in it in an `embeds` block next to `params` and `filters`:

```js
// app/controllers/invoices.js
module.exports = {
  embeds: {
    show: {
      customer: 'customerId',
      lines: { limit: 200, through: 'Line.invoiceId' },
    },
    index: { customer: 'customerId' },
  },

  show: async (req, res) => res.resource(req.invoice, { embed: ['lines'] }),
};
```

A relation is written as **the foreign key it goes through**, because that is the only thing henri can check: `'customerId'` is a key this model declared and the record it names is embedded; `'Line.invoiceId'` is a key another model declared at this one and the records naming it are. Both have to be [declared references](/guides/models/#foreign-keys) — `belongsTo()`, `references: { model }`, Mongoose's `ref` — and anything else fails the boot, because henri reads no field name to decide what points where. `{ through, limit, one }` is the whole vocabulary: `limit` caps a list per record, and `one: true` says the other model holds at most one of them.

The answer carries them under `_embedded`, next to the record's own fields:

```json
{
  "_links": {
    "self": { "href": "/invoices/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11" }
  },
  "externalId": "0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11",
  "amount": "129.90",
  "customerId": "0199a5c2-8d21-7b04-9f3e-6c2b0d7a1e55",
  "_embedded": {
    "lines": [
      { "externalId": "0199a5c3-0f11-7c22-8a44-1d3e5b6c7d88", "label": "Seat" }
    ]
  }
}
```

**A client asks with `?embed=`**, and only for what the action declared: `GET /invoices?embed=customer` embeds it, `?embed=notes` is a `422` before the action runs, and at most `config.api.maxEmbeds` (3) relations may be asked for at once. `res.resource(record, { embed })` is the caller's word and wins over the query string; `embed: []` embeds nothing. An action with no `embeds` block has no such surface at all, so `?embed=` there is a query parameter nothing reads.

### What an embedded record is, exactly

The same thing `res.resource()` of that record would answer. The children are published and stripped in the **same call** as the records they hang off, so every rule that governs an answer governs an embedded one:

- foreign keys leave as the `externalId` of the row they name, at every depth, and no primary key leaves at all;
- a column marked `personal: { expose: false }` is dropped from an embedded record exactly as it is from the record itself — including on the [user model](/guides/privacy/), which is answered as the model left it rather than through `publicUser()`, so a field that must not leave says so on the model;
- the identifier lookups of the parents and the children are batched together, one statement per model for the whole answer.

**Every embedded record is asked `show` against its own model's [policy](/guides/policies/)**, one at a time, by the rule `_links` already follows: a model with a policy is asked about every record, a model with no policy is not asked at all. A record the policy refuses is **absent** — not a stub and not a `null`, because the request the client would otherwise have made would have been a `404`, and a `404` carries nothing.

### What it costs, and the bound

**One statement per relation per answer**, whatever the page size: the parents' keys are collected, deduplicated and asked for once (`WHERE invoice_id IN (...)`, `{ $in: [...] }` on MongoDB), then grouped in memory. Twenty invoices embedding their lines is one query for the twenty. henri does not reuse an association the controller eager loaded, because an eager loaded list honours neither the `limit` nor the order this promises — so a controller that eager loads _and_ embeds pays for both.

A list is capped per record at `limit`, or at `config.api.maxEmbedded` (25) when the declaration names none, and the rows come back ordered by the foreign key and then by the target's `externalId` (a uuid v7, so creation order), which makes the prefix a client gets the same prefix twice. `limit` is a promise about your data: a relation that holds more is reported once per route in the log and the client is served the prefix. It is not refused, even under `config.api.strict` — the answer is already built by then, and a request that fails because a customer has twenty six invoices instead of twenty five turns a cosmetic mistake into an outage. A relation that genuinely needs paging is a collection, and a collection has an endpoint of its own.

Deliberately not here: `_links` on an embedded record (nothing declares which controller serves a model, and a guessed href is worse than none), nesting (`?embed=lines.product`), embedding from `res.render()`, and filtering or ordering an embedded relation from the query string.

## Exporting a CSV

Every application grows an export endpoint, and the shape it grows is the same one every time: read the whole table, join the rows with commas, `res.send()`. That holds the file in memory, falls over on the row count that made anybody want an export, writes the primary key into the file, writes a column the model said must never leave, and hands a spreadsheet a cell that starts with `=`. `res.csv()` is henri's answer to all four:

```js
// app/controllers/invoices.js
report: async (req, res) => res.csv(Invoice, { filename: 'invoices' }),
```

**It streams.** There is no `Content-Length` — there is no number to put there without building the file first, which is the thing being avoided — so the answer is chunked, the rows are read a page at a time (`config.api.csv.batch`, 500) and `res.write()` returning `false` is awaited rather than ignored, so a slow client slows the reads instead of filling the process with a file nobody is taking.

The pages are a **cursor**, not an `OFFSET`: `WHERE externalId > :last ORDER BY externalId` (the primary key on a model that opted out of the public one). An offset over a table that is being written to skips rows and repeats rows, and an export that quietly drops a row is worse than no export. A uuid v7 is also creation order, so the file is in the order the records were made; a client's `sort` has no say, because an export is a dump rather than a page.

**The same exit gate.** Every page goes through the same `toPublic()` call `res.resource()` uses — publish, then strip — so a foreign key leaves as the `externalId` of the row it names, no primary key leaves at all, and a column marked `personal: { expose: false }` is not in the file. `include: ['phone']` is the same way back it is everywhere else. The columns are the **model's**, not the rows': the header comes from the schema plus what the adapter adds, minus what is hidden, so a file with no rows still has a header and two exports of the same model have the same columns whatever the rows happened to hold. `columns: ['title', 'amount']` narrows and reorders that list, and a name that is not one of them is refused before a byte is written.

**It is not a per-record authorization surface.** A hundred thousand rows are not a hundred thousand policy questions, so `res.csv()` takes the position `req.filters()` takes: the list is what [`policy.scope(user)`](/guides/policies/#scoping-a-list) says it is, asked for by default. Hand it a condition (`where`, usually what `req.filters()` answered) and it is intersected with the scope; an application whose export is genuinely everything says so once, with `scope: false`, and guards the route with `roles` instead.

### Escaping, and the fifth character

A cell is quoted when it holds a comma, a quote, a newline or a leading or trailing space, and a quote inside it is doubled — RFC 4180, written as a walk over the code points rather than as a pattern.

RFC 4180 says nothing about the fifth one. A cell whose text starts with `=`, `+`, `-`, `@`, a tab or a carriage return is a **formula** in Excel, Sheets and LibreOffice; `=cmd|'/c calc'!A1` is the famous one and `=IMPORTXML(...)` quietly posts the row it sits next to at a url of somebody else's choosing. henri writes such a cell as text — quoted, with a leading apostrophe — and the rule is narrow on purpose, because the false positive matters: `-1.5` starts with `-`, and an export where every negative number has been mangled is not an export. So only a value that **is a string** is considered (a number, a date, a boolean is text henri wrote itself), and a string that is a **plain number** is left alone. It does change the bytes, which is why `config.api.csv.formulas: false` turns it off for an export a machine reads.

### The bound, and what happens when something breaks

`config.api.csv.maxRows` (100000), checked with one `count()` **before the headers go out**, so an export too big to serve is a `413` carrying the bound and the number — an answer a client can narrow — rather than a file that stops in the middle.

Once bytes really are on the wire there is no status left to send. henri **destroys the connection** instead of ending the response: a truncated CSV is a valid CSV, and a consumer has to be able to tell a file that stopped early from a file that ended, so the terminating chunk is never written and every conforming client reports a transport error. The failure is logged with the row count reached and goes to [`henri.reporter`](/guides/logs/#henrireporter). That answer is blunt, so the other half of it is making it rare: the headers go out with the first **chunk** (64kb) rather than the first row, so an export smaller than that — which is most of them — has written nothing when it fails and still gets an ordinary `500`.

## Pushing to a client

The other answer that does not end: [`res.stream()`](/guides/streams/) is a server-sent event stream on the same http server, through the same session, role guard and policies. The policy is asked at subscribe time and again before every event, an event carrying a record leaves through the same `toPublic()` gate as everything on this page, and a broadcast reaches the subscribers of one process — which the guide says at the top, in a box.

## Idempotency

Clients retrying a `POST`, `PUT`, `PATCH` or `DELETE` send an `Idempotency-Key` header (1 to 255 printable ASCII characters, otherwise a `400` carrying `HENRI_API_IDEMPOTENCY_KEY_INVALID`), with the same semantics as Stripe:

| Situation                                       | Answer                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| First request with the key                      | Executed; status, headers and body stored for 24 hours           |
| Same key, same request, already answered        | The stored answer, with `Idempotency-Replayed: true`             |
| Same key, same request, still in flight         | `409` with `Retry-After: 1`, `HENRI_API_IDEMPOTENCY_IN_PROGRESS` |
| Same key, different method, path or body        | `422`, `HENRI_API_IDEMPOTENCY_KEY_REUSED`                        |
| First answer was a `5xx` or the request aborted | Nothing stored, the client may retry                             |

Keys are scoped to the user, the session or the ip, so two users may use the same key. Every mutating route from `config/routes.js` honours the header; `idempotent: false` on a route opts it out, and core's `/login` and `/logout` are never covered. `config.api.idempotency: false` turns the feature off.

The answers live in this process's memory unless the application says otherwise, which stops being idempotent the moment it runs two processes: [`config.shared`](/configuration/#the-shared-object) names one backend for these keys, the rate limit and the sign-in lockout at once. `config.api.idempotency.store` still names a module of its own (exporting `{ get, set, delete }`, or a `(henri, { name }) => store` factory) and still wins over it, and `henri.api.idempotencyStore` can be replaced after the boot.

A shared store that does not answer is the one case where the request is always refused — `503` with a `Retry-After` and `HENRI_STORE_SHARED_UNAVAILABLE`, whatever `shared.onError` says. Serving a mutating request whose first answer cannot be read is what the header exists to prevent.

## Rate limiting

Requests are limited with [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit), per user id when logged in and per ip otherwise (`trustProxy` decides which ip). The answer is a `429` from `res.boom.tooManyRequests` carrying `HENRI_API_RATE_LIMITED`, with `data: { limit, retryAfter, windowMs }` and the draft-7 `RateLimit`, `RateLimit-Policy` and `Retry-After` headers.

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
