---
'@usehenri/drizzle': patch
---

Fix the adapter on live PostgreSQL and MySQL servers, now that the suites run against both.

A unique violation answers a `ValidationError` again: drizzle-orm reports the failures of its asynchronous drivers wrapped in a `DrizzleQueryError`, so the dialects unwrap the cause before reading the constraint, and the MySQL constraint name is kept.

A push on MySQL (`henri db:push` and the development boot) creates the tables that are missing instead of doing nothing: drizzle-kit answers the data loss of a MySQL push but never the DDL it would run. A table whose columns drifted from the model is reported — run `henri db:generate` then `henri db:migrate` for it — and the tables drizzle-kit suggests truncating are left alone.
