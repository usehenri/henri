---
title: Streams
description: res.stream() and henri.streams — real time as server-sent events on the http server henri already runs, with the policy asked at subscribe time and again on every event, and one process of fan-out.
sidebar:
  order: 11
---

henri does real time with **server-sent events**. Not WebSockets, and there is no socket.io anywhere near it.

A stream is a `GET` that does not end. It runs on the http server henri already has, through the same router, the same session, the same role guard and the same `app/policies` as every other route, and `EventSource` is in every browser without a line of dependency on either side. There is no second protocol to operate, no second port to open, no upgrade handshake for a proxy to get wrong and no sticky sessions to configure. What a WebSocket buys over that is a channel the client can write **back** on — and a client that wants to write back has `POST`, which is authenticated, rate limited, CSRF-checked, idempotent and logged, none of which is true of a frame on a socket.

```js
// app/controllers/proposals.js
module.exports = {
  events: async (req, res) => {
    const proposal = await Proposal.findById(req.params.id);

    if (!proposal) {
      return res.notFound();
    }

    return res.stream(`proposal:${proposal.externalId}`, {
      subject: proposal,
    });
  },
};
```

```js
// config/routes.js
'get /proposals/:id/events': 'proposals#events',
```

```jsx
// the page
const events = new EventSource(`/proposals/${id}/events`);

events.addEventListener('changed', (event) => {
  setProposal(JSON.parse(event.data));
});
```

and anywhere at all — a controller, a job, a model hook:

```js
await henri.streams.publish(
  `proposal:${proposal.externalId}`,
  'changed',
  proposal
);
```

:::danger[A broadcast reaches one process]
A connection lives on the process that accepted it, so `henri.streams.publish()` reaches the subscribers **of the process it is called on** and nobody else. Behind two workers, half the people watching a proposal are not told it changed — and **nothing errors**, nothing is logged on the publishing side, and every test on one process passes.

henri has **no cross-process fan-out**. `config.shared` is where one will go and it is not in this release. Until it is: run one web process, or make sure the change that publishes also reaches the other processes some other way (a job every process runs, a poll, a reload on the next request).

henri warns about this the first time a process opens a stream _and_ the environment says this process is one of several — a cluster worker, `WEB_CONCURRENCY` above one, a numbered pm2 instance. It cannot see a second machine, so the absence of that warning is not a clearance.
:::

## What a subscription is a stream _of_

Two things, named separately, because they answer different questions.

The **topic** is the address `publish()` writes to. It is a plain string and it is chosen by the **controller**, never by the client. The client asks for a route; the controller loads what that route is about, asks the policy, and only then decides which topic this connection is on. There is no endpoint anywhere in henri that takes a topic from a query string, because "subscribe to whatever you name" is the whole vulnerability in one line.

The **subject** is the record the subscription is about, and it is what the policy is asked about. A stream with no subject is a stream of a collection and is asked the record-less question instead:

```js
// every proposal I may see, rather than one of them
notifications: async (req, res) => res.stream(`inbox:${req.user.externalId}`),
```

On a `resources` route the controller's own model names the policy, which is what makes that call work with nothing else said. Where it does not — a topic that is not about the controller's model — name it:

```js
res.stream(`billing:${account.externalId}`, {
  policy: 'Account',
  subject: account,
});
```

## The policy, asked twice

**At subscribe time**, before a single byte. `res.stream()` calls `req.authorize(action, subject)` for you, so a refusal is the ordinary refusal every other route gives: the configured `404`, or a `401` and the login page for an anonymous visitor, negotiated like everything else. It is deliberately **not** a stream that opens and then carries an error event — an `EventSource` that receives a non-2xx status fails permanently and does not retry, which is exactly what a refusal should do, and a refused subscription is byte-for-byte the answer a route that does not exist gives.

