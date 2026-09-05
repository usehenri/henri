---
'@usehenri/cli': minor
'@usehenri/mcp': minor
'henri': minor
---

`henri new` and `henri init` take `--adapter disk|drizzle|mongoose|mysql|postgresql|mssql` (and `--dialect sqlite|postgres|mysql` with drizzle) to pick the store of the new application. `disk` stays the default, so nothing changes without the flag.

The adapter drives the whole scaffold: the store block of `config/default.json`, a `config/test.json` on its own database, the dependencies and the driver (`better-sqlite3`, `pg` or `mysql2` for drizzle, allow-listed in `pnpm-workspace.yaml` when it needs a build), the README and AGENTS.md, and the sample `Task` resource. `henri generate scaffold|crud` now reads the adapter back from the configuration and writes a controller against the model API that store really has: Mongoose on `disk` and `mongoose`, Sequelize (`findAll`, `findByPk`, `row.update()`) on `mysql`, `postgresql` and `mssql`, the Rails-like Drizzle model (`query().offset().limit()`, `count`, `findByIdAndUpdate`) on `drizzle`. `henri doctor` knows the new combinations, including the driver a drizzle dialect needs.
