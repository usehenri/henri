---
'@usehenri/sequelize': minor
'@usehenri/postgresql': minor
'@usehenri/mysql': minor
'@usehenri/mssql': minor
'@usehenri/core': minor
'@usehenri/cli': minor
---

A Sequelize store stops changing the production schema by itself, and `henri db:status` reads it back

Until now every SQL boot ran `sequelize.sync()`, in every environment. In development that is the point; in production it was DDL applied at boot, from whatever the models happened to say, with nobody reviewing it — and because `sync()` only creates what is missing and never alters what exists, it also hid every table that was already wrong.

A production boot now changes nothing. It compares the database with the models instead and warns about each difference. A store that wants the old behaviour asks for it with `"sync": true`, which `henri audit` reports as `schema.autosync`. Development is unchanged, and so is the drizzle adapter, which already refused to push in production.

`henri db:status` now answers on a Sequelize store (`mysql`, `postgresql`, `mssql`), which is the one `db:` command they can honestly serve: it reports a missing table, a missing column, a column whose type or nullability differs, a missing index, and a column that is in the database and in no model. `--sql` writes the DDL that would close the difference, for you to read and run — henri applies none of it and never writes a `DROP`. `--json` carries `clean` and the differences, so a deploy can check that production matches the code. On sqlite a column change is reported without a statement, because sqlite has no `ALTER COLUMN`.

The Sequelize adapters still have no migrations and are not getting any: generated, versioned migrations are the drizzle adapter's, and the upgrade guide now documents the path from a `sync()`-built database to drizzle migrations without dropping it. `henri db:generate`, `db:migrate` and `db:push` on a Sequelize store answer the new `HENRI_CLI_MIGRATIONS_UNSUPPORTED` and point there. `henri doctor` gained `schema.migrations-ignored` and `schema.migrations-pending`.
