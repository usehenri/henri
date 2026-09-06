---
title: Telemetry
description: henri traces the boundaries it already knows — the request, the boot, a store call, a view render, a mail send, a job, a webhook delivery — through @opentelemetry/api, which is a peer dependency. henri ships no SDK and no exporter.
sidebar:
  order: 12
---

A log line says what happened. `henri.reporter` says what failed. `henri.analyze()` says what the boot did. None of them says where the time went inside one request, and none of them follows that request into the queue, the mail transport or a webhook receiver.

That is what a trace is for, and henri emits one through [OpenTelemetry](https://opentelemetry.io) — the interface, and only the interface.

## What henri ships, and what it does not

henri ships **the instrumentation**: a span per request named for its route pattern, a child where henri already knows a boundary, a few metrics, and W3C trace context in and out.

henri ships **no SDK, no exporter, no sampler, no resource and no collector address**. Those belong to the deployment, which knows the service name, the environment, where the collector is and how much of the traffic it can afford to keep. `@opentelemetry/api` is an **optional peer dependency**, and an application that does not install it pays nothing at all: the middleware is not mounted, the store adapter is not wrapped, no instrument is created, and the package is never even required. There is no boot line, because there is nothing to say.

## The smallest thing that works

Two packages and one file:

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/exporter-trace-otlp-http
```

```js
// telemetry.js -- loaded before henri, so the SDK is registered first
const { NodeSDK } = require('@opentelemetry/sdk-node');
const {
  OTLPTraceExporter,
} = require('@opentelemetry/exporter-trace-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ 'service.name': 'lineup' }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),
});

sdk.start();

process.once('SIGTERM', () => sdk.shutdown());
```

```bash
node --require ./telemetry.js node_modules/.bin/henri server
```

That is the whole integration. `NodeSDK` registers the tracer provider, the W3C propagator and the `AsyncLocalStorage` context manager; henri finds them through the api's global registry and starts emitting.

**The context manager matters.** Without one, `@opentelemetry/api` runs every callback in the root context, so henri's children — a store call inside a request, a delivery inside a job — come out as separate root spans instead of nesting. Every SDK bootstrap registers one; a hand-rolled provider has to as well.

You do not have to use `NodeSDK`. Any provider registered on `@opentelemetry/api` works, including the ones a vendor's agent installs for you.

## What a span carries

The rule is [the error reporter's](/guides/logs/#what-the-handler-gets), word for word, because **a span attribute is a log field with a different name on it**: everything henri adds is either henri's own or an identifier that means nothing on its own.

```
GET /artworks/:id
  http.request.method        GET
  http.route                 /artworks/:id
  http.response.status_code  200
  henri.request_id           0f7c9b5a-8b6d-4a1e-9f3c-1a2b4d5e6f70
```

Four attributes, and that is the list. Nothing that came from the client is in a span: **no url, no path, no query string, no body, no parameters, no headers, no cookies, no session, no user, no SQL text, no mail recipient, no job arguments and no webhook body.** The span is named for the method until the router has matched and for the route _pattern_ afterwards — a span named for a url is a cardinality accident, and a span named for a url with an identifier in it is a leak.

This is a **deliberate departure from the HTTP semantic conventions**, which ask a server span for `url.path` and offer `url.query`, `client.address` and `user_agent.original` beside it. henri does not send them, for the reason the reporter gives: `/users/ada@example.com` is a path in some applications and a personal field in all of them, and a trace backend is one more place it would then live.

An application that wants them adds them itself, having decided that for its own paths:

```js
henri.telemetry.span(
  'artworks.import',
  { attributes: { 'app.source': source, 'app.rows': rows.length } },
  () => importer.run(rows)
);
```

Attributes an application passes go through **the masking of a log line** — `filterParameters` as substrings, the fields the models marked `personal` exactly — so a field called `email` comes out `[FILTERED]` whether it reaches a log or a trace. A value a span cannot carry (an object, a `NaN`, a mixed list) is dropped rather than stringified.

The one thing henri hands over untouched is an **error**: `recordException()` gets the application's own, because a framework that rewrote it would be recording something that never happened.

## The boundaries

| Boundary   | Span                    | Where                                            |
| ---------- | ----------------------- | ------------------------------------------------ |
| `http`     | `<METHOD> <route>`      | one per request, kind `server`                   |
| `boot`     | `henri.boot`            | plus `henri.module <name>` per module            |
| `stores`   | `henri.store.query`     | `adapter.query()`, the raw SQL henri runs itself |
| `views`    | `henri.view.render`     | `res.render()` reaching the view engine          |
| `mail`     | `henri.mail.deliver`    | `henri.mail.send()`                              |
| `jobs`     | `henri.job <name>`      | one per attempt, in `@usehenri/jobs`             |
| `webhooks` | `henri.webhook.deliver` | one per attempt, in `@usehenri/webhooks`         |

`telemetry.spans` takes `"all"` (the default), `false`, or the list.

**The boot span is written after the boot, not during it.** `henri.analyze()` already measures the order, the timings and what each module waited on; the spans are reconstructed from it afterwards with explicit start and end times. Nothing is timed twice and nothing runs while henri is starting. A boot that failed is emitted too, with the module that failed carrying the error — which is the boot worth having a trace of.

**A model call your application makes is not a boundary.** `Artwork.find()` does not get a span, and henri will not grow one: covering it means wrapping Drizzle, Mongoose or Sequelize from the outside, which is what their own instrumentation packages exist for. Register one in the same SDK bootstrap and its spans land under henri's request span, because the context is already active:

```js
const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');