henri will **not open a stream it cannot authorize**. A `res.stream()` where nothing names a policy is `HENRI_STREAM_POLICY_REQUIRED` — a mistake in the controller, raised at the call. There is no setting that turns that into a yes. A stream that really is open to everybody says so on purpose, in one line, where the rest of the application's authorization lives:

```js
// app/policies/scoreboard.js
module.exports = { show: () => true };
```

**On every event**, before it is written, the same questions again:

- the subscription's own (`action`, `subject`), and
- the one about the record the event carries (`each`, that record), when it carries one.

Both have to say yes, and this is the part that is not optional. A stream is a decision made once and answered from for hours: a subscription opened at nine is still open at five, and in between a proposal was unpublished, an owner changed and somebody left a team. Asking once would make an eight-hour stream exactly as safe as the state of the world at nine o'clock. Asking per event makes it as safe as sixty one-minute requests, which is what it is pretending to be.

A refusal is **silent**. The event is not written and nothing tells the subscriber that an event existed — `event: denied` would say "something just happened to a record you may not see", which is the leak with a politer name. The count is on the stream (`dropped`) and nowhere else.

It costs what it costs: a broadcast to a thousand subscribers is a thousand policy questions. That is the right price — it is a thousand answers leaving the server — but it means **a policy rule runs once per event per subscriber, so it must not query the database**. An application that cannot pay it publishes to a narrower topic (one per person) so the fan-out is small.

### What the subject cannot tell you

The subject is the copy loaded at subscribe time. So is the user, and so is the session behind it. Re-asking the policy against a record held in memory re-reads the **rule**, not the row: if the proposal was unpublished an hour ago, this stream's copy still says published.

The bound on that staleness is `streams.maxAge` (fifteen minutes), and it is free, because the protocol already has the answer. henri ends the stream cleanly when it reaches its age; the browser's `EventSource` reconnects on its own; the controller runs again; the record is loaded again and the session is deserialized again — so a password change, a revoked membership, a deleted account and an unpublished record are all seen at that moment, without a line of application code knowing it happened.

The event's own record has no such problem: whoever called `publish()` was holding it.

## What crosses the wire

Every event's data goes through the same exit gate as every other answer — `publish()` then `henri.privacy.strip()`, the same `toPublic()` call `res.resource()`, `res.collection()`, `res.render()` and `res.csv()` make. A foreign key leaves as the `externalId` of the row it names, no primary key leaves at all, and a field marked `personal: { expose: false }` is not in the frame. `include` is the way back, declared on the subscription:

```js
res.stream(topic, { include: ['email'], subject: account });
```

**Data is always JSON.** There is no way to write bytes to a stream, and that is deliberate: bytes are where the gate stops being able to see anything. `res.send(JSON.stringify(value))` is the hole `base/answers.js` describes, and an escape hatch here would be the same hole in every guarantee on this page. `JSON.parse(event.data)` on the other side, always.

With `config.trail.reads` on, an event carrying a record is recorded like any other answer henri serializes.

## Reconnection: henri promises nothing

SSE has `Last-Event-ID` and a retry hint. henri sends the hint (`streams.retry`, jittered when henri is the one closing so a deploy does not bring every subscriber back in the same millisecond) and hands the header to the controller as `req.lastEventId`. **That is the entire feature.**

**There is no buffer and there is no replay.** Whatever happened while a client was reconnecting did not reach it, and henri does not know what that was. A stream is for telling a page that something changed, and the page's answer to a gap is to fetch the thing again — which is a request, on a route that already exists, with its own policy.

henri therefore **never invents an `id:`** either. An id is a promise that the stream can be resumed from it, and henri cannot keep that promise, so the field appears only when the application sets one:

```js
await henri.streams.publish(topic, 'changed', proposal, {
  id: String(revision),
});
```

on a stream it can replay itself:

```js
events: async (req, res) => {
  const stream = await res.stream(topic, { subject: proposal });

  if (req.lastEventId) {
    for (const missed of await Revision.since(req.lastEventId)) {
      await henri.streams.publish(topic, 'changed', missed);
    }
  }

  return stream;
},
```

