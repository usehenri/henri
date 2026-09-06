---
title: GraphQL
description: Install @usehenri/graphql, add types and resolvers to your models and query them from controllers.
sidebar:
  order: 7
---

```bash
npm install @usehenri/graphql        # once, in your application
```

GraphQL lives in [`@usehenri/graphql`](https://www.npmjs.com/package/@usehenri/graphql). The package [ships a henri module](/reference/under-the-hood/#where-it-goes-a-module-that-arrives-from-a-package), so depending on it is all there is to do: it is in the boot as `henri.graphql`, at level 1. An application that does not depend on it has no `henri.graphql` at all and never loads Apollo Server. GraphQL was part of `@usehenri/core` until 1.2 — see [Upgrading](/upgrading/#graphql-moves-to-usehenrigraphql).

Add a `graphql` key to a model and its types and resolvers are loaded, merged with every other model's and served by Apollo Server at `/_henri/gql` (change the path with the `graphql` configuration key). Introspection is on outside production. No model declaring `graphql` means no endpoint at all: this is opt-in twice over, by the dependency and by the models.

Without the package, nothing is silent: a model that declares a `graphql` key fails the boot, and `res.render(view, { graphql })` fails the request. Both say to install `@usehenri/graphql`, and `henri doctor` reports it as a missing dependency. Everything else keeps working, and a page simply has no `graphql` key among its view options.

## Definition

```js
// app/models/Task.js
module.exports = {
  schema: {
    description: { type: 'string', required: true },
    type: { type: 'ObjectId', ref: 'Type', required: true },
    location: { type: 'ObjectId', ref: 'Location', required: true },
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
        _id: ID!
        reference: String!
        description: String!
        location: Location
        type: Type
        notes: String
        oos: Boolean
      }
      type Query {
        tasks: [Task]
        task(_id: ID!): Task
      }
    `,
    resolvers: {
      Query: {
        tasks: async () => Task.find().populate('type location').exec(),
        task: async (_, { _id }) => Task.findById(_id).populate('type'),
      },
    },
  },
};
```

If the merged schema does not compile, the error is printed and the GraphQL service stays off until you fix it. Everything else keeps working. The schema is rebuilt when the models reload.

Resolvers receive `{ req, res }` as their context, both for requests hitting the endpoint and for queries run from a controller, so `req.user` is available to them. `henri.graphql.AuthenticationError`, `ForbiddenError`, `UserInputError`, `ValidationError` and `SyntaxError` are `GraphQLError` subclasses carrying the matching `extensions.code`; `henri.graphql.toApolloError(error, code)` wraps any other error.

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
            _id
            reference
            description
            type {
              _id
              name
            }
            location {
              _id
              name
            }
          }
          locations {
            _id
            name
          }
        }
      `,
    });
  },
};
```

The query result becomes the `data` prop of the page and `errors` holds the GraphQL errors, if any. The page also receives `graphql.endpoint` and `graphql.query`, so the client can rerun the same query later.

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
