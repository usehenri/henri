---
title: GraphQL
description: Add types and resolvers to your models and query them from controllers.
sidebar:
  order: 6
---

Add a `graphql` key to a model and its types and resolvers are loaded, merged with every other model's and served by Apollo Server at `/_henri/gql` (change the path with the `graphql` configuration key). Introspection is on outside production.

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
