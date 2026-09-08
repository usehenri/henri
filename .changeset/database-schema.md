---
'@usehenri/core': minor
'@usehenri/drizzle': minor
'@usehenri/mongoose': minor
'@usehenri/sequelize': minor
'@usehenri/mcp': minor
'@usehenri/cli': minor
---

What the database actually holds, for an agent and for a person.

An agent working on a henri application could ask what the routes really are,
what failed, what was logged and what is in a row -- and could not ask what the
tables are called. The model files do not know: the physical table name, the
column a rename produced (`externalId` is `external_id` in every SQL store
henri writes), the type the dialect chose, an index somebody added by hand and
a table nothing declares any more all live in the database and in the ORM
objects of the running process. So SQL was written from `app/models` and
guessed.

`describe()` is new on the store adapter contract, implemented by
`@usehenri/drizzle`, `@usehenri/mongoose` and `@usehenri/sequelize`: the real
tables of every model with their real columns, types, nullability, defaults,
enum values and indexes, plus the names of the tables no model claims. It reads
the catalogue -- `describeTable()`/`showIndex()` on Sequelize, `pragma_*`,
`information_schema` and `pg_*` on drizzle, `listCollections` and
`collection.indexes()` on Mongoose -- and writes nothing.

MongoDB gets the honest answer rather than the same one: the collections and
the indexes are real, server-side facts, and the fields are henri's own
declaration applied by Mongoose in this process, so the answer carries
`read: "models"`, `enforced: false` and a note saying that a document written
by anything else can hold any shape at all.

`@usehenri/core` serves it at `GET /_henri/runtime/schema`, on the surface the
`query` endpoint already lives on and under the same rules: development only,
loopback only, `X-Henri-Runtime: 1`, and refused outright for anything carrying
`Origin` or `Sec-Fetch-Site`. A column _name_ is never masked -- naming the
columns is the point, and `password` is a column an agent has to be able to see
-- while a column _default_ goes through the same redaction a query row does,
by the column's own name and by shape. Bounded at 50 tables a store, with
`?store=` and `?table=` to narrow. A SQL store also carries `drift`, the same
report `henri db:status` prints, without the DDL: nothing on this surface
writes.

`henri mcp` exposes it as the `schema` tool, and `henri db:schema
[--table=<name>] [--store=<name>] [--json]` is the same answer for a person at
a terminal, with no running server needed. It is the half `henri db:status`
never answered: `db:status` says what is _wrong_ and says nothing at all when
the answer is "nothing", `db:schema` says what is _there_ -- and it is the only
one of the two a `mongoose` store has ever been able to answer.
