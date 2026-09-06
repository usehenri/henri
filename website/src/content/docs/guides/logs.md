---
title: Logs and error reporting
description: config.logs.format writes one json object per line — the time, the level, the module, the request id and the masked fields — and henri.reporter.onError() is the one place an application hears about every failure henri catches.
sidebar:
  order: 12
---

`henri.pen` writes for a person: aligned module names, colours, a pencil, `+3ms` since the last line. That is the right output when somebody is watching a terminal, and the wrong one everywhere an application actually runs — nothing can index it, no field can be queried, and an alert on "the boot failed" has to match a substring of a coloured string.

Two things follow from that, and they are the whole of this page: a format a machine reads, and a seam an application plugs its error reporter into.

## `logs.format`

```json
{
  "logs": { "format": "json" }
}
```

| Value      | What is written                                       |
| ---------- | ----------------------------------------------------- |
| `"auto"`   | the default: `json` in production, `pretty` elsewhere |
| `"pretty"` | the aligned, coloured lines `pen` has always written  |
| `"json"`   | one JSON object per line, on stdout                   |

The default is per environment, and deliberately not per terminal. Production is the one environment where nobody is watching: the output goes to a collector, and the fields are worth more than the alignment. Everywhere else a person is reading, which is why `pen` exists at all. henri does **not** sniff whether stdout is a tty to decide — a container writes to a pipe and so does a development server behind a process manager, so a format that changed with how the process happened to be started is one nobody could rely on.

Nothing else changes. Every `pen.info` / `warn` / `error` / `fatal` call site keeps working, the levels are the same, and `pretty` is byte for byte what it was.

## The line

```json
{
  "time": "2026-09-06T12:00:00.000Z",
  "level": "info",
  "module": "router",
  "requestId": "0f7c9b5a-8b6d-4a1e-9f3c-1a2b4d5e6f70",
  "msg": "GET /artworks 200",
  "data": [{ "page": 2, "perPage": 25 }]
}
```

| Field       | What it is                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `time`      | ISO 8601, UTC. The pretty format prints a local clock time and a relative `+3ms`, neither of which sorts across machines. |
| `level`     | `error`, `warn`, `info`, `verbose`, `debug`, `silly` — pen's own levels, unchanged.                                       |
| `module`    | the first argument of every `pen` call, which is what the pretty format pads and colours.                                 |
| `requestId` | the `X-Request-Id` of the request being handled, in full. Absent outside a request.                                       |
| `msg`       | every string-ish argument, joined with a space.                                                                           |
| `data`      | every object argument, **masked** — always a list, even for one object.                                                   |
| `err`       | the first `Error` argument: `name`, `message`, `code`, `stack` and its `cause` chain, up to four deep.                    |

Nothing else. No hostname, no pid, no version: whatever runs the process knows those better than henri does, and one more guessed field is one more thing a collector has to reconcile.

A failure keeps its [error code](/reference/errors/), which is the field to alert on:

```json
{
  "time": "2026-09-06T12:00:00.000Z",
  "level": "error",
  "module": "config",
  "msg": "",
  "err": {
    "name": "Error",
    "message": "henri - unable to execute init(): no store adapter for \"mongoose\"",
    "code": "HENRI_BOOT_FAILED",
    "stack": "Error: henri - unable to execute init()…",
    "cause": {
      "name": "Error",
      "code": "HENRI_MODEL_NO_ADAPTER",
      "message": "…"
    }
  }
}
```

```bash
# what failed, everywhere, without reading a stack
node server.js | jq -r 'select(.err) | [.time, .err.code, .err.message] | @tsv'
```

### Masking is not optional

