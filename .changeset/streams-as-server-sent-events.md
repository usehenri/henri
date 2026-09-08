---
'@usehenri/core': minor
---

`res.stream()` and `henri.streams`: real time as server-sent events, with the policy asked on every event — and `@usehenri/websocket` deleted.

The websocket package was an unwired socket.io loader: private, never published, never registered as a module, untouched since 2020. It is gone. henri's answer to "push something to the browser" is a **route**:

```js
// app/controllers/proposals.js
events: async (req, res) =>
  res.stream(`proposal:${proposal.externalId}`, { subject: proposal }),
```

```js
// a controller, a job, a model hook
await henri.streams.publish(
  `proposal:${proposal.externalId}`,
  'changed',
  proposal
);
```

A `GET` that does not end, on the http server henri already runs, through the same router, session, role guard and `app/policies` as everything else. No second protocol, no second port, no sticky sessions, no dependency — `EventSource` is in every browser. What a WebSocket buys over that is a channel the client writes **back** on, and a client that wants to write back has `POST`, which is authenticated, rate limited, CSRF-checked, idempotent and logged.

**The topic is the controller's, never the client's.** A client asks for a route; the controller loads what that route is about, asks the policy, and only then decides which topic this connection is on. There is no endpoint anywhere in henri that takes a topic from a query string, because "subscribe to whatever you name" is the whole vulnerability in one line.

**The policy is asked twice, and the second time is the point.** At subscribe time, before a byte — and a refusal is the ordinary refusal (the configured 404, or 401 and the login page), never a stream that opens and then carries an error, because an `EventSource` given a non-2xx status stops rather than retrying. Then **again before every event**: the subscription's own question, plus the one about the record the event carries. A stream is a decision made once and answered from for hours — a subscription opened at nine is still open at five, and in between a record was unpublished and somebody left a team — so asking once would make an eight-hour stream exactly as safe as the state of the world at nine o'clock. A refusal is **silent** and counted; `event: denied` would say "something just happened to a record you may not see", which is the leak with a politer name. henri refuses to open a stream nothing can authorize at all (`HENRI_STREAM_POLICY_REQUIRED`), and there is no setting that turns that into a yes.

**The same exit gate.** Every event's data goes through the `toPublic()` call `res.resource()`, `res.render()` and `res.csv()` make — publish, then strip — so a foreign key leaves as the `externalId` of the row it names, no primary key leaves at all, and a field marked `personal: { expose: false }` is not in the frame. Data is **always JSON**: there is no way to write bytes to a stream, because bytes are where the gate stops being able to see anything.

**A broadcast reaches one process, and the guide says so in a box at the top.** A connection lives on the process that accepted it, so behind two workers `publish()` reaches roughly half the people who asked and nothing errors. There is **no cross-process fan-out in this release**; henri warns on the first stream a process opens whenever the environment says this process is one of several (the evidence the rate limit and the cache already use).

**henri promises nothing about reconnection, out loud.** It sends the retry hint and hands `Last-Event-ID` to the controller as `req.lastEventId`, and that is the whole feature: no buffer, no replay. It never invents an `id:` either — an id is a promise the stream can be resumed from it, and a buffer that lies is worth less than a sentence that does not.

**A deploy ends them cleanly.** A response with no last byte would hold `server.close()` open until `shutdown.drain` destroyed it, every time, so the drain closes the streams first — after readiness turns 503, before the listener closes — each with a fresh, jittered retry hint, and the clients come back spread out onto a process that still accepts. `config.requestTimeout` no longer applies to a stream: it takes the timer off when it opens, because a stream is not a request without an answer, it is a request whose answer began. What bounds one is `streams.maxAge` (fifteen minutes), which is also what bounds how stale the record, the session and the policy answer it opened with may get — the reconnect re-loads and re-decides all three, for free.

The framing is a walk over code points with no regular expression anywhere: an `event` or an `id` holding a newline is **refused** rather than escaped (`HENRI_STREAM_EVENT_INVALID`), because it would let whoever chose it write raw event-stream fields into the frame.

One new configuration key, `streams` (`heartbeat`, `maxAge`, `maxBuffer`, `maxOpen`, `retry`), and four new error codes: `HENRI_STREAM_POLICY_REQUIRED`, `HENRI_STREAM_TOPIC_INVALID`, `HENRI_STREAM_EVENT_INVALID` and `HENRI_STREAM_TOO_MANY`. See the new [Streams](https://usehenri.io/guides/streams/) guide.
