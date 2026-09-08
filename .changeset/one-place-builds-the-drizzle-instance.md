---
'@usehenri/drizzle': patch
---

One place says what a drizzle instance is built with.

A drizzle store builds its database twice, not once. `start()` builds it, and `getSessionConnector()` builds it again on a store with no user model: drizzle bakes the schema into the instance, so the sessions table added afterwards needs a new one. Both named the arguments themselves, three hundred lines apart, and nothing compared them — so anything the first construction were given (a logger, a cache, an instrumentation hook) would be dropped by the second, in an application with sessions and nowhere else.

Nothing is passed today beyond the client and the schema, so nothing was being lost. This is the hardening: `Drizzle#buildDatabase()` is now the only expression that constructs one, both callers go through it, and a test builds the store both ways and compares what each construction was handed — the arity, the client, and every argument past the schema, which is where an option would go. The schema is the one thing allowed to differ, and only by the table the second construction exists to add.

Transactions were checked rather than assumed, on all three dialects of drizzle-orm 0.45: better-sqlite3 hands the transaction the session it already has, and mysql2 and node-postgres build a fresh session for the pooled connection from `this.options`. So transaction traffic inherits whatever the construction was given, and there is no third site.
