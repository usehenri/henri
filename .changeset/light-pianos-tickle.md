---
'@usehenri/core': minor
---

`henri types` describes a model by the adapter of its store, and closes the one it can

`.henri/types.d.ts` used to give every model the same open `ModelStatics`: six
guarantees and an index signature for everything else, so `Article.fnid()`
compiled and answered `undefined`. The three model APIs were measured and the
declaration was split.

`ModelGuarantees` is what all three actually share -- `findById`, `findByKey`,
`findByExternalId`, `findOne`, `create`, `paginate`. `find()` is no longer one
of them: a Sequelize model has none (it went in Sequelize 4), so `Model.find()`
on an `mssql` store is a `TypeError` and is now a compile error too.

On top of it, three interfaces picked from the store: `MongooseModelStatics`
and `SequelizeModelStatics` keep the index signature, because the rest of that
surface belongs to an ORM at whatever version the application installed.
`DrizzleModelStatics` is **closed** -- that model class is henri's own, it is
released with core, and its statics are the same whatever a model declares. On
a drizzle, postgresql, mysql or mariadb store this now fails to compile:

- `Task.fnid()` -- a static that does not exist
- `Task.published()` -- a scope for an enum value that does not exist
- `Task.find().sort()` -- a drizzle `find()` is a promise; `where()` is the
  chain, and it is typed as `DrizzleRelation`
- `Task.aggregate([])` and `Task.findAndCountAll()` -- the other ORMs' calls

The cost, in the guide: `Task[someName]` is an error there too, and henri's own
bookkeeping statics are declared (marked `@internal`) rather than left out.
The file format is `2`, so `henri doctor` reports a file written by an older
henri as `types.foreign` until the next boot rewrites it.
