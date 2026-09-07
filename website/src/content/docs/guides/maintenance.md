---
title: Maintenance mode
description: How an application says "not right now" -- a switch thrown from a shell, picked up by every running process, with a 503 a visitor can read and a signed url only the operator has.
---

Some things cannot be done while an application is serving: a migration that
cannot run online, a data repair, an incident where the safest move is to stop
taking writes. All three happen at a moment when a deploy is the last thing
anybody wants to attempt, so maintenance mode is deliberately not a deploy: it
is a switch, thrown from a shell, that every running process reads again within
a second.

```bash
henri maintenance:on --message "Back at 04:00 UTC" --retry-after 1800
henri maintenance          # what the switch says, and a url to check with
henri maintenance:off
```

Nothing restarts. Nothing is rebuilt. The processes serving traffic pick the
change up on the way into their next request.

## What a visitor gets

A `503` with a `Retry-After`, [negotiated](/guides/api/) the way henri
negotiates every other failure it owns: a page for a browser, the envelope for
an API client, plain text for anything else.

```
HTTP/1.1 503 Service Unavailable
Retry-After: 1800
Cache-Control: no-store
Content-Type: application/json

{
  "statusCode": 503,
  "error": "Service Unavailable",
  "message": "Back at 04:00 UTC",
  "code": "HENRI_MAINTENANCE_ON",
  "data": { "retryAfter": 1800, "since": "2026-09-06T20:51:39.172Z" }
}
```

The answer is never cached. A proxy that kept a `503` would go on refusing
traffic after the window ended, which is an outage nobody asked for and which
is invisible from the machine.

Put an html file at `app/views/maintenance.html` and henri serves that instead
of its own page. It is read as it is -- the view engine is not involved, and
may not even be loaded yet -- with `{{message}}`, `{{retryAfter}}` and
`{{since}}` replaced by the escaped values of the window:

```html
<!doctype html>
<title>Lineup</title>
<h1>We are repairing the seating chart</h1>
<p>{{message}}</p>
<p>Started {{since}}.</p>
```

Keep it self-contained. The guard is mounted before the static file
middleware, so a closed application serves no stylesheet, no image and no
bundle: inline what the page needs.

## Where the switch lives

Two places, and the boot line says which:

```
maintenance  .henri/maintenance.json => off, checked every 1000ms
maintenance  redis => off, checked every 1000ms
```