const sdk = new NodeSDK({
  instrumentations: [new PgInstrumentation()],
  // ...
});
```

`henri.store.query` covers what henri runs on its own behalf: the queue's claim, the trail's insert, a webhook lookup. The statement is not an attribute — it carries values.

## Trace context, and which identifier wins

An incoming `traceparent` is honoured, so a request that arrives inside somebody else's trace continues it rather than starting a second one. Outgoing, henri writes one onto the requests it makes for you — today, a webhook delivery, where it names the delivery attempt the receiver is answering. `telemetry.propagate: false` stops the writing; an incoming header is always honoured.

`traceparent` and `X-Request-Id` are both present on a well-run request, and **neither is derived from the other**:

- **`traceparent` decides the trace.** It is a caller's statement about a span it has already created. Inventing a trace id from a request id would orphan the parent that is waiting for us.
- **`X-Request-Id` decides the request id**, as it always has. It is what a load balancer stamped and what every `pen` line already carries.

The span carries the request id as `henri.request_id`, which is the join between the two: find a log line, search the trace backend for that value, and you have the trace.

henri does **not** fall back to the trace id when no `X-Request-Id` arrives. A trace usually spans several requests, so a trace id is not unique per request, and using it would quietly merge two requests' logs into one.

henri does **not** write `traceparent` onto the response either. It would hand an internal identifier to whoever asked, and `X-Request-Id` — which henri already returns — is enough to find the trace from a log line.

## Metrics

A log line already carries what happened. A metric earns its place only when the answer is a rate or a distribution nobody can compute from lines:

| Instrument                     | Kind               | By                    |
| ------------------------------ | ------------------ | --------------------- |
| `http.server.request.duration` | histogram, seconds | method, route, status |
| `henri.jobs.queue.depth`       | observable gauge   | queue, state          |
| `henri.jobs.claim.duration`    | histogram, seconds | how many were claimed |
| `henri.cache.operations`       | observable counter | outcome               |

There is no request **counter**: the histogram's count is the request count, and the same number twice is two things to keep in step. The cache's hit rate is `hits / (hits + misses)`, computed where it is read — a rate henri averaged would be an average of averages.

The last two are free while a request runs: they are **observable** instruments, so nothing is recorded on the hot path and the callback reads counters that already existed. The queue depth does cost one `SELECT ... GROUP BY` per collection, which is what `telemetry.metrics: false` turns off.

An SDK reads them only when a metric reader is registered:

```js
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const {
  OTLPMetricExporter,
} = require('@opentelemetry/exporter-metrics-otlp-http');

