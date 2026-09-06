---
title: GraphQL
description: Install @usehenri/graphql and henri derives a model's types, queries and resolvers from the schema it already declares - or write them yourself.
sidebar:
  order: 8
---

```bash
npm install @usehenri/graphql        # once, in your application
```

GraphQL lives in [`@usehenri/graphql`](https://www.npmjs.com/package/@usehenri/graphql). The package [ships a henri module](/reference/under-the-hood/#where-it-goes-a-module-that-arrives-from-a-package), so depending on it is all there is to do: it is in the boot as `henri.graphql`, at level 1. An application that does not depend on it has no `henri.graphql` at all and never loads Apollo Server. GraphQL was part of `@usehenri/core` until 1.2 — see [Upgrading](/upgrading/#graphql-moves-to-usehenrigraphql).

Add a `graphql` key to a model and its types and resolvers are merged with every other model's and served by Apollo Server at `/_henri/gql` (change the path with the `graphql` configuration key). Introspection is on outside production. No model declaring `graphql` means no endpoint at all: this is opt-in twice over, by the dependency and by the models.

`graphql: true` is the whole key most of the time: henri derives the type, the queries and the resolvers from the schema the model already declares, at boot, and `henri graphql` prints what that is. An object writes them by hand instead, which is what the key always was.

Without the package, nothing is silent: a model that declares a `graphql` key fails the boot, and `res.render(view, { graphql })` fails the request. Both say to install `@usehenri/graphql`, and `henri doctor` reports it as a missing dependency. Everything else keeps working, and a page simply has no `graphql` key among its view options.

## Derived from the model

A model already says what its records are. `graphql: true` is henri deriving the definition from that, at boot:

```js
// app/models/Artwork.js
module.exports = {
  graphql: true,
  options: { timestamps: true },
  schema: {
    title: { type: 'string', required: true },
    year: { type: 'integer' },
    status: { type: 'string', enum: ['draft', 'published'] },
  },
};
```

is the schema below, served, with no SDL written anywhere:

```graphql
enum ArtworkStatus {
  draft
  published
}

type Artwork {
  id: ID!
  createdAt: String!
  status: ArtworkStatus
  title: String!
  updatedAt: String!
  year: Int
}

type ArtworkPage {
  records: [Artwork!]!
  page: Int!
  perPage: Int!
  total: Int!
  pages: Int!
}

input ArtworkFilter {
  status: ArtworkStatus
  title: String
  year: Int
}

type Query {
  artwork(id: ID!): Artwork
  artworks(page: Int, perPage: Int, where: ArtworkFilter): ArtworkPage!
}
```

`henri graphql` prints exactly that, without booting, and `henri graphql --summary` says what henri left out of each model and why. Paste what it prints into the model's own `types` if you would rather own the definition from here on — nothing stops you, and that is the whole difference between this and a generator.

### Why it is not written into the file

A `henri generate graphql` would have written the SDL above into `app/models/Artwork.js` and handed it over. It would have been honest for about a week. The definition depends on things that keep moving — whether the model carries a public identifier, which fields are marked personal, which columns are encrypted, whether a relation is declared — and a copy in a file says what was true the day it was written while the JSON answer next to it says what is true now. henri already refuses that trade for [the OpenAPI document](/guides/openapi/), for the HAL `_links` and for [what a foreign key publishes as](/guides/models/#identifiers): the definition is derived, so the two cannot disagree.

### What each type becomes

| henri schema           | GraphQL                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `string`, `text`       | `String`                                                                                             |
| `integer`              | `Int`                                                                                                |
| `number`, `float`      | `Float`                                                                                              |
| `boolean`              | `Boolean`                                                                                            |
| `date`                 | `String`, ISO 8601 — the same string the JSON answer carries                                         |
| `uuid`                 | `String`                                                                                             |
| `json`                 | nothing: a JSON column holds no shape GraphQL could state, so add the field and a scalar of your own |
| `enum: [...]`          | an `enum <Type><Field>` when every value is a GraphQL name, `String` when one is not (`in-progress`) |
| a declared foreign key | `ID`, holding the `externalId` of the row it names                                                   |

`required: true` makes the field non-null. The timestamps, `deletedAt` on a `paranoid` model and the columns henri adds to the user model are all there, because they are all in the JSON answer.

### `id` is the externalId

The trap in generating any of this is the identifier. `id` is `ID!` and it is the [`externalId`](/guides/models/#identifiers) — the primary key is not a field, it is not an argument, and `artwork(id:)` resolves through `findById()`, which takes the public identifier and nothing else. A primary key gets the same `null` an unknown uuid gets.

A declared foreign key (`belongsTo()`, `references: { model }`, Mongoose's `ref`) is an `ID` holding the target row's `externalId`, and a mutation writing one takes an `externalId` back and looks the row up. An undeclared column holding an id is a string to henri, here as everywhere else.

There is no nested object field: `memo.owner` is not generated. Resolving one is another model's policy question and an N+1 in the same line of code, and henri answers neither on your behalf. Write it yourself — the `types` and `resolvers` you add are merged into what henri derived:

```js
graphql: {
  generate: true,
  types: `extend type Memo { owner: User }`,
  resolvers: { Memo: { owner: (memo) => User.findById(memo.ownerId) } },
},
```

### What is never derived

Nothing here is a list of field names; it is read off the marks the model already carries.

| The mark                       | What it means here                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `personal: { expose: false }`  | Not a field at all. `res.render()`, `res.resource()` and `res.collection()` drop those names from every answer, so a GraphQL field for one would be a hole in the side of the same wall.     |
| `personal: true`               | A field, never an argument. A value you may read on a record you are allowed to see is not one anybody may search by.                                                                        |
| `encrypted: true` (randomised) | Never an argument: henri refuses that query with `HENRI_ENCRYPTION_NOT_QUERYABLE`, and a field the framework will not query has no business being a queryable one. Deterministic may be one. |
| `graphql: { except: [...] }`   | Whatever else you want left out.                                                                                                                                                             |

The user's `password` needs no special case: [`base/privacy.js`](/guides/privacy/) marks it `expose: false` on every application that has a user model, so the same rule leaves it out. So does `roles`, from a mutation input — it is changed with `setRoles()` and never by mass assignment.

### Queries by default, mutations on request

`graphql: true` derives the type and two queries. It derives no mutation, because `deleteArtwork` on the endpoint of an application that never asked for one is a hole. Ask, and say which:

```js
graphql: { generate: true, mutations: true },              // all three
graphql: { generate: true, mutations: ['create', 'update'] },
```

which adds `createArtwork(input:)`, `updateArtwork(id:, input:)` and `deleteArtwork(id:)`. The input is the model's writable columns, all optional, references included; the columns henri writes itself are not in it.

The whole block, with everything it takes:

```js
graphql: {
  generate: true,        // derive the definition from the schema
  name: 'Artwork',       // the type name; defaults to the model's
  queries: true,         // artwork(id:) and artworks(page:, perPage:, where:)
  filters: true,         // the `where` argument of the list query
  mutations: false,      // true, or any of 'create', 'update', 'destroy'
  except: ['internal'],  // fields to leave out whatever the schema says
  types: `...`,          // your own SDL, merged in
  resolvers: { ... },    // your own resolvers; they win over the derived ones
},
```

### It goes through the policies, always

Every derived resolver asks [a policy](/guides/policies/), and there is no setting that turns that off:

- `artwork(id:)` loads the record and asks `show`. A refusal and a row that is not there both answer `null`: an error saying "you may not read this one" is a lookup oracle.
- `artworks` asks `index` without a record, and then asks the policy what the list _is_ — `scope(user)` is the condition it filters by. A `where` argument narrows that condition and can never widen it.
- `createArtwork` asks `create`, `updateArtwork` and `deleteArtwork` load the record and ask `update` and `destroy`.

Policies fail closed, so **a model with `graphql: true` and no `app/policies/<model>.js` serves an empty page and a null record.** That is the intended reading: opting a model into GraphQL is not opting it out of authorization. A policy with no `scope(user)` raises `HENRI_API_GRAPHQL_SCOPE_REQUIRED` on a list query rather than quietly meaning "every row" — `scope: () => ({})` is how a policy says everything. `henri doctor` reports both before a query ever arrives.

Everything a resolver answers goes through the two functions every other answer goes through: `henri.model.publish()` (the foreign keys become the `externalId` of the row they name, the internal ids go) and `henri.privacy.strip()` (the fields marked `expose: false` go, at every depth).

## Writing your own

A model that would rather say it itself writes `types` and `resolvers`, which is what the `graphql` key always was and still is. Nothing is derived unless `generate` asks for it, so this block is untouched:

```js
// app/models/Task.js
module.exports = {
  schema: {
    description: { type: 'string', required: true },
    type: { ref: 'Type', required: true, type: 'string' },
    location: { ref: 'Location', required: true, type: 'string' },
    reference: { type: 'string', required: true },
    notes: { type: 'string' },
    oos: { type: 'boolean', default: false },
  },
  options: {
    timestamps: true,
  },
  graphql: {
    types: `
      type Task {
        id: ID!
        reference: String!
        description: String!
        location: Location
        type: Type
        notes: String
        oos: Boolean
      }
      type Query {
        tasks: [Task]
        task(id: ID!): Task
      }
    `,
    resolvers: {
      Query: {
        tasks: async () => Task.find().populate('type location').exec(),
        task: async (_, { id }) => Task.findById(id).populate('type'),
      },
    },
  },
};
```

Two things are yours to get right here that a derived definition gets right on its own, and `henri doctor` reports one of them (`graphql.exposed`):

- **the identifier**. `id: ID!` above is the `externalId`, which is what `findById()` takes and what every other answer henri builds carries. A type publishing `_id` hands out the primary key one query away from everything the [public identifier](/guides/models/#identifiers) exists to stop.
- **the fields that never leave the server**. A resolver of your own is the one way past `personal: { expose: false }`; henri strips what it serializes and cannot strip what you wrote.

If the merged schema does not compile, the error is printed and the GraphQL service stays off until you fix it. Everything else keeps working. The schema is rebuilt when the models reload.

## Query

The schema is queryable anywhere with `henri.graphql.run(query, variables, contextValue)`, which resolves with `{ data, errors }` (or the string `No graphql schema found.` when no model defines one), and directly as an argument to `res.render()`:

```js
// app/controllers/tasks.js

// henri.gql does nothing but help editors highlight and format queries
const { gql } = henri;

module.exports = {
  index: async (req, res) => {
    return res.render('/tasks', {
      graphql: gql`
        {
          tasks {
            id
            reference
            description
            type {
              id
              name
            }
            location {
              id
              name
            }
          }
          locations {
            id
            name
          }
        }
      `,
    });
  },
};
```

The query result becomes the `data` prop of the page and `errors` holds the GraphQL errors, if any. The page also receives `graphql.endpoint` and `graphql.query`, so the client can rerun the same query later.

Queries run this way carry `{ req, res }` as their context like any other, so a derived resolver asks the same policies with the same user. They pass no endpoint guard: they are your code, not a request.

## Bounding the endpoint

A rate limit caps how many requests arrive. It says nothing about what one request costs, and one GraphQL request can cost arbitrarily much: a hundred aliases of the same expensive field, a fragment spread a thousand times, or a walk down a cycle your schema happens to contain. Four bounds are enforced before a single resolver runs, and a query past any of them is refused as a validation error.

| Key             | Default | Refuses                                                                                               |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `maxAliases`    | `15`    | Alias amplification. This is the universal one: it needs no cycle and no deep schema.                 |
| `maxComplexity` | `1000`  | Queries selecting more fields than this in total, fragments expanded — what a fragment bomb inflates. |
| `maxDepth`      | `10`    | Nesting. Only reachable when your own schema offers somewhere deep to go.                             |
| `maxTokens`     | `5000`  | Documents this large, before they are parsed.                                                         |

Set any of them to `false` to lift it. The endpoint also has Apollo's own CSRF prevention on, so a `POST` must be `application/json` or carry `apollo-require-preflight`: a plain form on another site cannot reach it.

graphql 16 cannot cancel an execution that has started, so henri does the next best thing: every field checks first, and a query whose client disconnected or whose request already timed out (`config.requestTimeout`) stops at the next field instead of running to completion for nobody.

## Guarding the endpoint

The endpoint is open to anyone who can reach it unless you say otherwise. Your resolvers receive `{ req, res }` and can check `req.user` themselves, which is the right place for per-field rules; `config.graphql` guards the whole endpoint:

```json
{
  "graphql": {
    "endpoint": "/_henri/gql",
    "authenticated": true,
    "roles": ["admin"],
    "loopbackOnly": false,
    "introspection": false,
    "maxDepth": 10,
    "maxAliases": 15,
    "maxComplexity": 1000,
    "maxTokens": 5000
  }
}
```

- `authenticated`: anonymous requests get `401`.
- `roles`: a signed-in user missing any of them gets `403`. Asking for a role implies `authenticated`.
- `loopbackOnly`: anything but the loopback interface gets `404`, the way `/_routes` and `/_mailers` behave. Useful when the endpoint is a development tool rather than an API.
- `introspection`: on outside production by default.

`"graphql": "/path"` still means what it always did: the endpoint path, with every default above.

Queries run from a controller with `res.render({ graphql })` or `henri.graphql.run()` go through the same limits, and past no guard — they are your code, not a request.
