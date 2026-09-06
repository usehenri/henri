---
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/redis': minor
---

`config.shared`: one backend for the counters that only worked with one process

The rate limit, the sign-in lockout and the idempotency keys each keep a
number per key, and all three were kept in the process's memory unless the
application named a store in three separate configuration keys. Two processes
therefore meant two sets of counters: a rate limit that is twice what it says,
a lockout an attacker escapes by being routed elsewhere, and an idempotency
key that stops being idempotent.

`config.shared` is the one place to say where they live instead:

```json
{
  "shared": {
    "adapter": "redis",
    "url": "redis://127.0.0.1:6379",
    "prefix": "lineup:",
    "onError": "closed"
  }
}
```

`@usehenri/redis` is the backend, a package an application installs
(`pnpm add @usehenri/redis`), resolved from the application the way a store
adapter is; nothing is added to an application that does not name it. It talks
to Redis through node-redis and counts the rate limits with `rate-limit-redis`.
`rateLimit.store`, `user.lockout.store` and `api.idempotency.store` keep
working and still win, key by key.

When the backend does not answer, `shared.onError` decides: `closed` (the
default) refuses the request with a `503` and a `Retry-After`, `open` serves it
uncounted; either is logged, at most once every ten seconds per counter. The
idempotency keys are always closed, whatever `onError` says. A backend that is
unreachable at boot does not fail the boot: the client keeps reconnecting and
`GET /readyz` reports it (`"shared": { "ok": false }`), so the process leaves
the load balancer instead of the fleet.

The boot says which it is on every application -- `counted in redis (fail
closed)` or `counted in this process` -- and warns outright when the
environment says this process is one of several (a cluster worker, a numbered
pm2 instance, `WEB_CONCURRENCY`, a Heroku dyno past the first) and no shared
backend is configured. `henri doctor` reports a shared store that does not
answer (`shared.unreachable`) and asks for the adapter package when the
configuration names one; `--no-reach` skips the connection.

Sessions are not part of this: they already go through the database adapter,
which every process shares.
