---
'@usehenri/core': minor
'@usehenri/drizzle': minor
'@usehenri/mongoose': minor
'@usehenri/sequelize': minor
'@usehenri/cli': minor
---

**`decimal` and `bigint` are henri types.** The vocabulary had no exact
number: a model asking for `DECIMAL` got a `double` and one asking for
`BIGINT` got a 32-bit `integer`, so money was binary floating point on the
default adapter and a large identifier was a column that refused every
insert past 2,147,483,647.

`decimal` takes a `precision` (total digits, 19 by default, 38 at most --
what every dialect henri writes carries) and a `scale` (digits after the
point, 4 by default). `bigint` is a signed 64-bit integer and takes
neither. Per dialect: `numeric(p, s)`/`bigint` on PostgreSQL,
`decimal(p, s)`/`bigint` on MySQL, `Decimal128`/BSON `BigInt` on MongoDB,
`DECIMAL(p, s)`/`BIGINT` on SQL Server, and `text` on sqlite, which has
neither an exact decimal nor a 64-bit integer better-sqlite3 hands back
whole. The stored value is exact everywhere; on sqlite a comparison and an
order go through a cast, `INTEGER` for a `bigint` (exact, sqlite carries
64 bits) and `REAL` for a `decimal` -- the one approximation, and the guide
says so.

**A value of either type is an exact decimal string in JavaScript**, on all
three adapters: `'19.99'`, `'9223372036854775807'`. Not a `number`, which
is what the column choice exists to avoid; not a `BigInt`, which
`JSON.stringify` throws on and henri serializes records in a dozen places;
not an object, which needs a dependency and survives JSON no better.
node-postgres, mysql2 and `Decimal128.toString()` already hand back
strings, so it is the shortest path rather than a conversion. On the way in
henri takes a string, a `number` (through its shortest round-tripping
representation, so `19.99` is `'19.99'`) or a `BigInt`. The validators, the
JSON serialization, the HAL payloads, the OpenAPI description (a `string`
with a `pattern`, because a JSON number is a double), the GraphQL
derivation (`String`, because a `Float` would undo it), the query compiler,
the `params` declarations and the version diffs all agree on that.

**A value the column would have changed is refused rather than rounded**:
more decimal places than the scale, more digits than the precision, a
`bigint` outside the 64-bit range, and a JavaScript number that is not a
safe integer. `0.1 + 0.2` fails validation instead of landing in the
column. henri does not round money.

**The compatibility spellings point at the real types now.** In a drizzle
model `DECIMAL`, `NUMERIC` and `BIGINT` resolve to the exact types instead
of a double and a 32-bit integer; in a sequelize model
`DataTypes.DECIMAL(10, 2)` is read as the henri decimal and gets the same
string boundary. Two things are refused at boot instead of downgraded, both
naming the model and the field (`HENRI_MODEL_TYPE_UNSUPPORTED`): either
type on a sqlite store served by `@usehenri/sequelize`, whose driver reads
both through a JavaScript number; and a bare `DataTypes.DECIMAL`, which
MySQL makes `DECIMAL(10, 0)`.

`henri generate model thing price:decimal` writes `precision: 12, scale: 2`,
because the default is rarely what money wants.
