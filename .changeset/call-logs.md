---
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/webhooks': minor
'@usehenri/drizzle': patch
---

Call logs, inbound and outbound: `henri.calls`.

Two records joined by the request id henri already threads through everything — the call an application answered, and every call it made because of it — so that "what happened during request `X`" is one question with one answer:

```bash
henri calls 018f5c2e-1f2a-7c31-9f0a-2b7c1d3e4f56
```

```
  2026-09-06T14:22:31.004Z  <- 201        84ms  POST   /orders
  2026-09-06T14:22:31.019Z  -> 200        41ms  POST   https://api.billing.test/v1/charges
                              service billing
  2026-09-06T14:22:31.062Z  -> 200        12ms  POST   https://hooks.example.test/orders
                              service webhooks
```

Both directions live in one table henri owns (`henri_calls`, a `direction` column), reached through the store adapter's `query()` or a MongoDB collection the way the access trail reaches its own. One table rather than two because the join is the whole point: one `SELECT` on one index instead of two reads and a merge.

**It is the deliberate opposite of the access trail, and the guide says so in its first paragraph.** The trail records field _names_, counts and digests and refuses a value; it is hash-chained evidence kept for a year. A call log holds **values** — the body that came in, the body that went out — because one that does not is a slower copy of the web server's access log. It is a debugging instrument: sampled, capped, kept for thirty days, and never evidence of anything. Neither substitutes for the other.

Four bounds keep it from being a denial of service, and each of them is a decision rather than a default:

- **Off unless configured.** No `config.calls`, no table, no middleware, no allocation. When it is on, the middleware is mounted right after the request id and before everything else, so a request refused by the rate limit, the body parser or the CSRF check — exactly the one worth having — is in the log.
- **The write never blocks the answer.** A finished call goes onto a bounded buffer and the response goes out; a timer writes with one multi-row `INSERT`. A flush that fails is reported once and dropped rather than retried, because a call log that can fail a request turns a database hiccup into an outage. What the buffer drops is counted, and `henri calls:stats` says so.
- **The payload is capped before it is stored** (`calls.maxBody`, 8kb, with a truncation marker), and only a body henri can _walk_ is stored at all — a plain object or an array is redacted key by key, a string, a buffer or an HTML page is a size and a shape. That is why the response body is taken from `res.json(value)` rather than off the socket.
- **What one client can cause is bounded twice.** `calls.sample` bounds the steady state proportionally; `calls.maxPerSecond` is an absolute per-process ceiling, because one percent of a million requests a second is still ten thousand rows a second. The sampling decision is a hash of the request id **seeded with `config.secret`**: a hash so the inbound call and every outbound call it caused agree in every process without carrying state, and seeded because the request id comes from a header a client chooses. `calls.always` keeps the failures sampling dropped, without their bodies.

It holds values, so the redaction is the feature. Everything stored goes through the redactor of `config.filterParameters` and the `personal` marks, at every depth, and on top of that `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-csrf-token`, `x-api-key` and `webhook-signature` are masked whatever the configuration says, a url loses its userinfo, and the person is their `externalId` and never an address.

`calls.keep` (30 days) is pruned by the retention sweep, and **where the dialect has range partitions it drops periods instead of rows**: `calls.partition: "day"` on PostgreSQL and MySQL makes the sweep a metadata operation whatever the table held, which is the difference between a sweep that works at ten million rows and one that times out. There is always a catch-all partition, so no row is ever refused for want of one. sqlite, SQL Server and MongoDB have no ranges and get a bounded delete loop; asking them to partition fails the boot rather than being ignored.

henri wraps nobody's HTTP client: `henri.calls.track()` and `henri.calls.outbound()` are the seam, two lines around whatever an application already uses. The calls henri makes itself are populated without anything to write — every mail send, and every webhook delivery attempt, whose request id is stamped into the delivery job at `emit()` time so a delivery three retries later still joins the request that caused it.

`henri calls [<request-id>]`, `henri calls:stats` and `henri calls:sweep --yes` are the commands, `config.calls` is the configuration, and the guide is [Call logs](https://usehenri.io/guides/calls/).
