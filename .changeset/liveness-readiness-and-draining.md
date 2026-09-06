---
'@usehenri/core': minor
'@usehenri/cli': minor
---

Answer liveness and readiness separately, and drain the requests in flight on `SIGTERM`.

**Two probes, not one.** `GET /livez` says the process is running and answering; it never touches a store, because a database outage must not restart a process that is otherwise healthy — the restart fixes nothing and the loop drops every request the container was serving. `GET /readyz` says it can serve traffic: the stores answered, the boot is finished and no shutdown has started; anything else is a `503` with a `reason` (`starting`, `shutting down`, `a store did not answer`). `GET /_henri/health` stays, as an alias of readiness, so a deployment already pointing at it keeps working. All three are unauthenticated and run before the session and the limiters, as the health check always did. There is no `/healthz`: the name does not say which of the two questions it answers and deployments wire it to both, so point a probe that only knows that path at `/readyz`.

**A store failure no longer echoes the driver.** The body says `"error": "timeout"` or `"error": "unreachable"` instead of the message the driver raised, which carries the connection string — with its user and sometimes its password — and was in the body of every non-production answer. The message is still logged.

**`SIGINT` and `SIGTERM` drain.** They used to stop the modules straight away, which cut whatever was being served: a rolling deploy could answer half a request. Now readiness turns `503` while the port is still open, so a load balancer that polls has a chance to stop sending; `config.shutdown.delay` (`0`) keeps serving that long; the listener closes and the idle keep-alive sockets are hung up, which is what would otherwise hold the close open for their whole idle timeout; the requests in flight run to their end within `config.shutdown.drain` (10 seconds) before their sockets are destroyed, with a line in the log saying how many; and only then does `henri.stop()` walk the modules backwards. Keep `delay + drain` under your platform's termination grace period.

`config.shutdown.signals: false` leaves the signals to an application that wants to own them, which then calls `henri.server.shutdown('SIGTERM')` itself. A `henri jobs` runner never starts the server and keeps draining its own way: it stops claiming, finishes the jobs it holds and writes their outcomes.
