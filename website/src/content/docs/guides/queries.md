---
title: N+1 detection
description: Every adapter says what it ran, and the detector on top of it says which model call a request made forty times -- what an event carries, what it deliberately does not, and where a finding goes.
---

henri has `include()` and a guide that tells you to use it, and until now
nothing that _told_ you when you did not. The reason nobody outside henri
could write that check either was more basic: **no adapter emitted anything
when it ran a query**, so there was nothing to listen to.

There are two halves here, and they arrived in that order. `henri.queries` is
the seam: every adapter reports every model call. The N+1 detector is a
listener on it, on in development and in test, off in production.

```
$ henri server
  queries  counting model calls; the same call 5 times in one request is reported
...
    warn  queries  GET /proposals/:id  Track.findById ran 24 times at
                   app/controllers/ProposalsController.js:41 (18.3ms) --
                   load them together: one Track.find({ id: [...] }) for the
                   whole set, or include('track') on the query that fetched
                   the parents
```

## The seam is at the model call, not the statement

This is the design decision everything else follows from, so it is worth the
paragraph. There were two levels to instrument:

- **The statement** -- what the driver ran. Precise, and the number `EXPLAIN`
  would agree with.
- **The model call** -- what the application asked for. `Proposal.findById`,
  `Track.where(...)`, `User.paginate()`.

henri reports the **model call**, for three reasons.

First, it is the only level at which henri can give _advice_, which is the
whole value. A driver instrumentation can already tell you that forty
statements ran, and `@opentelemetry/instrumentation-pg` does it better than
henri would. Only henri knows that those forty statements were forty
`Proposal.findById` calls in one request and that one
`Proposal.find({ id: [...] })` replaces them.

Second, the statement count is not a number you can act on. `paginate()` is
two statements and one decision; on MySQL an insert is two statements and one
decision, because the dialect has no `RETURNING`. A threshold counting
statements would report those as repetition, and would make your database
dialect visible in a warning about your own code.

Third, and this is the measurement that settled it: **the classic Rails N+1
does not exist on the Drizzle adapter.** `include()` compiles to a single
correlated json subquery, not to a lazy association a loop can trip over. A
detector written to `bullet`'s mental model would walk a Drizzle application,
find no lazy association anywhere, and report success. What is left -- and
what is worth detecting on all three adapters -- is a loop issuing separate
`find`/`findById` calls for records it could have loaded together.

:::note[Say it once, plainly]
**The threshold counts model calls, never statements.** A person reading "40
queries" assumes the second one. `henri.queries` is a log of what your
application asked for, not of what your database did.
:::

## What an event carries

```js
{
  at: 1731000000000,        // when it finished, epoch ms
  store: 'default',
  adapter: 'drizzle',       // drizzle, mongoose, sequelize
  dialect: 'postgres',      // null on MongoDB
  model: 'Track',           // null for a raw adapter.query()
  operation: 'select',      // count delete insert other raw select update
  method: 'findById',       // the adapter's own word for it
  keys: ['id'],             // the filter's column NAMES
  shape: 'a1b2c3d4e5f6',    // what "the same call" means
  duration: 1.83,           // milliseconds
  rows: 1,                  // or null when it cannot be told
  requestId: '9f2c...',     // null outside a request
  source: 'application',    // or 'henri', for the framework's own calls
  callsite: { file: 'app/controllers/ProposalsController.js', line: 41, column: 12 }
}
```

`operation` is one closed vocabulary across the three adapters, so `select`
means the same thing on MongoDB and on PostgreSQL. `method` is the adapter's
own word, because that is the word you will search your own code for.

## What it deliberately does not carry

**No SQL.** At the model call there is none to carry -- the statement is
compiled after henri has already emitted -- and that is the happy half of the
decision. The unhappy half is why it would have been refused anyway:
**Sequelize's query generator interpolates values into the text it runs.**
`Model.findAll({ where: { name: 'ada' } })` reaches the driver as
`SELECT ... WHERE "name" = 'ada'`, with the value inside the string, on the
ordinary path. Drizzle parameterizes and Mongoose has no statement at all, so
a `sql` field would have been safe on two adapters and a copy of your rows on
the third -- which is worse than no field, because it is the leak nobody
would think to look for.

**No values, anywhere.** `keys` is column **names**, which is the rule
[the access trail](/guides/trail/) already established: a field name is
schema, in your model file and in your documentation; a field _value_ is
personal data. Every adapter hands its filter to henri and the values are
dropped before an event exists.

Also absent, on every adapter: the bound parameters, the rows that came back,
the attributes written, the person, the url, the path, the headers, the
session.

**One frame of stack, and that is code rather than data.** `callsite` is the
first frame belonging to your own files -- not `node_modules`, not henri, not
node internals. `bullet`'s value was never that it counted queries; it is
that it names the line.

## The join is the request id

An event carries `requestId` from the same `AsyncLocalStorage` that
[the call log](/guides/calls/) keys its rows by, that every `pen` line
carries, and that a [span](/guides/telemetry/) carries as
`henri.request_id`. One identifier: "what did request `X` do" is one filter
in four places.

It carries **no trace id**, and telemetry deliberately does **not** consume
this seam. Statements stay the driver's own instrumentation to trace -- henri
re-implementing that would double-count for any application that installed
`@opentelemetry/instrumentation-pg`, and henri would be the worse of the two.
`adapter.query()` is the one call site where both happen: it gets a span from
telemetry and an event from here, and no model call ever becomes a span.

Outside a request -- a job, `henri console`, the boot -- events are still
emitted and `requestId` is `null`. Nothing is _counted_ there, because "the
same request" is the whole predicate and there is no honest substitute.

