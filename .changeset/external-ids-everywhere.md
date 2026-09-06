---
'@usehenri/cli': minor
'@usehenri/core': minor
'@usehenri/drizzle': minor
'@usehenri/mongoose': minor
'@usehenri/sequelize': minor
---

The public identifier goes all the way: a foreign key travels as one, and a
primary key stops resolving

1.2 gave every record an `externalId` and took its own primary key out of
what leaves the server. Two holes were left, and both are closed here.

**A foreign key is the `externalId` of the row it names.** A proposal that
belongs to a speaker answered `speakerId: 4812` -- another row's sequential
id -- so enumeration survived one relation away. `res.render()`,
`res.resource()` and `res.collection()` now replace every _declared_ foreign
key on the way out, and a key that names no row is `null`, never the number.
henri reads what the model said (`belongsTo()`, `references: { model }`,
Mongoose's `ref`) and never a field name; a Mongoose `refPath`, a `ref` given
as a function and a column that points at a row without saying so are left
alone, and the guide says so. The cost is bounded: one call covers a whole
answer, an eager-loaded association is used when its primary key matches the
key it is standing in for, and the rest is one statement per target model
rather than one per record.

**`Model.findById()` takes the public identifier and nothing else.**
`GET /tasks/4812` used to answer next to the uuid, so guessing a number still
worked and the uuid bought nothing. A primary key now gets the same `null` an
unknown uuid gets -- the controller answers its own 404, and nothing in the
answer says which of the two it was. `findByIdAndUpdate()` and
`findByIdAndDelete()` refuse the same values.

**`findByKey()` is the new lookup for a primary key**, on all three adapters,
for the server-side code that legitimately holds one; `findByExternalId()` is
the explicit other half. `findByPk()` is an alias of `findByKey()` on the
Sequelize adapters and on Drizzle, and no longer accepts a uuid. It fails
closed: a value the key column cannot hold answers `null` instead of a
database error. henri's own session and token lookups take either identifier,
so signing in and staying signed in are unaffected.

**`henri.model.publish()`** is the same gate, exposed: a controller that
presents its records hands `res.resource()` a plain object, and a plain
object carries no model, so publish first and present second.

`config.externalIds` (`lookup`, `references`) restores either behaviour for
an application that cannot move yet, and `henri audit` reports both
(`externalIds.lookup-any`, `externalIds.references-disabled`, ASVS V4.2.1).
A model with `options: { externalId: false }` is unaffected by any of it, and
so is a foreign key pointing at one.

Upgrading: change `Model.findById(record.id)` to `Model.findByKey(record.id)`
wherever the value came from the database. `Model.findById(req.params.id)`
needs no change -- that is the case this is for.