const sdk = new NodeSDK({
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
  // ...
});
```

## When the exporter is down, or slow

The cache's rule is the precedent: a backend that is down is a miss, because a cache holds no truth. A tracer that is down is a **dropped span**, because a trace is not the request. henri makes that true by owning none of the pipeline:

- **Nothing is ever awaited.** `span.end()` hands the span to the SDK's span processor and returns. henri never calls `forceFlush()`, never waits on an export and never joins the SDK's shutdown.
- **Nothing is buffered in henri.** There is no queue here, no map of open spans, no retry: the only reference to a span is the local variable of the operation that made it, and every one of them ends in a `finally` or when the response closes. Use a `BatchSpanProcessor` — the `NodeSDK` default — and its bounded queue is where a slow exporter is absorbed, by dropping, which is the SDK's documented behaviour. A `SimpleSpanProcessor` in front of a slow exporter is the one way to make this grow, and that is a choice made in your bootstrap.
- **A sampler is yours.** henri never sets one. When yours says no, the api answers a non-recording span whose `setAttribute` and `end` do nothing, so 1% sampling is a 1% cost.
- **A tracer that throws cannot fail a request.** Every call into the api is guarded. The first failures are logged; after five, telemetry turns itself off for the life of the process and says so once. Instrumentation that is misbehaving is worth less than the traffic it is instrumenting.

## What it costs

Measured on this codebase, an empty JSON route, 30 000 requests, 8 in flight, median of 5 runs:

| Case                               | Per request               |
| ---------------------------------- | ------------------------- |
| `@opentelemetry/api` not installed | the baseline: **nothing** |
| installed, no SDK registered       | +1.3 to 2.2 µs            |
| installed, exporting               | +2.4 to 4.6 µs            |

"Nothing" is not a rounding: with no api there is no middleware in the express stack, no wrapper on the adapter, no instrument and no `require`. There is nothing to measure because there is nothing there.

One `henri.telemetry.span()` call costs ~290 ns when the tracer is off or the boundary is not instrumented (that is the argument check), and ~1.1 µs when a span is really made. The one place that could matter is a store call, and it is wrapped only when `stores` is in `telemetry.spans` — so an application that is not tracing its store pays nothing per query, rather than a test per query.

## `henri.telemetry`

Always there, always safe to call, whether or not the api is installed.

```js
// Runs fn inside a span, or just runs fn
await henri.telemetry.span('artworks.import', { attributes }, () => work());

// Is anything listening?
henri.telemetry.enabled; // false without @opentelemetry/api
henri.telemetry.spans; // ['boot', 'http', 'jobs', ...]
henri.telemetry.on('stores'); // is that boundary instrumented?

// traceparent onto an outgoing request of your own
await fetch(url, { headers: henri.telemetry.inject({ accept: 'json' }) });

// Your own instruments
const size = henri.telemetry.histogram('app.import.rows', { unit: '{row}' });

size.record(rows.length, { 'app.source': source });

henri.telemetry.observe(
  'app.tenants.active',
  { kind: 'gauge', unit: '{tenant}' },
  (observe) => observe(tenants.size)
);
```

`histogram()` always answers a recorder — with the metrics off, `record()` does nothing — so a call site never has to branch.

## Configuration

```json
{
  "telemetry": {
    "metrics": true,
    "propagate": true,
    "spans": ["http", "jobs", "stores"]
  }
}
```

| Key         | Default | What it does                                                                                                                                            |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`   |         | Absent: on when `@opentelemetry/api` is installed. `true`: the application requires it, and a boot without it fails with `HENRI_TELEMETRY_UNAVAILABLE`. |
| `metrics`   | `true`  | Register the instruments.                                                                                                                               |
| `propagate` | `true`  | Write `traceparent` onto the requests henri makes for you. Incoming is always honoured.                                                                 |
| `spans`     | `"all"` | `"all"`, `false`, or the list of boundaries.                                                                                                            |

`"telemetry": false` instruments nothing and never looks for the package.

`henri doctor` reports `deps.declared` when `enabled` is `true` and `@opentelemetry/api` is in no `package.json`, so the boot failure is one a check catches first.

`config.telemetry` is read once, at boot: telemetry is the one module a reload leaves alone, because an observable instrument is registered by name against a process-wide meter and rebuilding it would count everything twice.

## What this is not

- **Not an SDK.** henri configures no exporter, no endpoint, no sampler, no resource and no batching. Two frameworks disagreeing about which collector to talk to is worse than one of them staying out of it.
- **Not ORM instrumentation.** See above: that is `@opentelemetry/instrumentation-*`, in your bootstrap, and it composes with this.
- **Not logs or events.** henri emits spans and metrics. The OpenTelemetry logs signal is not wired up; `config.logs.format` already writes structured lines with the request id in them, and correlating on `henri.request_id` is the join.
- **Not trace context through the queue.** A job's span is a root span, not a child of whatever enqueued it. Carrying trace context on a queue row means storing it, migrating a column for it and deciding what a three-day-old parent means; the request that enqueued the job is findable by its request id in the meantime.
- **Not a failed span for a failed job.** The queue catches the error itself, retries it and, in the end, writes the dead letter row that holds the arguments, every attempt and the stack. That row is the durable record — the same reason the reporter gives for not reporting a dead job — and a thinner copy of it in a trace backend would be one more thing to keep in step.
- **Not a status attribute on a webhook delivery span.** A failed delivery throws, so the span is red and carries the error; the receiver's status code is in the message and in `henri jobs:show`.
