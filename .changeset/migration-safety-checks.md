---
'@usehenri/drizzle': minor
'@usehenri/core': minor
'@usehenri/cli': minor
---

Migration safety: a generated migration is read back before it runs

`henri db:generate` writes what drizzle-kit computed, and drizzle-kit will
happily write a statement that takes a production database down. henri now
scans the generated SQL -- the SQL, not the model diff, because the SQL is
what runs -- and reports a dropped or renamed column or table, a `NOT NULL`
column with no default, a type change, an index build and a `DELETE` or
`UPDATE` with no `WHERE`.

`db:generate` warns and writes the file anyway: generating is a development
act and the developer is right there. A **production** `henri db:migrate`
refuses (`HENRI_MIGRATION_UNREVIEWED`) until the migration's token is in
`config.migrations.approved`, and applies nothing at all, not even the safe
migrations queued ahead of it; a production boot with `"migrate": true` on the
store goes through the same call. `henri db:status` and `henri doctor`
(`schema.unreviewed`) report what the deploy is going to refuse, before the
deploy.

Which checks bite is measured per dialect rather than ported from a
Postgres-shaped list. An index build is a postgres problem alone -- it holds a
`ShareLock` there, while MySQL 8 accepts `ALGORITHM=INPLACE, LOCK=NONE` and
sqlite has no concurrent form to point at. A `NOT NULL` column with no default
does not even fail the same way: sqlite and postgres refuse the statement once
the table has a row, and MySQL 8.4 accepts it and writes an empty string or a
zero into every existing row without a warning. `CONCURRENTLY` is named as the
fix and is explicitly _not_ told to go in the migration file, because drizzle
applies every pending migration inside one transaction and postgres refuses
`CONCURRENTLY` in a transaction block.

The escape is a token in the configuration, the way `config.retention.approved`
works, rather than a flag: `henri db:migrate --force` in a deploy script would
be written once and then turn the check off for every future migration, while a
token names one migration and goes stale when its findings change.
`"migrations": { "approve": false }` is the blanket way out and `henri audit`
reports it in a production configuration (`migrations.unreviewed`).

The SQL is read by a scanner that walks it rather than a regular expression
that matches it: comments, string literals (whose content it throws away
rather than skips over), postgres dollar quoting and each dialect's identifier
quotes are lexed, so a migration that only _mentions_ `DROP COLUMN` inside a
string is not a finding. Two rules exist to keep a false refusal from
happening -- a table created by the same migration has no rows, and sqlite's
copy-and-rename table rebuild is recognized by its shape and reported once as
what it is.

New configuration: `migrations.approve` and `migrations.approved`.
