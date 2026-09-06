---
title: Webhooks
description: 'Outbound webhooks: endpoints an application registers, deliveries signed the way Standard Webhooks says, and the retries of the queue.'
sidebar:
  order: 11
---

A webhook is an event your application pushes to a url someone else gave it. Everybody writes this by hand, and everybody gets two parts of it wrong: the signature — which is what makes the receiver able to believe the request — and the url, which is a server-side request forgery with a registration form in front of it.

```bash
npm install @usehenri/webhooks @usehenri/jobs   # a delivery is a job
henri webhooks:add https://acme.example/hooks --events 'invoice.*'
henri jobs                                      # a worker performs the deliveries
```

```js
await henri.webhooks.emit('invoice.paid', {
  id: invoice.externalId,
  total: 4200,
});
```

That is the whole surface. One row per subscribed endpoint is written to the queue and the request answers; a runner delivers, signs, retries with a backoff, and what runs out of attempts is in the dead letter queue with its reason.

The package [ships a henri module](/reference/under-the-hood/#where-it-goes-a-module-that-arrives-from-a-package), so depending on it is all there is to do: it is in the boot as `henri.webhooks`, at level 4, after the queue. `henri new` does not install it. It needs [`@usehenri/jobs`](/guides/jobs/) as well — an application that has the endpoints and no running queue can register and inspect them, and the first `emit()` says what is missing.

## Registering an endpoint

An endpoint is a url, what it subscribes to, and a signing secret henri generates. From the command line:

```bash
henri webhooks:add https://acme.example/hooks \
  --events 'invoice.paid,invoice.void' \
  --owner tenant_42 \
  --description 'Acme production' \
  --header 'X-Acme-Env: production'
```

or from the application, which is what a settings page does:

```js
const endpoint = await henri.webhooks.register({
  url: 'https://acme.example/hooks',
  events: ['invoice.*'],
  owner: tenant.externalId,
  description: 'Acme production',
});

endpoint.secret; // 'whsec_…' — show it once, it is not readable in the UI later
```

`events` is an event name, a family (`invoice.*` takes `invoice.paid` and `invoice.payment.failed`), or `*`. There is no glob language beyond that: a fan-out policy richer than a subscription is the application's, and a second pattern syntax is a second thing to get wrong.

`headers` are the receiver's own — a routing tag, a token its gateway expects. henri refuses the ones it owns (`webhook-id`, `webhook-timestamp`, `webhook-signature`, `content-type`, `user-agent`) and the hop-by-hop ones, because a header a receiver could set to shadow the signature would be a hole with a form in front of it.

The **url's shape** is checked here — `https`, no credentials in it, a host. Where it _resolves_ is not, and that is deliberate: see [what a hostile url cannot reach](#what-a-hostile-url-cannot-reach).

### Many tenants

`owner` is the tenant an endpoint belongs to, and it is what keeps one customer's events out of another's:

```js
await henri.webhooks.emit('invoice.paid', payload, {
  owner: tenant.externalId,
});
```

An `emit()` **without** an `owner` reaches the endpoints that have none, and never a tenant's. henri will not fan an event out across every tenant for you: that is one typo away from sending customer A's invoice to customer B, and iterating your own tenants is the version of it you can read.

The lookup loads the enabled endpoints of one owner and matches the pattern in the process, because the four SQL dialects do not agree on how to ask that of a JSON column. It is cached in [`henri.cache`](/guides/caching/) for ten seconds — without the secrets, which never reach a cache — and invalidated whenever an endpoint changes. So a busy event costs one query per owner per ten seconds, not one per event. The ceiling is `webhooks.maxFanout` (a thousand): past it `emit()` refuses rather than writing ten thousand rows inside a request, and an application that really has that many endpoints on one event emits [from a job](/guides/jobs/).

### Where the endpoints live

In a table this package owns, `henri_webhooks`, reached through the store adapter the way the queue reaches `henri_jobs` — no henri model is involved. The three candidates were the configuration, a model you write, and this:

- the **configuration** cannot hold a secret per tenant, cannot rotate one, and is not writable by a settings page;
- a **model of yours** means every application carries a migration, a validation and a secret column for a table it did not want to design — and gets the storage of the secret wrong, which is the part this feature exists for;
- so: **a table henri owns**, indexed on `(owner, disabled_at)`, on every adapter (`postgresql`, `mysql`, `mssql`, `drizzle`, `mongoose`, `disk`).

The cost, said plainly: an endpoint is a row, not a model. It has none of your validations, no hooks, no `paranoid`, and `henri.webhooks.register()` is the only way in.

```bash
henri webhooks:install     # creates the table and its index; idempotent
```

The table is also created when the application boots, so development needs nothing. In production, run `henri webhooks:install` in the deploy and set `"install": false`.

## Signing

This is the part to get right, so here is exactly what henri sends and why.

```http
POST /hooks HTTP/1.1
content-type: application/json; charset=utf-8
user-agent: henri-webhooks/1.1.0
webhook-id: 018f9c3e-6a2d-7b41-9f0e-2c1d5a7b3e90
webhook-timestamp: 1789045200
webhook-signature: v1,g0hM9SXGj0WhV0mm8ZeUR4a3lz1qWfBIvyGqUvxvXhg=

{"data":{"total":4200},"id":"018f9c3e-…","timestamp":"2026-09-06T12:00:00.000Z","type":"invoice.paid"}
```

The scheme is **[Standard Webhooks](https://www.standardwebhooks.com)**, followed to the byte: three headers, the signed content is `id.timestamp.body`, HMAC-SHA256, base64, with a `v1,` scheme prefix, and the secret is `whsec_` followed by the base64 of the key. A receiver that already has a Standard Webhooks library verifies henri with nothing written.

### What everyone else sends, and what it leaves out

| Sender      | What it sends                                          | What is signed      |
| ----------- | ------------------------------------------------------ | ------------------- |
| **GitHub**  | `X-Hub-Signature-256: sha256=<hex>`                    | the body            |
| **Shopify** | `X-Shopify-Hmac-Sha256: <base64>`                      | the body            |
| **Stripe**  | `Stripe-Signature: t=<seconds>,v1=<hex>`               | `timestamp.body`    |
| **henri**   | `webhook-id`, `webhook-timestamp`, `webhook-signature` | `id.timestamp.body` |

GitHub and Shopify sign the body and nothing else. There is no timestamp, so a captured request replays for as long as the secret lives, and no delivery id, so a receiver cannot tell a retry from a duplicate. They also disagree with each other on the encoding of the same algorithm — hex against base64 — which is the single most common reason a hand-written verification fails on a genuine request.

Stripe is the one that gets it right, and henri differs from it in three ways, on purpose:

- **the timestamp is its own header**, not a field inside the signature header, so a receiver can do the recency check without parsing the signature first (Slack does the same);
- **the delivery id is part of the signed content**. Stripe re-signs a retry with a fresh timestamp and puts the event id only in the body, so deduplicating means trusting the body before verifying it. henri sends the same `webhook-id` on every attempt of one delivery, signed, so "have I already processed this?" is answered from bytes that were authenticated;
- **base64, not hex**, because the specification says so.

One more thing henri does not do: it sends **no unsigned header a receiver could route on**. The event type is in the signed body and nowhere else. A `X-Event-Type` header outside the signature is a switch statement an attacker can steer.

### The timestamp, and replay

Replay protection is not an extra on top of a signature, it is part of one. The timestamp is inside the signed content, so it cannot be moved without the key, and it is the moment of **this attempt** — a delivery retried six hours later carries a fresh timestamp and a fresh signature, and stays inside the receiver's window. The event's own moment is in the body, as `timestamp`.

A receiver needs all three of these, and the snippet below has all three:

1. refuse a `webhook-timestamp` more than five minutes from now (Stripe's default, and what henri documents);
2. compare with a **constant-time** comparison, never `===` on strings;
3. refuse a `webhook-id` you have already answered. The window bounds a replay; the id makes a retry safe. Neither is enough alone.

### Verifying a delivery

Paste this. It is the whole thing, and `packages/webhooks/__tests__/signature.spec.js` runs this exact transcription against what the package signs, so this page cannot drift from the code.

```js
const { createHmac, timingSafeEqual } = require('crypto');

const TOLERANCE = 300; // seconds

/**
 * Whether a request really came from the sender that holds this secret
 *
 * @param {string} body the RAW body, exactly as it arrived
 * @param {object} headers the request headers, lowercased
 * @param {string} secret the endpoint secret, `whsec_…`
 * @returns {boolean} whether to act on it
 */
function verify(body, headers, secret) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = headers['webhook-signature'];

  if (!id || !timestamp || !signatures) {
    return false;
  }

  // 1. recency: a signature that is valid and old is a replay
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE) {
    return false;
  }

  // 2. the key is the base64 INSIDE the secret, not the secret string
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`, 'utf8')
    .digest();

  // 3. every `v1,` signature in the header; ignore the schemes you do not
  //    know, so a future one cannot downgrade you
  return signatures
    .split(' ')
    .filter((entry) => entry.startsWith('v1,'))
    .map((entry) => Buffer.from(entry.slice(3), 'base64'))
    .some(
      (candidate) =>
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected)
    );
}
```

In Express, with the **raw** body — a signature is over bytes, and `express.json()` has already thrown them away:

```js
app.post('/hooks', express.raw({ type: 'application/json' }), (req, res) => {
  const body = req.body.toString('utf8');

  if (!verify(body, req.headers, process.env.ACME_WEBHOOK_SECRET)) {
    return res.sendStatus(400);
  }

  const event = JSON.parse(body);

  if (alreadyProcessed(req.headers['webhook-id'])) {
    return res.sendStatus(200); // a retry, not a new event
  }

  res.sendStatus(200); // answer first
  handle(event).catch(report); // then do the work
});
```

In Ruby, in Python, in Go: the same four lines. The only step people skip is the second one — `whsec_` is a label, not key material, and the key is what the base64 after it decodes to.

An application that receives its own webhooks (a test, another service of the same codebase) can skip the transcription: `require('@usehenri/webhooks').verify({ body, headers, secret })` is the counterpart of what signed it.

### Rotating

Two things rotate, and the `v1` prefix is what makes the second one possible.

**The key.** An endpoint may hold several secrets at once, and every one of them signs, so a receiver has a window to install the new key without dropping a delivery:

```bash
henri webhooks:rotate <id> --grace 24h
```

```js
const { secret } = await henri.webhooks.rotate(id, { grace: 86400000 });
```

The header then carries two `v1,` signatures, and a receiver that has either key accepts. Without a `--grace` the old secret retires at once, which is what a leak calls for. `henri webhooks:show <id> --reveal` prints the secrets that still sign, for the receiver that lost one.

**The scheme.** `v1` is HMAC-SHA256. A receiver that follows the snippet above — ignore every scheme you do not know — keeps working while a second one is being sent alongside it.

### The secrets at rest

A signing secret is a bearer credential in both directions: whoever holds it can forge a delivery the receiver will believe. It cannot be hashed the way a password is, because henri signs with it on every attempt, so it is **encrypted**: AES-256-GCM under a key derived from `config.secret` (HKDF-SHA256). A database dump on its own is then not a set of forged deliveries.

The row carries the first bytes of the key's digest, so this is worth writing down:

> **Rotating `HENRI_SECRET` makes every stored webhook secret unreadable.** henri says exactly that (`HENRI_WEBHOOK_SECRET_UNREADABLE`) instead of failing to decrypt. The fix is not to decrypt them — it is to rotate the endpoints' own secrets and hand the new ones to the receivers. Rotate one, or rotate both in that order.

An application with no `secret` at all — there is one as soon as it has users — stores them as they are, and the boot says so once.

## Delivery

A delivery is one `henri/webhook` job. That is the whole mechanism: the retries, the exponential backoff, the dead letter queue, the recovery of a runner that died mid-flight and the operator's view of all of it are the queue's, already written and already covered on four databases. There is no second thing to learn, no second table to prune and no second answer to "what happened to it".

The default policy is eight attempts, ten seconds tripling up to six hours — about three days of trying, which is what a receiver that is down for a weekend needs.

### What is a failure

| The receiver answered | henri does                                                            |
| --------------------- | --------------------------------------------------------------------- |
| `2xx`                 | delivered.                                                            |
| `3xx`                 | **fails, and does not retry.** The redirect is not followed.          |
| `410 Gone`            | **fails, does not retry, and disables the endpoint.**                 |
| any other `4xx`       | fails, retried.                                                       |
| `5xx`                 | fails, retried.                                                       |
| nothing, in time      | fails, retried (`webhooks.timeout`, ten seconds, the whole exchange). |
| a connection error    | fails, retried.                                                       |
| a refused address     | **fails, and does not retry** (see below).                            |

Two decisions in there are worth their reasons.

**A redirect is not followed.** A `3xx` is the receiver choosing the next url, _after_ henri checked the one it was given; following it hands back the hole the address check just closed. Stripe treats a redirect as a failure too; henri goes one step further and does not retry it, because three days of retrying a `301` is noise and the fix is a registration change. The error names the `Location`, so the operator can `henri webhooks:update <id> --url <the new one>`.

**Other `4xx` are retried.** A `401` is a token that was rotated a minute ago and a `404` is a deploy that is half done; the backoff is patient enough to outlive both, and what really is permanent ends in the dead letter queue anyway. `410 Gone` is the exception because it means "stop", and henri stops: the endpoint is disabled and nothing else is queued for it.

henri does not honour `Retry-After`. The backoff is the queue's, and a second schedule on top of it would be a second thing to reason about.

### What an operator sees

The queue, because the queue already has this shape:

```bash
henri webhooks:status                          # the endpoints, and the counts below
henri jobs:list --queue webhooks               # what is pending, running, done
henri jobs:dead --queue webhooks               # what ran out of attempts
henri jobs show <id>                           # the endpoint, the event, the error, every attempt
henri jobs:retry <id>                          # send it again
```

`henri jobs show` prints the arguments of the job, which are the delivery id, the endpoint id, the event and the signed body — so a dead delivery says which endpoint, which event, and the receiver's own words in the error.

### Trying one by hand

```bash
henri webhooks:send <id> invoice.paid --data '{"total":4200}'
henri jobs --once
```

`send` goes to that one endpoint whether or not it subscribed to the event, through the queue like everything else — so a runner still has to perform it.

## What a hostile url cannot reach

A webhook url is a string someone else typed into your application, and the process that opens it sits inside your network. That is server-side request forgery, and it is the reason `http://169.254.169.254/latest/meta-data/` (the cloud instance's credentials) and `http://localhost:6379/` (the Redis holding your sessions) are the two examples in every write-up.

