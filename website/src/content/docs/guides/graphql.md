---
title: GraphQL
description: Add types and resolvers to your models and query them from controllers.
sidebar:
  order: 2
---

Add a `graphql` key to a model and its types and resolvers are loaded, merged with every other model's and served by Apollo Server at `/_henri/gql` (change the path with the `graphql` configuration key).

## Definition

```js
// app/models/Task.js

const types = require('@usehenri/mongoose/types');

module.exports = {
  schema: {
    description: { type: types.STRING, required: true },
    type: { type: types.ObjectId, ref: 'Type', required: true },
    location: { type: types.ObjectId, ref: 'Location', required: true },
    reference: { type: types.STRING, required: true },
    notes: { type: types.STRING },
    oos: { type: types.BOOLEAN, default: false },
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
        notes: String!
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

If the merged schema does not compile, the error is printed and the GraphQL service stays off until you fix it. Everything else keeps working.

## Query

The schema is queryable anywhere with `henri.graphql.run(query)`, and directly as an argument to `res.render()`:

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

The query result becomes the `data` prop of the page, and `errors` is set if the query failed. The page also receives `graphql.endpoint` and `graphql.query`, so the client can rerun the same query later.
