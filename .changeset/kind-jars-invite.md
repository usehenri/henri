---
'@usehenri/core': minor
'@usehenri/cli': minor
---

Maintenance mode, and `henri runner`: the two things an operator had no way to do.

**Maintenance mode.** `henri maintenance:on [--message] [--retry-after]`,
`henri maintenance:off` and `henri maintenance` close an application and open
it again **without a deploy and without a restart**. The switch is state every
running process re-reads on the way into a request, at most once every
`config.maintenance.poll` (a second) and deduplicated, so a burst of requests
costs one read. It lives in the shared store when `config.shared` names one --
every process on every machine -- and in `.henri/maintenance.json` otherwise,
which reaches that machine only; the boot line says which is in play.

A closed application answers `503` with a `Retry-After`, negotiated: the page
for a browser (`app/views/maintenance.html` when the application ships one),
the boom envelope carrying `HENRI_MAINTENANCE_ON` for an API client. The answer
is never cached. `/livez` and `/readyz` keep answering `200`, with
`"maintenance": true` in the readiness body -- a readiness that said no would
empty the load balancer of every backend at once and hand the visitor the
proxy's error page instead of yours; `maintenance.readyz: "unavailable"` is
there for the deployment that wants the opposite. The guard is mounted before
the sessions, the CSRF check, the rate limit and the static files, so a refused
request touches no store.

`henri maintenance:on` prints a bypass url carrying a token signed against that
window (HMAC over `config.secret`, seeded with the window id), so an operator
can check the application while it is closed and `maintenance:off` invalidates
it. `henri audit` reports `maintenance.bypass: "loopback"` in a production
configuration (`maintenance.loopback-bypass`), which behind a proxy would let
everybody through.

New: `config.maintenance`, `henri.maintenance`, the `HENRI_MAINTENANCE_*`
codes, and the [Maintenance mode](https://usehenri.io/guides/maintenance/)
guide.

**`henri runner`.** `henri runner '<expression>'`, `henri runner <file>` and
`henri runner -` run code inside a booted application and exit, with the
globals an application has. A value is printed, a thrown error or a rejected
promise exits 1 with the stack, and it boots to runlevel 4 like `henri jobs`:
no port is bound at any point.