henri refuses, **when the request is made**:

- anything that is not `https` — and `http` too, unless `webhooks.allowHttp` says otherwise;
- a url carrying credentials (`https://user:pass@host/`);
- an address in any of these, whichever of the name's answers it is:

| Refused                                         | Because                                      |
| ----------------------------------------------- | -------------------------------------------- |
| `127.0.0.0/8`, `::1`                            | the loopback: everything you run beside this |
| `169.254.0.0/16`, `fe80::/10`                   | link-local, where the metadata service lives |
| `10/8`, `172.16/12`, `192.168/16`, `fc00::/7`   | the private network                          |
| `100.64.0.0/10`                                 | carrier-grade NAT                            |
| `0.0.0.0/8`, `224/4`, `240/4`, `::`, `ff00::/8` | this network, multicast, reserved            |
| `192.0.2/24`, `198.51.100/24`, `203.0.113/24`   | documentation ranges                         |
| `198.18/15`                                     | benchmarking                                 |
| `::ffff:127.0.0.1`, `2002::/16`, `64:ff9b::/96` | an IPv4 address wearing an IPv6 costume      |

Three details that are usually what is missing:

- **at request time, not at registration.** DNS answers differently later: a name that resolved publicly when it was registered resolves to `169.254.169.254` when the delivery goes out. Checking at registration proves nothing about the request.
- **the checked address is the address the socket connects to.** Checking the name and then letting the HTTP client resolve it again re-opens the same hole through the back door, half a millisecond wide — DNS rebinding. henri hands the agent a `lookup` that answers the one address it checked and never asks a resolver again. TLS still validates against the _name_, so pinning costs no certificate warning.
- **one bad answer refuses the name.** A host with an A record on a public address and an AAAA record on `::1` is an attack, not a mistake.

