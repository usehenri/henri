---
title: Call logs
description: The calls an application answered and the calls it made, joined by the request id -- what it holds, the four bounds that keep it from being an outage, and how it is swept.
---

**Read this paragraph before turning it on.** A call log holds **values**:
the body that came in, the body that went out. That is the point -- a call
log that does not is a slower copy of your web server's access log -- and it
is also why it is the most dangerous table henri writes. It is a debugging
instrument, kept for days, sampled, capped and swept. It is not evidence and
it is not [the access trail](/guides/trail/), which is the opposite thing on
purpose.

```json
{ "calls": {} }
```

That is the whole setup. henri creates one table at boot, mounts one
middleware, and starts recording. It is off until this key is there, and off
means off: no table, no middleware, no allocation.

## The two records, and why they are one table

- **inbound**, one row per call your application answered: the method, the
  path, the route, the status, how long it took, the person when one is
  known, [where it came from](#the-clients-address), and the bodies henri
  can read;
- **outbound**, one row per call your application made: the same, plus the
  service it went to.

They share a `direction` column in one table rather than living in two,
because the question worth keeping either of them for is _what happened
during request `X`_, and that is one read on one index instead of two reads
and a merge:

```bash
henri calls 018f5c2e-1f2a-7c31-9f0a-2b7c1d3e4f56
```

```
  Request 018f5c2e-1f2a-7c31-9f0a-2b7c1d3e4f56

  2026-09-06T14:22:31.004Z  <- 201        84ms  POST   /orders
  2026-09-06T14:22:31.019Z  -> 200        41ms  POST   https://api.billing.test/v1/charges
                              service billing
  2026-09-06T14:22:31.062Z  -> 200        12ms  POST   https://hooks.example.test/orders
                              service webhooks
```

The join is the request id `X-Request-Id` already carries through everything
(`req.id`, every `pen` line, every error body). A client's own id is used
when it looks sane, and henri makes one otherwise.

## This is not the access trail

The two tables answer different questions and neither substitutes for the
other:

|                 | [The access trail](/guides/trail/)                 | This                                        |
| --------------- | -------------------------------------------------- | ------------------------------------------- |
| Answers         | who saw this record                                | what did this request do                    |
| Holds           | field _names_, counts, public identifiers, digests | values: the bodies and the headers          |
| Refuses a value | yes, loudly (`HENRI_TRAIL_VALUE_REFUSED`)          | no -- that is what it is for                |
| Complete        | yes, by construction                               | no: sampled, capped, and dropped under load |
| Kept            | a year                                             | thirty days                                 |
| Is it evidence  | yes: hash-chained, append-only                     | no: nothing stops a writer editing a row    |

Turning this on does not give you an audit trail, and turning the trail on
does not give you a call log. Reaching for the wrong one either makes a
second copy of your personal data or produces a record that proves nothing.

## The four bounds

A table that grows without bound, written on the hot path, holding the one
copy of every payload an attacker can make large, is an outage waiting for
traffic. Each of these is a decision rather than a default, and each of them
can be tuned.

### 1. Off unless configured

No `config.calls`, no table, no middleware, no allocation. `inbound: false`
and `outbound: false` turn off one half each.

### 2. The write never blocks the answer

A finished call is pushed onto an in-memory buffer and the response goes
out; a timer (`calls.flush`, a second) and a full batch (`calls.batch`)
write it with one multi-row `INSERT`. A flush that fails is reported once
and **dropped** -- a call log that can fail a request turns a database
hiccup into an outage.

The buffer is bounded too (`calls.buffer`, 1000 rows). Past it a row is
dropped and counted, never queued forever. `henri calls:stats` is where you
see that it happened.

### 3. The payload is bounded before it is stored

A body is captured up to `calls.maxBody` (8kb), cut, and marked
`truncated`. `calls.bodies: false` captures none at all.

**Only a body henri can walk is stored.** A plain object or an array is
redacted key by key and kept; a string, a buffer, a stream or an HTML page is
not, because there is no key to match and no way to redact inside it -- its
shape is recorded in `meta` instead. This is also why the inbound response
body is taken from `res.json(value)`, the value before it is serialized,
rather than off the socket: a controller answering with `res.send(html)` puts
no body in the log, deliberately.

### 4. What one client can cause is bounded twice

`calls.sample` is a fraction and bounds the steady state proportionally to
traffic. It is not enough on its own: one percent of a million requests a
second is still ten thousand rows a second. `calls.maxPerSecond` (100) is an
absolute per-process ceiling that a burst cannot argue with.

The sampling decision is a **hash of the request id, seeded with
`config.secret`**, not a coin flip, and both halves of that matter:

- a hash, so the inbound call and every outbound call it caused decide the
  same way, in every process, without carrying any state. A sampled request
  with half its outbound calls missing would be worse than not sampling it;
- seeded, because the request id comes from a header the client can choose.
  A plain hash would let anyone pick ids that land in the sampled bucket and
  defeat `calls.sample` entirely.

`calls.always` (`["error"]`) is the exception: a call the sampling dropped is
still recorded when it failed. Without its bodies -- the decision not to
capture them was made before the status was known, and there is nothing to go
back for.

## The client's address

An inbound row records where the request came from, and the hard part is
not reading a header. Every one of `X-Forwarded-For`, `CF-Connecting-IP`,
`True-Client-IP` and `X-Real-IP` is text a client typed: whether any of it
can be believed depends entirely on whether the request really arrived
through the proxy that sets it.

So a row carries three things rather than one:

| Column   | What it holds                                                                       |
| -------- | ----------------------------------------------------------------------------------- |
| `client` | the address henri believes the request came from, or **`null`** when it cannot tell |
| `peer`   | the address that actually opened the socket, which is never a guess                 |
| `source` | how `client` was decided: `socket`, `proxy`, `header` or `unverified`               |

The peer is worth keeping even when the client is known: it is the
difference between _the client says it is 1.2.3.4_ and _1.2.3.4 reached us
through 172.16.0.9_.

### What henri believes, and when

There are two mechanisms, they answer to two different settings, and neither
is a default:

1. **`X-Forwarded-For` is [`trustProxy`](/configuration/#keys)'s
   business.** It is express' `trust proxy` and express already applies it:
   `req.ip` is the leftmost address the setting says to believe. henri does
   not re-implement that walk.
2. **A named header is `calls.address`'s business.** `CF-Connecting-IP` is
   not an `X-Forwarded-For` and express will never read it. Believing one
   takes two statements and henri requires both: `header` names it, and
   `from` lists the proxies allowed to set it.

```json
{
  "calls": {
    "address": {
      "header": "cf-connecting-ip",
      "from": ["173.245.48.0/20", "103.21.244.0/22"]
    }
  }
}
```

Naming a header without `from` **fails the boot**
(`HENRI_CALLS_ADDRESS_UNVERIFIABLE`), because any client can send a header
and a configuration that would have henri believe one is a configuration
worth refusing rather than quietly working.

The whole decision, as a table:

| `trustProxy`        | the request carries a forwarding header | `client`   | `source`     |
| ------------------- | --------------------------------------- | ---------- | ------------ |
| anything            | a named header, from a listed proxy     | the header | `header`     |
| `false`             | either way                              | the peer   | `socket`     |
| a hop count, a list | no                                      | the peer   | `socket`     |
| a hop count, a list | yes                                     | `req.ip`   | `proxy`      |
| `true`              | no                                      | the peer   | `socket`     |
| `true`              | yes                                     | **`null`** | `unverified` |

### `trustProxy: true` records no address, on purpose

That last row is the one that matters, and it is henri's default setting.
`trustProxy: true` is express' _believe the leftmost entry, whoever sent
it_ — the boot already warns that it lets anyone forge the address an
ip-based rate limit counts. A rate limit that can be escaped is degraded; an
address column filled from the same header is worse, because it looks like
an answer.

**An address that is a guess is worse than an empty column.** An operator
reading a call log is usually answering _who did this_: the empty column
asks a question and the guess answers one. So the row says `unverified`,
keeps the peer, and `henri calls` prints it as such:

```
  2026-09-06T14:22:31.004Z  <- 201        84ms  POST   /orders
                              from unverified, peer 10.1.2.9
```

The fix is one line — tell henri how many proxies are in front of it:

```json
{ "trustProxy": 1 }
```

`henri audit` reports the combination in a production configuration
(`calls.address-unverified`), and reports a `from` covering every address
(`calls.address-from-any`), which is the shape that _would_ let a client
choose what an operator reads.

### An address is personal data

It gets the same care as the rest of this table rather than an exception:

- it lives in **columns of its own, never in the stored headers**. The
  forwarding headers are masked in the header blob whatever
  `filterParameters` says, precisely so the address cannot reach the table
  through the one place an erasure cannot write into;
- it is swept by `calls.keep` like every other column;
- a person's rows answer `henri privacy:export` and `henri privacy:erase`
  (below);
- `calls.address.anonymize` truncates it — the last octet of an IPv4 and
  the last 80 bits of an IPv6, with the prefix length kept in the value, so
  `203.0.113.0/24` cannot be mistaken for an address somebody really
  connected from.

```json
{ "calls": { "address": { "anonymize": true } } }
```

**It is off by default, and that is a decision.** The column exists to
answer _who did this_; a `/24` answers _somebody in this city_. A default
that quietly answers a different question than the one asked is the same
failure as recording a guess. What makes the whole address safe to hold is
not truncation but the rules this table already has — off unless
configured, kept thirty days, masked in the logs, and erasable. Turn it on
if you keep the log longer than a few weeks, or if your basis for holding
an address does not stretch that far.

`"address": false` records none of it.

## A person's rows, and a data subject request

The call log holds **values**, which is the whole difference between it and
the trail — so it answers a data subject request like any other record about
a person, rather than pointing at its own retention and calling that an
answer:

- `henri privacy:export <who>` includes the rows whose `actor` is theirs,
  under a `calls` key of the document;
- `henri privacy:erase <who>` writes over them: the `actor`, both
  addresses and the four payload columns go, and the row survives holding
  the moment, the method, the url, the route, the status, the duration and
  the request id. That is `onErase: "anonymize"` — the record of a request
  that did happen, naming nobody.

A row is a person's when it carries their `externalId`, which is the only
join there is: an anonymous request is an address and nothing henri can tie
to anybody.

The call log is **best effort** in both, and the receipt says so. An erasure
that has already written over a person's records must not fail because a
debugging log was unreachable, so a failure is a warning and a `problem` in
the receipt rather than a refusal.

### What the neighbours do, and why they are different

- **[The access trail](/guides/trail/) records no address, and is not
  changing.** It holds field _names_, counts, public identifiers and
  digests, and refuses a value — which is exactly what lets it outlive the
  erasure it recorded. It is also hash-chained, so a row written over would
  break the chain that makes it evidence. An address in it would be
  personal data in the one table that is kept for a year and cannot be
  erased from.
- **`henri.reporter` carries nothing from the client, and is not
  changing.** A handler gets the method, the route pattern and the status
  and nothing else — no url, no query, no body, no headers, no user. That
  is the property that makes it safe to hand to a third-party error
  service, and an address is from the client.

## What never reaches a row

Everything stored goes through the same redactor as your logs:
`config.filterParameters` as substrings, the fields your models marked
[`personal`](/guides/privacy/) matched exactly, and the always-masked set
(`encryption`) that no configuration lifts -- at every depth, in headers and
bodies alike. On top of that:

- **the credentials of an exchange are always masked**, whatever
  `filterParameters` says: `authorization`, `proxy-authorization`, `cookie`,
  `set-cookie`, `x-csrf-token`, `x-api-key` and `webhook-signature`. No
  application should have to remember to write those down;
- **the forwarding headers are masked too** — `x-forwarded-for`,
  `x-real-ip`, `cf-connecting-ip`, `true-client-ip` and the rest. They
  carry addresses, an address is personal data, and the stored headers are
  the one blob an erasure cannot reach inside: the address belongs in
  [the columns that can be truncated and erased](#the-clients-address);
- **a url loses its userinfo**: `https://key:secret@host/` is stored as
  `https://host/`, and the filtered query values are masked;
- **the person is their `externalId`** and nothing else. Not the primary key,
  not the email address;
- **a body henri cannot walk is not stored at all**, only its shape.

What follows from that: mark the fields that are about a person `personal` in
your models. That mark is what turns `{"email": "..."}` in a captured body
into `[FILTERED]` here, in your logs, and in the answers henri builds, all at
once.

## The outbound half

henri wraps nobody's HTTP client. There is no interceptor to install and no
patched `fetch`: there is a seam, and it is two lines around whatever you
already use.

```js
const finish = henri.calls.track({
  service: 'billing',
  method: 'POST',
  url: 'https://api.billing.test/v1/charges',
  request: { headers, body },
});

try {
  const answer = await fetch(url, { method: 'POST', headers, body });
  const json = await answer.json();

  finish({ status: answer.status, headers: answer.headers, body: json });
} catch (error) {
  finish({ error: error.code });
}
```

`henri.calls.outbound(call)` records a finished call in one go when you
already have the timings. Both are no-ops when the log is off, so nothing has
to ask first.

### The calls henri makes itself

Two are populated without you doing anything:

- **mail.** Every `henri.mail.send()` is one `service: "mail"` row: the
  transport it went to, how long it took, the message id and the counts. The
  **recipients are not in it** -- an address is personal data and a call log
  is not where it belongs.
- **webhooks.** Every delivery attempt of
  [`@usehenri/webhooks`](/guides/webhooks/) is one `service: "webhooks"` row.
  The request id is stamped into the delivery job at `emit()` time, so a
  delivery that goes out ten seconds (or three retries) after the request
  that caused it still joins it. What the receiver answered is deliberately
  left out: it is untrusted text nothing can redact, and
  `henri jobs:show <id>` already holds the excerpt.

A job that makes its own outbound calls is outside all of this, the same way
a model call in a controller is outside the trail: `track()` is how it gets
in.

## How it is swept

`calls.keep` (30 days), pruned by [the retention sweep](/guides/retention/) --
the same sweep that enforces every other retention enforces this one, and
`henri calls:sweep --yes` runs it on its own. A prune that fails is a warning
rather than a failed sweep: your models have already been swept by then.

**Where the dialect has partitions, whole periods are dropped instead of
rows.** That is the difference between a sweep that works at ten million rows
and one that times out, because dropping a partition is a metadata operation
whatever it held:

| Store              | How it is swept                                                              |
| ------------------ | ---------------------------------------------------------------------------- |
| PostgreSQL         | `PARTITION BY RANGE (at)`; the sweep drops the periods entirely past `keep`  |
| MySQL              | `PARTITION BY RANGE (at)`; the same, with `ALTER TABLE ... DROP PARTITION`   |
| sqlite, SQL Server | no range partitioning: a bounded `DELETE` loop, `calls.sweep` rows at a time |
| MongoDB            | the same delete path                                                         |

```json
{ "calls": { "partition": "day", "partitionsAhead": 7, "keep": "30d" } }
```

`calls.partition` on a store that cannot do it fails the boot
(`HENRI_CALLS_PARTITION_UNSUPPORTED`) rather than being quietly ignored. The
bounds are UTC and they are in the partition's name (`henri_calls_p20260906`).

Three things worth knowing about it:

- **there is always a catch-all** -- a `DEFAULT` partition on PostgreSQL, a
  `VALUES LESS THAN MAXVALUE` one on MySQL. Without one, a row whose `at`
  fell outside every declared period would be _refused_, which turns a
  partition henri did not create in time into failed inserts. Whatever the
  catch-all takes is swept by the delete path;
- **a period the sweep dropped does not come back.** MySQL keeps its ranges
  in increasing order, so a period below one that is still there cannot be
  added; henri only ever adds periods above every existing one, on both
  servers, and what that period held is gone anyway;
- **changing `calls.partition` on a table that exists needs a migration of
  your own.** henri creates the table the way the configuration asked the
  first time and does not rewrite it afterwards.

## The commands

```bash
henri calls <request-id>              # one request, and everything it caused
henri calls --direction=out --service=billing
henri calls:stats                     # written, and dropped rather than written
henri calls:sweep --yes               # the prune, on its own
```

`henri calls:stats` is the one to read when the log looks thin: it separates
the rows dropped by the per-second ceiling, by a full buffer, and by a store
that refused them.

## Reading it back in code

```js
const story = await henri.calls.about(req.id);
const failures = await henri.calls.list({ outcome: 'failed', limit: 50 });
const count = await henri.calls.count({ direction: 'out', service: 'billing' });
```

`about()` answers oldest first -- one exchange read as a story -- and
everything else answers newest first.

## What is not here

- **No tracing.** There is no span, no parent id and no propagation header
  going out. This joins on the request id henri already has, and stops there;
  a distributed trace is OpenTelemetry's job and this is not a worse version
  of it.
- **No streaming or file bodies.** A multipart upload is a size and a type
  ([uploads](/guides/uploads/) is where a file lives), and a streamed answer
  is a status and a duration.
- **No UI.** `henri calls` and `henri.calls.list()` are the readers.
- **No cross-process ceiling.** `calls.maxPerSecond` is per process,
  deliberately: a round trip to a shared store to decide whether to write a
  debugging row would cost more than the row.
- **No retry of a failed write.** A flush that fails drops its rows. A retry
  queue for debugging rows is a second thing to run out of memory.
