---
'@usehenri/sequelize': patch
'@usehenri/mssql': patch
---

**The suites run against a real SQL Server.** `@usehenri/mssql` is a
published package whose only coverage was the DDL it generates, checked as
strings, offline -- so an application on SQL Server was running code that
had never been executed. `compose.yaml` has the server now and
`HENRI_TEST_MSSQL_URL` (`pnpm test:sql:mssql`) points the `sequelize`,
`mssql`, `jobs` and `webhooks` suites at it, the way the other two
variables already point them at PostgreSQL and MySQL. Most of it worked:
the claim statement of the job queue
(`UPDATE ... WHERE id IN (SELECT TOP (n) ... WITH (UPDLOCK, READPAST))`),
the concurrency permits and the batch counters with four runners and four
connection pools, the `OFFSET ... FETCH NEXT` paging, `DATETIMEOFFSET`
keeping its milliseconds across a UTC+14 write and a UTC-11 read, the
retention sweep, the access trail and its hash chain, the versions, the
encryption envelopes, the slugs, the declared filters and embeds, the CSV
cursor, `describe()` and the `ALTER` that `henri db:status --sql` writes.
Two things did not.

**`decimal` is refused on an `mssql` store at boot**
(`HENRI_MODEL_TYPE_UNSUPPORTED`, naming the model and the field), the way
it already is on a sqlite one served by this adapter. The `tedious` driver
reads every `DECIMAL` and `NUMERIC` as `value / Math.pow(10, scale)`, so
the column comes back a JavaScript double however it was declared:
`DECIMAL(12, 2)` `-2.50` read back as `-2.5`, and `DECIMAL(38, 10)`
`12345678901234567890.1234567891` read back as `12345678901234567000`.
There is no driver option for it and no parser above it, so the digits are
gone before henri sees them -- silently, which is exactly what the exact
types exist to prevent. `bigint` is unaffected and exact: that driver hands
a `BIGINT` back as a string, and the suite writes and reads both ends of
the signed 64-bit range. An amount on SQL Server goes in a `bigint` of its
smallest unit.

**A duplicate now answers the field it was about.** SQL Server names an
inline `UNIQUE` itself (`UQ__Articles__32DD1E4C507CA19A`) and Sequelize
then looks that name up among the ones it computed itself, misses, and
reports the constraint name where the column belongs -- so
`henri.model.errors()` answered
`{ UQ__Articles__32DD1E4C507CA19A: '... must be unique' }` instead of the
`{ slug: 'must be unique' }` every other store answers, putting the
database's internal naming in a 422 body. henri writes
`CONSTRAINT [Article_slug_unique] UNIQUE ([slug])` instead, for the columns
a model declares and the ones henri adds (`externalId`, `slug`, `email`).
Only on SQL Server: the other three dialects report the column themselves.
`sequelize.sync()` does not rename a constraint on a table that already
exists, so a database created before this keeps the name it has.
