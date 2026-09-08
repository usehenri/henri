---
'@usehenri/cli': minor
---

`henri generate scaffold|crud` declares what its writes accept.

A generated controller permitted its fields by name and said nothing about what they held, so the only `422` it could ever give was the model's refusal, and everything between `req.permit()` and that refusal was working from whatever text arrived:

```js
// before: `done` was the string "false" here, which is a truthy string
create: async (req, res) => {
  const task = await Task.create(req.permit(...FIELDS));
```

`create` and `update` now get a [`params`](https://usehenri.io/guides/controllers/#params-what-an-action-accepts) block written from the model file — one selector, the fields `FIELDS` permits, typed:

```js
params: {
  'create,update': {
    name: 'string',
    category: { enum: ['urgent', 'high', 'medium', 'low'], type: 'string' },
    done: 'boolean',
  },
},
```

A request that does not match is a `422` naming the field, behind the role and the policy guards and ahead of the `before` hooks, so nothing is looked up first. What is accepted is written back where it came from, which is the half that changes the file: a form, a query string and a path parameter can only send text, so the action is handed `true` and not `"true"` — and `false` and not `"false"`, which every adapter stores as `false` and JavaScript reads as truthy. A JSON body is checked and never parsed, so a client that sends `"true"` there is refused rather than guessed at. `henri openapi` reads the block too: `POST /tasks` is described by what the action accepts rather than by the model's writable columns.

What is deliberately **not** in it, argued in the generated file itself:

- **`required`.** A parameter is required when the key arrived; a model asks Rails' presence. The empty string a form posts for an untouched input passes the first and is refused by the second, so copying the word would write a rule that reads like the model's and is not one.
- **A length, a range, anything else about the record.** That is the model's, said once for a form, a job, a seed and a console alike. A `maxLength` so a megabyte of text is refused before anything stores it is exactly the edit the block is written to invite.
- **A column that names another model** (`references: { model }`, Mongoose's `ref`). henri publishes a foreign key as the target's `externalId`, so only the application knows whether a request carries that or the column's own value — the reason `henri openapi` leaves one untyped in a request body too. The comment names the column rather than dropping it in silence.

The `enum` **is** copied, and the file says so: a page is handed `Model.enums` by its controller, but this block is compiled at runlevel 2 and the models are built at 3, so a literal is the only thing that can be written there. A resource with nothing to type gets no block at all.
