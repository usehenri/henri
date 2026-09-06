# @usehenri/graphql

## 1.2.0

### Minor Changes

- [#404](https://github.com/usehenri/henri/pull/404) [`ab5a8e4`](https://github.com/usehenri/henri/commit/ab5a8e4a88c80cca070a2b8ad398c80babdaff11) Thanks [@reel](https://github.com/reel)! - A model's GraphQL definition is derived from the schema it already declares.
  
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

- [#351](https://github.com/usehenri/henri/pull/351) [`fda9366`](https://github.com/usehenri/henri/commit/fda9366e9ed2b072764a995c5aa60205ca7a4725) Thanks [@reel](https://github.com/reel)! - GraphQL moves out of core into `@usehenri/graphql`
  
  The GraphQL layer is now a package of its own. `@usehenri/core` no longer
  depends on `@apollo/server`, `@as-integrations/express5`,
  `@graphql-tools/merge`, `@graphql-tools/schema` or `graphql`, so an
  application that never mounts a schema stops installing them.
  
  An application that uses GraphQL adds one dependency,
  `npm install @usehenri/graphql`, and nothing else changes: the package ships
  the henri module itself, so depending on it is what puts `henri.graphql` in
  the boot, with the same `run()`, `endpoint`, `active`, error classes and
  `toApolloError()`. The endpoint is still `/_henri/gql` (still configurable
  with the `graphql` key) and the schema is still built from the models'
  `graphql` keys.
  
  `@usehenri/core/module` is the base class a module package extends, and this
  is the first package to use it: it is the supported path, so a module of your
  own no longer reaches into `@usehenri/core/src/base/module`.
  
  Without the package henri says so instead of going quiet: a model declaring a
  `graphql` key fails the boot with the install line, `res.render(view, { graphql })`
  fails the request with it, and `henri doctor` reports it as a missing
  dependency. `henri.graphql` is `undefined` rather than an object that does
  nothing, which the type declarations say too, and a page has no `graphql` key
  among its view options.

### Patch Changes

- Updated dependencies [[`1e23664`](https://github.com/usehenri/henri/commit/1e23664829bd1a356de28f404cfb21c9ae211388), [`5b627ad`](https://github.com/usehenri/henri/commit/5b627adfa37e9f16bc75af96cc8ff5308a91f688), [`1b316c6`](https://github.com/usehenri/henri/commit/1b316c6f3c5d5eb5752c70b534092d1052956cc6), [`7fd13f6`](https://github.com/usehenri/henri/commit/7fd13f631b75f7aa152b73046b50c6902ae3ca93), [`b559fb7`](https://github.com/usehenri/henri/commit/b559fb72b391eeb21a3f6a0cda1515e01ecbfafc), [`1c0dfe8`](https://github.com/usehenri/henri/commit/1c0dfe84a98eff2122512256c4f42ec7ccde4212), [`93060a8`](https://github.com/usehenri/henri/commit/93060a86df795dbbd99bf1895beb0cf14c4b86de), [`e031900`](https://github.com/usehenri/henri/commit/e031900082f28aec72af4cda9cd959f932e2ebc7), [`9173000`](https://github.com/usehenri/henri/commit/91730005efa88f073bfaaf67078c3ec0e137b459), [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea), [`b278119`](https://github.com/usehenri/henri/commit/b2781190de436eb5838e866446c9a0c8210bb6ca), [`b161e1b`](https://github.com/usehenri/henri/commit/b161e1b8fad94af2d2afc351dc1bc07dabbb1379), [`1616e34`](https://github.com/usehenri/henri/commit/1616e343a612be2bffffcfa5b23bfa8ad191bbe3), [`bcf4ce2`](https://github.com/usehenri/henri/commit/bcf4ce22bcd294844504164fac1fa4aef1ffec41), [`ab5a8e4`](https://github.com/usehenri/henri/commit/ab5a8e4a88c80cca070a2b8ad398c80babdaff11), [`43d267f`](https://github.com/usehenri/henri/commit/43d267f0f9d192b2c01e89c3925b7daf5000041b), [`9f868f3`](https://github.com/usehenri/henri/commit/9f868f3d9162fa218e34304110210e6949f97d5c), [`89dda62`](https://github.com/usehenri/henri/commit/89dda62da456a0a55600e79cfb65ce89f11258e2), [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea), [`d9f3be4`](https://github.com/usehenri/henri/commit/d9f3be49c5929d929a220220bf6e72fdcb135595), [`c44f025`](https://github.com/usehenri/henri/commit/c44f025acec3d5bbbb57e2310d02184a1053a10d), [`67cfb20`](https://github.com/usehenri/henri/commit/67cfb200ea0e0b31bacf2af183db6467b0fa011d), [`e661f98`](https://github.com/usehenri/henri/commit/e661f98fe8f8acce15aa10ce2dc320c5a2cb006f), [`2c8a826`](https://github.com/usehenri/henri/commit/2c8a8265262dbf6ea5c3e73e8e7892a230d4d0f0), [`46d5dbc`](https://github.com/usehenri/henri/commit/46d5dbcc983c03e96ae5a87d7288c5d8a5adbc24), [`ba97ea9`](https://github.com/usehenri/henri/commit/ba97ea968f0b34cd67b7a3e803ecd34543b8aaaf), [`5ccd537`](https://github.com/usehenri/henri/commit/5ccd537b3621b54d11e7f24ccca39643ae7d5cf7), [`9895cbf`](https://github.com/usehenri/henri/commit/9895cbf4be85b476e341a5be915e3049e5a027de), [`5a150d5`](https://github.com/usehenri/henri/commit/5a150d576208571c32b9cd12827d035e31ed4313), [`3c1c5b8`](https://github.com/usehenri/henri/commit/3c1c5b83ea135b000ddd6ffbfd05457b000f2f7c), [`aa3f90b`](https://github.com/usehenri/henri/commit/aa3f90bd6f42bb05431c33f3e4bf2202cb6bb7c6), [`a1c6769`](https://github.com/usehenri/henri/commit/a1c6769099e3dc28b22b5338a2a57b13bdf69f7a), [`ec1c8c4`](https://github.com/usehenri/henri/commit/ec1c8c419f4d9063a7617472b2970fdb8a929fa1), [`dd2731d`](https://github.com/usehenri/henri/commit/dd2731d6a20fd96aa1be1aeb5e6ec0155001326b), [`b7038ce`](https://github.com/usehenri/henri/commit/b7038ceaa430f4a0b9eaf7e983fc2844421bf636), [`1ea0f85`](https://github.com/usehenri/henri/commit/1ea0f85066b86fba31f58937cc10abb6359e6a26), [`01a561a`](https://github.com/usehenri/henri/commit/01a561aa58650ec15df1c2659795a5e4c5bbfd53), [`e31a3f7`](https://github.com/usehenri/henri/commit/e31a3f73e7e8facf3cedf7460f115e57995f32c3), [`2689779`](https://github.com/usehenri/henri/commit/26897798b840fd28a4bc091c050a83457b36905d), [`72cd1d3`](https://github.com/usehenri/henri/commit/72cd1d35ffb99311bbca815c1f6ab41ee3682f64), [`a2e1ec2`](https://github.com/usehenri/henri/commit/a2e1ec29df52462f12ebaae9bfbc1ad4f427b27f), [`afead74`](https://github.com/usehenri/henri/commit/afead7489498ed42e1893a25123ea772cac2ca09), [`a4ecba5`](https://github.com/usehenri/henri/commit/a4ecba50c663f4d5c741adbb6cd9bc0eefe0e5cc), [`baec3fd`](https://github.com/usehenri/henri/commit/baec3fd22be92bf8ffbaeb251b0b6c2771f8347a), [`e865d94`](https://github.com/usehenri/henri/commit/e865d945d65419ac676f5a2fe3ba3b6114a1e53d), [`4274567`](https://github.com/usehenri/henri/commit/4274567e20a980657f07df9ec7db25296c7d55f5), [`aea429c`](https://github.com/usehenri/henri/commit/aea429ca99338a62370ab3e3d94bdc6b8c227601), [`8a8e3b3`](https://github.com/usehenri/henri/commit/8a8e3b33d7967b81f66633aa25c3075318f01d60), [`18715f9`](https://github.com/usehenri/henri/commit/18715f90ea8958dc57da1bb029b8209c36b84cc6), [`831aa5c`](https://github.com/usehenri/henri/commit/831aa5c011f3432630c68b8d26755d2582f82f74), [`16824e8`](https://github.com/usehenri/henri/commit/16824e8fe9ccc6a04dab5d9b2481c29ff4f6b64b), [`fda9366`](https://github.com/usehenri/henri/commit/fda9366e9ed2b072764a995c5aa60205ca7a4725), [`1a86acb`](https://github.com/usehenri/henri/commit/1a86acbf15e4a43e5fb81277bb22e101c06e77a4), [`0b32fbd`](https://github.com/usehenri/henri/commit/0b32fbde19c95da8fe07fab76933840a4242c71c), [`c0c16e8`](https://github.com/usehenri/henri/commit/c0c16e873ba440aee9832160553cbb12ab81bd2c), [`41470bf`](https://github.com/usehenri/henri/commit/41470bf378d83ca3d35d00e8c31796fea5eb15e0), [`8e44e7e`](https://github.com/usehenri/henri/commit/8e44e7e882dd8741b3ac632651b453389d76bf2c), [`de1c1e0`](https://github.com/usehenri/henri/commit/de1c1e02ed83d13dcfeb8e44012f309eb663f03e), [`4b4677d`](https://github.com/usehenri/henri/commit/4b4677d4a09d39fe50b1fa4af577600342578daf)]:
  - @usehenri/core@1.2.0
