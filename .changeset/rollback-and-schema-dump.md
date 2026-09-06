---
'@usehenri/drizzle': minor
'@usehenri/cli': minor
---

`henri db:rollback` and `db/schema.sql`

Two things Rails has that the migration story here did not: undoing the last migration, and one file saying what the database actually looks like.

```bash
henri db:rollback              # the last migration
henri db:rollback --step=2     # the last two, newest first
henri db:schema:dump           # writes db/schema.sql from the database
henri db:schema:load           # creates that schema in an empty database
```

**Rolling back.** drizzle-kit generates forward-only SQL, so there is no `down` — and the three ways to get one are not equally honest. A hand-written `down.sql` puts the inverse of a computed diff on the person least able to check it, and rots silently because nothing runs it until the day it matters. Writing one at `db:generate` time freezes that same inverse, in a folder that invites hand-edits (drizzle-kit's own answer to a rename is "edit the generated SQL"), so it goes wrong in the direction nobody looks. henri does neither: it computes the inverse **when you ask for it**, by handing drizzle-kit the two snapshots `db/migrations/meta` already holds in the other order. Nothing new is stored, nothing can go stale, and what runs is the inverse of the schema `db:status` believes in.

It refuses three things rather than lying about them:

- **A migration that removed a table or a column** (`HENRI_MIGRATION_IRREVERSIBLE`). Its inverse would recreate them empty, and an empty column is not the column that was dropped. There is no flag for this one: undoing a destructive migration is a restore from a backup, and henri will not pretend otherwise.
- **A migration whose `.sql` changed since it was applied** (`HENRI_MIGRATION_EDITED`). The database records the sha256 of the file it ran; when the file on disk hashes to something else, henri does not know what ran and will not guess.
- **A rollback that would drop rows that are there** (`HENRI_MIGRATION_DESTRUCTIVE`). Not "a statement that matches `DROP`" — the tables and columns the inverse removes are counted first. Undoing the migration you applied a minute ago on a database nothing was written into is quiet; one that would take 412 rows away says so and needs `--force`, the way `db:push` already does.

Rolling back moves the database, not the folder: the `.sql` and its snapshot stay where they are, `db:status` reports the migration pending again, and `db:migrate` applies it again.

**The dump.** `db/schema.sql` is read from the **database**, not from the migration chain. A dump built from the chain agrees with the chain by construction: it is a second copy of files already in the repository, and it can never catch the `ALTER` somebody ran by hand or the `db:push` that was never turned into a migration — which are the two reasons to read a dump at all. The cost is that it is written where a database is reachable, and it is not hidden.

Two runs against the same schema give the same bytes: tables ordered by name, indexes and foreign keys by their statements, columns in the position the database keeps them. MySQL is read through `information_schema` rather than `SHOW CREATE TABLE`, which prints the `AUTO_INCREMENT` counter and would move the file on every insert. The header names the migration the database was at, so the dump and `db:status` cannot disagree.

Loading it is supported. `db:schema:load` creates everything the dump describes and records the migrations through the one it names as applied, leaving anything newer pending — which is how a test database is built without replaying the chain. It refuses a table it would create that already exists (`HENRI_MIGRATION_DATABASE_NOT_EMPTY`) and never empties a database to get its way, so it has no `--force`; a table the dump says nothing about is left alone.

An `mssql` store answers neither (it is on Sequelize, it has no migration history for a dump to name, and `db:status` reads it back instead), and a `mongoose` one has no schema to write down. Both say so with `HENRI_CLI_MIGRATIONS_UNSUPPORTED` rather than doing half of it.

Also fixed: `henri db:generate` recorded a migration as applied on MySQL whenever the push it checks against had no statements — which on MySQL is also what a drifted table looks like, since drizzle-kit does not alter one there. A drifted table is now part of that answer, so the history stops claiming a migration ran that did not.