- The [shared store](/configuration/#the-shared-object) when `config.shared`
  names one. It is already henri's answer to "state several processes must
  agree on", so one `henri maintenance:on` reaches every process on every
  machine.
- A **file** otherwise, `.henri/maintenance.json` by default. It reaches every
  process on _that_ machine and nothing else.

That second limit is real and worth saying plainly: a deployment spread over
several hosts, with no `config.shared`, has to throw the switch on each host.
If the application is more than one machine, name a shared store -- it is the
same one the rate limit, the sign-in lockout, the idempotency keys and the
cache use, and it is one block of configuration:

```json
{
  "shared": { "adapter": "redis", "url": "redis://10.0.0.4:6379" }
}
```

`maintenance.switch` pins one of the two for an application that wants the
file even though it has Redis -- taking one machine out by hand, say.

A record in the shared store carries a thirty-day expiry, because a key there
needs one. A maintenance nobody remembers to end is a worse outcome than one
that reopens by itself after a month; the file has no equivalent and needs
none, since it is a file in the application directory where it can be seen.

## How a running process notices

Every process re-reads the switch at most once every `maintenance.poll`
milliseconds (one second by default), on the way into a request, and the reads
are deduplicated: a burst of a thousand concurrent requests causes one read,
not a thousand. So the cost of the feature on a normal request is a comparison
against a number, and the cost of throwing the switch is one round trip per
process per second.

A read that fails does **not** close the application, and does not open one
either. The last known state stands, and the failure is logged at most once
every ten seconds:

```
maintenance  redis => unreadable, leaving the application open: connection refused
```

That is the same reasoning as [the cache](/guides/caching/): a Redis blip must
not be able to take an application down, and a switch that cannot be read is
not a switch that was thrown.

## What the health probes say

This is the decision worth reading before you wire a probe at it.

| Probe          | While closed | Why                                                                                     |
| -------------- | ------------ | --------------------------------------------------------------------------------------- |
| `GET /livez`   | `200`        | The process answers. Restarting it does not end the maintenance; it loses the work.     |
| `GET /readyz`  | `200`        | With `"maintenance": true` in the body. It _wants_ the traffic: it is serving the page. |
| `GET /healthz` | `200`        | The alias of readiness, so the same answer.                                             |

Liveness is the easy half, and it is the same answer [the
drain](/guides/api/#health-checks) gives: a liveness probe that fails restarts
the container, and a container restart fixes nothing here, because the
application is closed on purpose and the next process will read the same
switch.

Readiness is the interesting half. Readiness means "send me traffic", and
during maintenance this process wants the traffic -- it is serving the `503`
and the page deliberately. Answering `503` there instead would take **every**
backend out of the pool at the same instant, because every process is in
maintenance at once, and then:

- the visitor gets the load balancer's own error page instead of the message
  you wrote, which is the one thing maintenance mode exists to produce;
- the bypass url stops working, because your request is routed by the same
  load balancer that now has no backends;
- a rolling deploy stalls on instances that never turn ready -- and that
  deploy is often what ends the maintenance;
- a deployment that pointed its liveness probe at `/healthz` (which answers
  readiness, and is the ambiguous name for exactly this reason) restarts the
  processes doing the work.

Draining is the opposite case and gets the opposite answer, which is why the
two are not the same code: a drain is about _this_ process going away while
its peers stay up, so taking it out of the pool is exactly right. A shutdown
during a maintenance is still a shutdown: `/readyz` says `shutting down`.

If your deployment really does want to be pulled out of the pool -- an edge
that serves its own maintenance page, typically -- say so:

```json
{ "maintenance": { "readyz": "unavailable" } }
```

## Getting through while it is closed

Somebody has to check the application while it is closed, and that somebody
must not be everybody. `henri maintenance:on` prints a url:

```
  Closed         since 2026-09-06T20:51:39.172Z (0s ago)
  Message        Back at 04:00 UTC
  Retry-After    1800s
  Switch         .henri/maintenance.json (file, the processes on this machine only)

  Every process picks this up within 1000ms. Nothing was deployed and nothing restarted.

  Check the application yourself with this url. It is signed
  against this window, so henri maintenance:off ends it:

    https://example.com/?maintenance=h1.eyJleHAiOjE3ODg3...
```

The token is an HMAC over `config.secret`, [signed the same
way](/guides/users/) a password reset link is, with the id of _this_ window as
its seed. Three properties follow from that:

- it cannot be forged without the secret, so it is not something anybody can
  send -- which a header would be;
- it dies when the window does. `henri maintenance:off` and a second
  `maintenance:on` both mint a new window id, and every token from the old one
  stops verifying;
- nothing token-shaped is stored anywhere, so there is nothing to clean up and
  nothing to leak.

Presenting it once sets an `HttpOnly` cookie, so the rest of the visit goes
through normally -- you can log in, click around and read pages. Without a
`secret` the application mints no token and nothing gets through, which
`henri maintenance:status` says.

`maintenance.bypass: "loopback"` adds "and anything connecting from this
machine", which is the operator with a shell. **Do not put it in a production
configuration.** Behind a reverse proxy, a sidecar or a container network,
every request arrives from `127.0.0.1`, so a closed application would serve
everybody as usual. `henri audit` reports the pair
(`maintenance.loopback-bypass`).

## What a closed application does not do

The guard is mounted after the health endpoints and before everything else, so
a refused request opens no session, runs no CSRF check, counts against no rate
limit, touches no store and reaches no controller. It costs one comparison and
one `res.send`.

Two consequences worth knowing:

- The rate limit is mounted after the guard, so requests refused by
  maintenance are not counted. The answer is a static string, cheaper than
  counting it would be.
- Background work is not stopped. `henri jobs` runners keep claiming and
  performing, recurring jobs keep firing, and the
  [retention sweep](/guides/retention/) still runs on its schedule.
  Maintenance closes the front door; it does not pause the queue. Stop the
  runners as well if the repair needs the database to itself.

## From your own code

`henri.maintenance` is the switch, always there:

```js
await henri.maintenance.on({ message: 'Migrating', retryAfter: 600 });
henri.maintenance.closed; // true
await henri.maintenance.status();
await henri.maintenance.off();
```

`status()` reads the switch fresh and answers what
`henri maintenance:status --json` prints, bypass token included. `closed`
answers from the last read, which is what the middleware uses and what you
want inside a request.

## The commands

```bash
henri maintenance [--json]
henri maintenance:on [--message=<text>] [--retry-after=<seconds>] [--by=<name>] [--json]
henri maintenance:off [--json]
```

All three boot to the server module: no port is bound, no route is registered
and **no database is opened**. A command an operator runs during an incident
has no business needing the thing that is broken.

`--json` prints the record on stdout and sends the boot log to stderr, so a
runbook can read it:

```bash
henri maintenance --json | jq -r 'if .on then "closed since \(.since)" else "open" end'
```

## Turning it off entirely

```json
{ "maintenance": false }
```

No middleware, no read, no switch. `henri maintenance:on` then refuses with
`HENRI_MAINTENANCE_DISABLED` rather than pretending to have closed anything.
