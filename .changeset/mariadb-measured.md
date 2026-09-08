---
'@usehenri/drizzle': patch
'@usehenri/sequelize': patch
'@usehenri/core': patch
'@usehenri/mysql': patch
---

MariaDB is exercised, and what does not work there is written down

`@usehenri/mysql` has said it serves MariaDB since the first release and nothing had ever run against one. It runs now: `HENRI_TEST_MARIADB_URL` points the SQL suites at a MariaDB server the way `HENRI_TEST_MYSQL_URL` points them at MySQL (`pnpm test:sql:mariadb`, a `mariadb` service in `compose.yaml`), and `packages/drizzle/__tests__/mariadb.spec.js` asserts what that server does differently. Measured on MariaDB 10.11.19 and 11.8.9, which behave identically here, against MySQL 8.4.

**Two things do not work on MariaDB, and neither is henri's.** Both are in the models guide now, with what to do instead.

- **`include()` is a syntax error.** drizzle-orm 0.45's MySQL dialect eager loads with `LEFT JOIN LATERAL (...) ON TRUE`, and MariaDB has no `LATERAL` derived tables in any version. `include`, and the `embeds` that read through the same path, raise 1064 from the server. henri writes none of that SQL and has no seam to write it differently, so load the association with a second query.
- **`henri db:push` cannot read the schema back**, which takes the development boot with it. drizzle-kit 0.31 introspects before it pushes and its check-constraint pass reads the wrong column name out of its own query — dead code on MySQL 8, which has no check constraints there, and live on MariaDB, where `JSON` is `LONGTEXT` with a `CHECK (json_valid(...))` next to it and the user model's `roles` is a `json` column. The first push of an empty database works and every one after it fails. Set `"sync": false` on the store and use `henri db:generate` then `henri db:migrate`, which do work, as do `db:schema:dump`, `db:schema:load`, `db:status` and `describe()`.

**Three fixes came out of measuring it.**

`henri db:push` no longer dies without a word. drizzle-kit renders its own progress and, when the task behind it rejects, hands the error to a renderer that prints a spinner and then calls `process.exit(1)` — so a schema it could not read took `henri db:push`, the development boot or a test worker down with exit code 1 and nothing to read. `Migrations#plan()` now runs it guarded: the exit is caught and raised as the new `HENRI_MIGRATION_PUSH_FAILED`, on every dialect.

`henri db:generate` writes the migration even when it cannot read the database back afterwards. Recording a migration as already applied is bookkeeping for a database that was pushed to the same schema; the file is written before that, so a plan that fails now leaves the migration pending — the safe answer, and the one `henri db:migrate` acts on — with a warning naming what happened, instead of failing the command that had already written the file.

`henri db:schema:dump` is correct on MariaDB. `information_schema.COLUMNS.COLUMN_DEFAULT` is a **value** on MySQL and an SQL **expression** on MariaDB: the four letters `NULL` where there is no default, `'hi'` already quoted, `current_timestamp(3)` with nothing in `EXTRA`. henri read it MySQL's way, so a dump taken from MariaDB gave every nullable column `DEFAULT 'NULL'` — a four letter string on a `varchar`, and a statement the server refuses on a `datetime`. It reads the server now.

And on the Sequelize side, `henri db:status` stops reporting a drift that can never close. `Drift#report()` asks the server what it is (`SELECT VERSION()`) rather than trusting the dialect of the connection, because MariaDB is reached through the MySQL dialect and mysql2; a `json` column there is a `LONGTEXT`, which used to be reported as `LONGTEXT instead of JSON` with an `ALTER TABLE ... CHANGE ... JSON` the server accepts and which changes nothing. `report().dialect` is `mariadb` on a MariaDB server.
