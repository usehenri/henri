---
'@usehenri/cli': minor
'@usehenri/core': minor
'@usehenri/drizzle': minor
'@usehenri/mongoose': minor
'@usehenri/sequelize': minor
---

Slugs: `/articles/how-we-ship` rather than the uuid.

A model asks for a name in its options and henri does the rest — a unique, indexed, `NOT NULL` `slug` column, filled on the insert, resolved by `findById()` and printed in every url that names the record:

```js
// app/models/Article.js
module.exports = {
  options: { slug: 'title', timestamps: true },
  schema: {
    body: { type: 'text' },
    title: { type: 'string', required: true },
  },
};
```

`henri generate scaffold Article title:string! --slug title` writes the declaration, the controller and the pages together, and a generator run over a model that already has one reads it back, so nothing needs hand-wiring.

**A slug is a third identifier, and it stays in its lane.** It appears in the record's own `slug` field and in the **url** of that record — `_links`, the path helpers, the `Location` of a `201` — and nowhere else. A foreign key is still published as the `externalId` of the row it names, and the versions table, the access trail, the flags actor and the erasure receipts all keep reading `externalId`. The uuid is what an API client stores; the slug is what a person reads.

**A lookup cannot be talked into a primary key.** `findById()` resolves a uuid against `externalId` as before, and anything else against the **slug column** — a `WHERE slug = ?`, not a fallthrough — and that is the end of it. `findById('42')` asks the slug column for `'42'`; it cannot say whether row 42 exists, and the `null` it answers is the same `null` an unknown name gets. A model with a slug takes the whole non-uuid space with it, `externalIds.lookup: "any"` included, so the primary key is `findByKey()`'s alone. A slug shaped like a uuid is refused, so the two identifier spaces never overlap. `findBySlug()` is the explicit half.

**Two articles called "Getting started" is the normal case**, and henri answers it without a `SELECT` before the `INSERT` — the same position it takes on `unique` in validations. By default the slug carries a six character discriminator taken from the record's own `externalId` (`getting-started-k3f9pq`): unique because the uuid is, stable because the uuid never changes, and free because nothing is read. The cost is those six characters in every url. `slug: { from: 'title', suffix: false }` gives the bare `getting-started` instead, and then the **unique index is what holds**: the second one is refused by the database as `{ slug: 'must be unique' }`.

**A slug does not move.** `on: 'create'` is the default, so the url minted the day the record was written keeps working whatever the title becomes. `on: 'change'` follows the source, and the old url **stops working that instant** — henri keeps no history of slugs and answers no `301`. On such a model a mass update naming the source field is refused (`HENRI_MODEL_SLUG_MASS_WRITE`) with the loop to write instead, because one hook runs for the whole write and every row would get the same name.

**Unicode without a transliteration table.** The title is lowercased, decomposed (NFKD) and reduced to `a-z0-9`, so `Café Crème` is `cafe-creme` — that is `String#normalize`, not a table. Eleven Latin letters Unicode does not decompose get a line each (`æ ð đ ħ ı ł ø œ ß þ ŧ`), so `Straße` is `strasse` and `Łódź` is `lodz`, and that is the whole of it: a Japanese, Chinese, Arabic, Hebrew, Greek or Cyrillic title folds to nothing, deliberately. With the discriminator on, such a record still gets a working url; with `suffix: false` the write is refused (`HENRI_MODEL_SLUG_EMPTY`) rather than writing an empty name. And **a slug the application writes itself always wins and may be in any script** — `slug: 'こんにちは'` is stored, matched and carried percent-encoded — so the choice between folding and percent-encoding is the application's, not henri's.

A supplied slug is measured against the characters that would stop it being one path segment (a space, a control character, and the seventeen that end a segment, start a query, escape an encoding or name a directory), plus `.`, `..` and the paths henri already mounts (`new`; `reserved` adds your own). Nothing in the slugifier is a regular expression: it walks the code points once, with the length bound applied as it goes, because a title arrives through `req.permit()`.

A declaration henri cannot carry out fails the boot naming the model (`HENRI_MODEL_SLUG_DECLARATION_INVALID`). `henri openapi` describes the path parameter as the slug and drops the `uuid` format for that model, and `henri generate agents` lists the mark.