## The detector

"The same query" cannot be a string comparison, because the values differ:
forty lookups of forty different ids are the N+1, and forty _identical_
lookups would be a caching bug instead. So the detector groups by `shape`, a
digest of (adapter, model, operation, the filter's key names). Forty
`Track.findById` are one shape with a count of forty; a page's own `find` and
its `count` are two shapes with a count of one each and are never reported.

A shape is counted **within one request** and nowhere else, on a bucket that
is born and collected with the request, so a background job's queries are
never pooled with a page's.

### Where a finding goes

Three destinations, each opting out on its own:

| Setting         | Default | What it does                                                                                                              |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `detect.log`    | `true`  | One `pen.warn` per request, at the end, naming the call, the count, the line and what to do instead.                      |
| `detect.header` | `true`  | `X-Henri-Queries: 47; n+1 Track.findById x24` on the answer, **development only**. Counts and names, never a value.       |
| `detect.raise`  | `false` | Throws `HENRI_QUERIES_N_PLUS_ONE` the moment the threshold is crossed, so the stack names the call that went one too far. |

The log is at the _end_ of the request because that is when the count is
final: a warning at the moment the threshold was crossed would say "5 times"
about something that ran forty. `raise` is the opposite on purpose -- the
point of raising is the stack.

`raise` is what turns this into a CI gate, the way `Bullet.raise = true` does
in a Rails suite:

```json
// config/test.json
{ "queries": { "detect": { "raise": true } } }
```

`henri audit` reports it in a production configuration
(`queries.raise-in-production`): failing a test suite on an N+1 is the point,
failing a real visitor's request is not.

**The reporter is deliberately not one of them.**
[`henri.reporter`](/guides/logs/) is the seam for failures henri caught, and
an N+1 is not a failure -- it is an answer that was slower than it needed to
be. Sending one there would put a performance note in the same stream as your
500s, and an application that wired Sentry to page someone would be paged for
a slow page.

## Listening yourself

`onQuery()` follows `henri.reporter.onError()`: one handler, replaced by
another call, removed with `null`.

```js
// app/modules/queries.js
const Module = require('@usehenri/core/module');

module.exports = class QueryLog extends Module {
  constructor() {
    super();
    this.name = 'queryLog';
    this.needs = ['queries'];
    this.runlevel = 6;
  }

  init() {
    this.henri.queries.onQuery((event) => {
      if (event.duration > 100) {
        this.henri.pen.warn(
          'slow',
          `${event.model}.${event.method}`,
          `${event.duration.toFixed(1)}ms`,
          event.requestId
        );
      }
    });

    return this.name;
  }
};
```

It is called synchronously, inside the call it describes, so a handler that
blocks blocks a query. A handler that throws is logged once and removed: this
is a development instrument and it does not get to break the application it
is measuring.

## Configuration

Everything is in [`config.queries`](/configuration/#the-queries-object). The
short version: absent means on outside production, `false` means off
everywhere, and `{ "enabled": true }` is the production opt-in.

```json
{
  "queries": {
    "detect": {
      "threshold": 5,
      "ignore": ["Setting", "User.select"]
    }
  }
}
```

## What it costs

Off means **nothing is installed**, the way
[the call log](/guides/calls/) and [telemetry](/guides/telemetry/) mean it:
no hook registered on any adapter, no middleware in the express stack, no
object allocated per query. There is no flag tested on the hot path because
there is no hot path to test it on.

Measured on the Drizzle adapter over an in-memory sqlite, 20 000
`Task.findAll()` calls, best of five passes each in its own process -- which
is the harshest possible framing, because a call that costs 26µs makes the
overhead look as large as it can:

| Configuration                             | Per call | Overhead       |
| ----------------------------------------- | -------- | -------------- |
| `"queries": false`                        | 25.9 µs  | (baseline)     |
| on, `detect: false`, `callsites: false`   | 29.0 µs  | +3.1 µs (+12%) |
| on, detector, `callsites: false`          | 28.6 µs  | +2.7 µs (+11%) |
| on, detector and call sites (the default) | 35.1 µs  | +9.2 µs (+36%) |

The call site is two thirds of it: capturing one costs an `Error` allocation
per model call. (V8 only _formats_ a stack when `.stack` is read, which henri
defers until a shape is actually reported, so the formatting is not in these
numbers.) Set `"callsites": false` to keep the detector and drop that cost.

Read the percentages with the baseline in mind. Against a real database a
model call is half a millisecond to five milliseconds, so the same +9 µs is
0.2% to 2%. It is still off in production by default, because production
traffic should not pay anything to tell a developer something the developer
is not there to read.

## What this does not do

- **It is not tracing.** No spans, no propagation header, no exporter. The
  join is the request id and nothing more. For traces, see
  [Telemetry](/guides/telemetry/) and add your ORM's own instrumentation
  package for statements.
- **It does not count statements**, for the reasons at the top.
- **It detects repetition inside one request**, never across requests. A page
  that runs one extra query every time is not an N+1 and henri will not
  pretend it is.
- **It does not fix anything.** It names the call and the line and says what
  replaces it.
- **On Mongoose, an operation that fans out reports twice.** `pre` and `post`
  are two callbacks with no scope between them, so `Book.find().populate('author')`
  is one model call and reports a `find` for the books and a `find` for the
  authors. The alternative was wrapping the statics, which would have turned
  every chainable `find().sort()` into a promise. A `populate` in a loop
  therefore shows up as two findings for one problem, with the same advice on
  both.
- **There is no history.** Findings go to the log, the header or an
  exception; henri stores none of them. If you want them kept, `onQuery()` is
  four lines away from your own table.
