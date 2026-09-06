---
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/graphql': minor
---

A model's GraphQL definition is derived from the schema it already declares.

A model that wanted GraphQL wrote its types out by hand, in SDL, immediately below the henri schema that had just said the same thing — the field names again, the types again, and the resolvers to go with them ([#68](https://github.com/usehenri/henri/issues/68), open since 2019). `graphql: true` is now the whole key:

```js
module.exports = {
  graphql: true,
  schema: {
    title: { type: 'string', required: true },
    year: { type: 'integer' },
  },
};
```

which serves `type Artwork { id: ID! title: String! year: Int ... }`, `artwork(id: ID!)` and `artworks(page:, perPage:, where:)` — an `ArtworkPage`, so no derived query is unbounded.

**It is derived at boot, not written into the file, and that is the decision worth stating.** A generator would have handed over an honest copy that stops being true the first time a column, a `personal` mark, an `encrypted` mark or `config.externalIds` changes; the definition depends on all four. henri already refuses that trade for the OpenAPI document, for the HAL `_links` and for what a foreign key publishes as. `henri graphql` prints the derived SDL without booting — paste it into a model's own `types` when you want to own it — and `henri graphql --summary` says what was left out of each model and why.

**`id` is the `externalId`.** The primary key is not a field, it is not an argument, and `artwork(id:)` resolves through `findById()`, which takes the public identifier and nothing else. A declared foreign key is an `ID` carrying the target row's `externalId`, and a mutation writing one takes an `externalId` back and looks the row up: the identifier rule, in both directions.

**What is never derived is read off the model, not off a list of names.** A field marked `personal: { expose: false }` is not a field — which is what leaves the user's `password` out, since `base/privacy.js` marks it that way on every application with a user model. A field marked `personal: true` is a field and never an argument: a value you may read on a record you are allowed to see is not one anybody may search by. A randomised `encrypted` field is never an argument either, because henri refuses that query with `HENRI_ENCRYPTION_NOT_QUERYABLE` and a field the framework will not query has no business being a queryable one. A `json` column has no shape GraphQL could state, so it is left for a scalar of your own.

**Queries by default, mutations on request.** `graphql: { generate: true, mutations: true }` adds `createArtwork`, `updateArtwork` and `deleteArtwork`; nothing writes unless a model asks, because a delete mutation on the endpoint of an application that never wanted one is a hole. The block also takes `name`, `queries`, `filters`, `except`, and the `types` and `resolvers` you write yourself, which are merged on top of the derived ones and win.

**Every derived resolver goes through `app/policies`, and there is no setting that turns that off.** One record asks `show`; a refusal and a row that is not there both answer `null`, the same non-oracle `findById()` follows. A list asks `index` and then asks the policy what the list _is_ — `scope(user)` is the condition it filters by, and a `where` argument narrows that and never widens it. Mutations ask `create`, `update` and `destroy`. Policies fail closed, so a model with `graphql: true` and no `app/policies/<model>.js` serves an empty page and a null record: opting a model into GraphQL is not opting it out of authorization. Everything answered is published and stripped by the same two functions every other answer goes through.

`henri doctor` reports the three things that are otherwise invisible: a `graphql` key that would fail the boot (`graphql.declaration`), a derived model with no policy behind it or a policy with no `scope(user)` behind its list query (`graphql.policy`), and a hand-written definition naming a field marked `personal: { expose: false }` (`graphql.exposed`) — the drift a derived definition cannot have.

A model that writes `graphql: { types, resolvers }` is untouched: nothing is derived unless `generate` asks for it. Four codes are new: `HENRI_API_GRAPHQL_INVALID_DECLARATION`, `HENRI_API_GRAPHQL_SCOPE_REQUIRED`, `HENRI_API_GRAPHQL_DENIED` and `HENRI_API_GRAPHQL_UNKNOWN_REFERENCE`. The [GraphQL guide](https://usehenri.io/guides/graphql/) has the whole table.