A buffer that lies is worth less than a sentence that does not.

## Deploys, timeouts and bounds

**A deploy ends every stream cleanly.** A response that never ends would otherwise hold the drain open until `shutdown.drain` destroyed it, on every single deploy. So the drain closes the streams first — after readiness turns `503` and `shutdown.delay` has passed, before the listener closes — each with a fresh, jittered retry hint. The clients reconnect, spread over a few seconds, onto a process that is still accepting. Nothing in the application has to know.

**`config.requestTimeout` does not apply.** A stream takes the timer off when it opens: the flag it sets means "nobody is waiting for this any more, stop", and on a stream that is behaving perfectly that would be false. What bounds a stream is `streams.maxAge`.

**A subscriber that is not reading is closed.** Past `streams.maxBuffer` (1mb of unread bytes) the stream ends rather than being allowed to grow into this process's memory. It reconnects, and it misses what it missed — which this page already said it would.

**A process holds `streams.maxOpen` of them** (1000). Past that a subscription is answered `503` with a `Retry-After` (`HENRI_STREAM_TOO_MANY`), which is a great deal better than reaching the file descriptor limit and taking the rest of the application down with it.

An idle connection gets a comment frame every `streams.heartbeat` (25 seconds), which is under the idle timeout of every proxy worth naming and is also how a client that went away is noticed.

## A note on the browser

`EventSource` cannot set headers, so an SSE endpoint is authenticated by the **session cookie** like any other page — which means henri's `SameSite=Lax` cookie is not sent by a cross-site `EventSource`, and a stream is same-origin unless `config.cors` says otherwise and the client passes `withCredentials`. A bearer-token API client is not an `EventSource`; it reads the response body itself and henri's frames are ordinary `text/event-stream`.

The response carries `Cache-Control: no-cache, no-transform` (which is also what takes it out of the compression middleware's hands) and `X-Accel-Buffering: no`, so nginx does not buffer it into a very slow single response.

## What is deliberately not here

- **A cross-process fan-out.** Said above, loudly, and it is the one thing on this list that is a missing feature rather than a decision.
- **Any replay, buffer or delivery guarantee.** See above.
- **A client library.** `new EventSource(url)` is the client library.
- **Receiving.** A stream is one direction. The other direction is a `POST`, and it should be.
- **Presence, rooms, or a list of who is watching.** `henri.streams.count(topic)` says how many connections _this process_ holds, which is not presence and must not be presented as it.
- **A topic a client can name.** The controller chooses it, after the policy.

## Reference

`res.stream(topic, options)` opens the stream and resolves with it:

| Option    | Default                              | What it is                                                                             |
| --------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| `subject` | none                                 | The record the subscription is about, and what the policy is asked about.              |
| `policy`  | the controller's model               | The policy to ask, when the subject does not name one.                                 |
| `action`  | `show`, or `index` without a subject | The subscription's own question, asked at subscribe time and again before every event. |
| `each`    | `show`                               | The question asked of each record an event carries, before that event is written.      |
| `include` | `[]`                                 | The fields marked `personal: { expose: false }` this stream's events may carry.        |

`henri.streams`:

| Call                                  | What it does                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `publish(topic, event, data, { id })` | Sends an event to the subscribers of a topic **on this process**; resolves with how many were allowed to be told. |
| `count(topic?)`                       | How many streams this process holds, on one topic or on all of them.                                              |
| `topics()`                            | The topics somebody is subscribed to on this process.                                                             |
| `drain(reason?)`                      | Ends every open stream. The drain calls it; an application rarely does.                                           |

The settings are [`config.streams`](/configuration/#the-streams-object). The failures are `HENRI_STREAM_POLICY_REQUIRED`, `HENRI_STREAM_TOPIC_INVALID`, `HENRI_STREAM_EVENT_INVALID` and `HENRI_STREAM_TOO_MANY` — see [Error codes](/reference/errors/).