Every object that becomes a field goes through the same masking the pretty output has always applied, at every depth: [`filterParameters`](/configuration/#headers-logs-and-limits) as substrings (`password`, `token`, `secret`, `authorization` by default), and the fields the models marked [`personal`](/guides/privacy/) matched exactly.

```js
henri.pen.info('signup', {
  user: { email: 'ada@example.com', password: 'hunter2' },
});
```

```json
{
  "…": "…",
  "data": [{ "user": { "email": "[FILTERED]", "password": "[FILTERED]" } }]
}
```

That is the whole risk of structured logs, said out loud: a logger is a machine for faithfully serializing whatever object it was handed, and the pretty format used to summarize that object into a line nobody parsed. Three consequences worth knowing:

- `filterParameters: false` masks nothing **by name** — in both formats, as it always has, with the one exception below. The `personal` marks are separate and still hold, so a field a model called personal stays masked even then.
- One name is masked whatever `filterParameters` says, `false` included: anything containing `encryption`. Setting the list _replaces_ the defaults, so an application that adds `apiKey` to it would otherwise take the protection off the key that opens every [encrypted column](/guides/encryption/) — and logging your own configuration is the ordinary way that object reaches `pen`. It is a substring, so it masks the whole `encryption` block rather than one name inside it, and it masks an `encryptionStatus` field along the way. There is no setting that turns it off.

  ```js
  henri.pen.info('boot', henri.config.get());
  // { "…": "…", "data": [{ "encryption": "[FILTERED]", "port": 3000 }] }
  ```

- A _message_ is not masked, in either format. henri does not write most of them and cannot know what a call site put in a string; fields are what changes when the output becomes structured, so fields are what the rule governs. A string you build yourself is yours to keep clean.

## `henri.reporter`

The other half. henri catches failures and tells nobody: a module that will not start fails the boot and prints a stack, a request that throws gets a 500 and a log line, a rejection nobody handled reaches `pen.fatal`. `henri.reporter` is the one place to hear about all three.

```js
// app/modules/reporting.js
const Module = require('@usehenri/core/module');
const Sentry = require('@sentry/node');

module.exports = class Reporting extends Module {
  constructor() {
    super();
    this.name = 'reporting';
    this.runlevel = 0;
  }

  init() {
    Sentry.init({ dsn: process.env.SENTRY_DSN });

    this.henri.reporter.onError(({ code, error, request, requestId, source }) =>
      Sentry.captureException(error, {
        tags: { code, source, requestId },
        extra: request,
      })
    );

    return this.name;
  }
};
```

It is the shape `henri.mailers.onDeliverLater()` already established: one handler, registered by a call, replaced by another call, removed with `null`. Register it in a module at `runlevel: 0` and a module that fails at runlevel 3 is reported — the reporter itself is built with the instance, before the module graph exists, because the first failure worth reporting is a module that would not start.

### What the handler gets

```js
{
  (at, code, error, meta, request, requestId, source);
}
```

| Field       | What it is                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `at`        | a `Date`.                                                                                          |
| `code`      | the [error code](/reference/errors/) of the failure, walking `cause`; `null` when it carries none. |
| `error`     | the error itself, untouched.                                                                       |
| `meta`      | what `report()` was called with, masked like a log line. Absent otherwise.                         |
| `request`   | `{ method, route, status }` — the route _pattern_, `/artworks/:id`. `null` outside a request.      |
| `requestId` | the `X-Request-Id`, `null` outside a request.                                                      |
| `source`    | `'boot'`, `'request'`, `'rejection'` or `'application'`.                                           |

And what it never gets, which is the part worth reading twice: **nothing that came from the client and nothing about a person.** No url, no query string, no body, no params, no headers, no cookies, no session and no user. The method, the route pattern and the status are what henri chose; the path is not, because `/users/ada@example.com` is a path in some applications and a personal field in all of them. If you want the record, you have the request id and your own logs.

That includes **the client's address**, which is deliberately not in a
report and is not going to be: the property that makes a handler safe to
point at a third-party error service is that henri hands it nothing the
client chose, and an address is from the client. Where a request came from
is recorded, under rules of its own, by [the call
log](/guides/calls/#the-clients-address), and the request id joins the two.

The two deliberate exceptions:

- `error` is handed over as it is. A reporter exists for the stack, and a framework that rewrote your Error would be reporting something that never happened. What an error carries is your business; what henri _adds_ is what the rule governs.
- `meta` is yours, and it is masked anyway — so an application that hands `report()` a request body still does not send one out.

### Where a report comes from

| `source`      | When                                               | Awaited?                                      |
| ------------- | -------------------------------------------------- | --------------------------------------------- |
| `boot`        | `henri.init()` rejected                            | yes, bounded — the process usually exits next |
| `request`     | `base/http.js` answered a 5xx                      | no — a request is never held for a reporter   |
| `rejection`   | `unhandledRejection`                               | no                                            |
| `application` | you called `henri.reporter.report(error, options)` | up to you                                     |

Once each, and once per error: the same `Error` object is never reported twice, so a failure that travels through two of those paths is one report. A **4xx is not reported** — it is an answer, not a failure.

The **request timeout** does not report. It answers a 503 from its own middleware because a deadline passed, and there is no error to hand anybody — the handler is still running, and a fabricated Error would be reporting something that did not happen.

`pen.fatal()` does not report. It returns an Error for the caller to throw, and whoever throws it is the one who knows whether it ends a boot, a request, or nothing at all.

A **dead job does not report** either. `@usehenri/jobs` buries a job in its own [dead letter queue](/guides/jobs/#retries-and-the-dead-letter-queue) with the arguments, every attempt and the error; that row is durable and `henri jobs:dead` reads it back, so a second copy in a reporter would be one more thing to keep in step. What would change it is one call where the queue buries a row — the payload of a job is application data, so what of it may leave the process is that package's decision to make.

### A handler is not trusted

It is somebody else's network call in the middle of a failure:

- `report()` never throws and never rejects.
- A handler that throws is logged (`reporter the error handler threw …`) and forgotten.
- A handler that hangs is left running; `report()` gives up on it after two seconds, so the boot waits at most that long and a request never waited at all.
- No handler at all costs a property read: no payload is built and nothing is masked.

### Reporting your own

```js
try {
  await charge(invoice);
} catch (error) {
  await henri.reporter.report(error, { meta: { invoice: invoice.externalId } });
  throw error;
}
```

`source` is `'application'`, `meta` is masked, and the request id is filled in from the request being handled.

## What this is not

A vendor integration: there is no `@usehenri/sentry` here, and there will not be one. A log format and a one-function seam are what a framework owes an application, and they are what those sit on when somebody wants them.

It is not tracing either. Spans are [Telemetry](/guides/telemetry/), which sits on the same rule about what may leave the process -- `requestOf()` is literally the same function -- and joins to these lines through `henri.request_id`.
