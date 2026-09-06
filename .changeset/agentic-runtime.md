---
'@usehenri/core': minor
'@usehenri/mcp': minor
'@usehenri/cli': minor
---

An agent can ask the running application, not only read its files.

`henri mcp` gains seven tools that answer against a booted henri instead of
the source: `errors` (the last failures with their stack and the request that
caused each one, keyed by `X-Request-Id`), `logs` (the lines `henri.pen` wrote,
by level, by text or by request id), `query` (one read against a store through
its adapter), `records` (a page of a model, or one record, read through the
model rather than the driver), `runtime_routes` (what the router actually
mounted, including the routes whose controller is missing), `request` (make one
request against the application and read the status, the headers, the body and
the request id) and `guide` (henri's own documentation at the version
installed, shipped with the package). A new `henri://runtime` resource
describes the process that answered.

The MCP server attaches to the development server already running when it finds
one -- that is where the errors, the logs and, with the `disk` store, the
database are -- and starts one itself otherwise, stopping it when the editor
disconnects. Every answer says which of the two happened and on which url.
`HENRI_MCP_AUTOSTART=0` forbids starting one.

`@usehenri/core` grows the surface behind it: `GET/POST /_henri/runtime`
(`src/base/runtime.js`), mounted only outside production and only for the
loopback interface, requiring `X-Henri-Runtime: 1` and refusing anything
carrying `Origin` or `Sec-Fetch-Site`. It answers reads only: one `SELECT`,
`WITH ... SELECT`, `EXPLAIN`, `SHOW` or `DESCRIBE`, checked with its strings
and comments removed, and refused with the offending word if anything that
writes, locks, waits or reads a file survives. Everything it answers is
redacted with `filterParameters` (`password` always) and bounded, and says when
it truncated. Nothing is recorded in production: no ring buffer, no endpoint,
no opt-in.
