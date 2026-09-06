---
'@usehenri/cli': minor
---

`henri db:create`, `db:drop` and `db:reset`

`henri db:migrate` connects to a database. It cannot make one, so every application wrote that step by hand — the showcase in this repository carried a `db/create.js` doing exactly it — which is a framework telling on itself, since it is the same twenty lines for everybody.

```bash
henri db:create                 # the database config/<env>.json points at
NODE_ENV=test henri db:reset    # drop, create, migrate, seed
henri db:drop --force           # in production, asked for twice
```

`db:create` reads the configuration, the environment, `DATABASE_URL` and the encrypted credentials the way henri does and stops there, because a store cannot connect to a database that does not exist yet. Then it talks to the server with the driver the application already installed: PostgreSQL and MySQL on the server's maintenance connection, SQLite as a file, and MongoDB not at all, since it makes a database on its first write and saying so is more useful than pretending to act. Running it twice is not an error.

`db:reset` drops, creates, brings the schema up — from `db/migrations` when the application has migrations, from the models when it does not, which is the same choice a `henri server` boot makes on a fresh database — and runs `db/seeds.js` when it exists.

`db:drop` and `db:reset` refuse to act when `NODE_ENV` is `production` unless `--force` says it was meant. A database name is an identifier, so it is checked against a character set and quoted rather than bound as a parameter, and nothing printed by these commands carries the store's password.