A refused address is a failure that is not retried: it goes straight to the dead letter queue with the address it resolved to, so an operator sees it now rather than in three days.

The answer is read up to 64kb and then the socket is dropped, so a receiver that streams forever holds a runner for one timeout and not a byte more. Nothing in it is parsed; a short excerpt is kept for the operator to read.

`webhooks.allowPrivate` and `webhooks.allowHttp` lift the first two rules. They exist because a development configuration delivers to `http://127.0.0.1:9099`, and `henri audit` reports either of them in a production configuration — `webhooks.private-addresses-allowed` is a **high** finding.

This is the floor, not the ceiling. An application that knows the hosts it sends to should also say so at its egress; a blocklist inside the process cannot see a route the network has.

## Testing

`@usehenri/testing` boots the application, so `henri.webhooks` is there. Stand up a receiver, emit, drain the queue, verify:

```js
const http = require('http');
const { henri, setup } = require('@usehenri/testing');
const { Runner } = require('@usehenri/jobs/src/runner');
const { verify } = require('@usehenri/webhooks');

test('paying an invoice tells the endpoints', async () => {
  await setup();

  const got = [];
  const server = http.createServer((request, response) => {
    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      got.push({
        body: Buffer.concat(chunks).toString('utf8'),
        headers: request.headers,
      });
      response.end('ok');
    });
  });

  await new Promise((done) => server.listen(0, '127.0.0.1', done));

  const endpoint = await henri().webhooks.register({
    url: `http://127.0.0.1:${server.address().port}/hooks`,
    events: ['invoice.*'],
  });

  await henri().webhooks.emit('invoice.paid', { total: 4200 });
  // A delivery is a job: perform what is due instead of running a worker
  await new Runner(henri().jobs.queue).once();

  expect(verify({ ...got[0], secret: endpoint.secret }).ok).toBe(true);

  server.close();
});
```

A test configuration needs `"webhooks": { "allowHttp": true, "allowPrivate": true }`, since a receiver on the loopback is exactly what the address rules refuse.

## Configuration

Everything below has a default; the `webhooks` block only says what differs.

```json
{
  "webhooks": {
    "store": "default",
    "table": "henri_webhooks",
    "queue": "webhooks",
    "maxAttempts": 8,
    "timeout": "10s",
    "backoff": { "base": "10s", "factor": 3, "max": "6h", "jitter": 0.2 },
    "maxFanout": 1000,
    "install": true,
    "allowPrivate": false,
    "allowHttp": false
  }
}
```

See the [configuration reference](/configuration/#the-webhooks-object) for what each key does.

## What this does not do

Deliberately, and each with its reason:

- **Receiving webhooks** — verifying somebody else's signature. Every sender has a different scheme, so the useful thing is not a framework abstraction over all of them but the four lines above, written against their documentation. henri exports `verify()` for its own scheme and stops there.
- **A UI.** The surface is `henri.webhooks.*` and `henri webhooks:*`; a settings page is your application's, in your design, with your authorization. Building it on the API takes an afternoon and building it into the framework takes it away from you.
- **A richer subscription policy** than an event name, a family and `*`. Transformations, filters on the payload, per-event retry policies and fan-out rules are a product, not a framework feature, and the ones who need them know it.
- **Anything that needs a message broker.** The queue is a table in the database the application already runs. That bounds the throughput — a few thousand deliveries a minute, not a million — and it means there is nothing else to deploy, nothing else to monitor and nothing else to lose messages in. If you outgrow it, you have outgrown this on purpose.
- **`Retry-After`.** See above: the backoff is the queue's.
- **Ordering guarantees.** Deliveries are jobs, performed concurrently by however many runners are up; `invoice.paid` may arrive before `invoice.created`. That is true of every webhook system worth trusting, which is why the event carries what the receiver needs rather than a diff. Say so in your own documentation.
