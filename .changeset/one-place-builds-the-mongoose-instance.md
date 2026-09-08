---
'@usehenri/mongoose': patch
---

One place says what a Mongoose instance is built with.

The same hardening as `@usehenri/drizzle`'s, one adapter over. A mongoose store builds its Mongoose instance twice: the constructor builds one, and `stop()` builds another so that a store started again does not reuse the connection it disconnected. Both spelled `new mongoose.Mongoose()` themselves, nine hundred lines apart, and nothing compared them.

Nothing configures the instance today — the plugins are registered per schema in `addModel()` and the connect options are `connectOptions()` — so the two were identical and nothing was being lost. `Mongoose#newConnection()` is now the only expression that builds one, and a test compares what the two instances hold across a stop: an instance-wide `set()` or plugin added to one construction and not the other would otherwise leave a restarted store configured differently from a fresh one, with nothing to say so.
