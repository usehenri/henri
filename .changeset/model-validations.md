---
'@usehenri/core': minor
'@usehenri/drizzle': minor
'@usehenri/mongoose': minor
'@usehenri/sequelize': minor
---

Model validations that mean the same thing on all three adapters.

A model says what must be true of its records in a `validates` block, keyed by field, in the vocabulary a controller's `params` block already uses:

```js
// app/models/Post.js
module.exports = {
  schema: {
    title: { type: 'string', required: true },
    slug: { type: 'string', unique: true },
    status: { type: 'string', enum: ['draft', 'live'], default: 'draft' },
    body: { type: 'text' },
  },

  validates: {
    title: { minLength: 3, maxLength: 120 },
    slug: { pattern: /^[a-z0-9-]+$/ },
    status: {
      validate: (value, post) =>
        value !== 'live' || Boolean(post.body) || 'needs a body first',
    },
  },
};
```

`required`, `enum`, `min`, `max`, `minLength`, `maxLength`, `pattern` and `validate` — no `type`, because the schema next door already says it, and that is what decides which constraints apply. A rule henri cannot carry out fails the boot naming the model and the field (`HENRI_MODEL_VALIDATION_INVALID`) rather than being ignored.

It runs where the writes are, not where each ORM happens to look. **The schema's own `required` and `enum` are the same rules**, so this changes what an application that declares no `validates` at all already does:

- **Mongoose** ran its validators on `save()`, `create()` and `insertMany()` and on nothing else. `updateOne`, `updateMany` and `findOneAndUpdate` wrote a `null` over a required field and a value outside an `enum` straight into the document. They are checked now.
- **Sequelize** skipped `bulkCreate` (its `validate` defaults to `false`), so a value outside an `enum` was written. It is checked now, and Sequelize's own validation is turned on for that call too.
- **Sequelize on PostgreSQL and MySQL** has a native `ENUM` column and had no JavaScript check at all, so the _server_ refused the value with a `SequelizeDatabaseError` — which `henri.model.errors()` answers `null` for, so an application answered **500** where the same model file answered 422 on sqlite. henri refuses first now, and the answer is the same 422 on every dialect.
- The message is henri's on all three: `must be one of draft, live`, `is required`, `must be at most 120 characters`. A `required` field holding nothing but spaces is missing, which is what Mongoose and Drizzle already said and Sequelize did not.

The failure is the shape applications already read: `henri.model.errors(error)` answers `{ field: message }`, and nothing about the 422 changes.

Two things are refused rather than quietly skipped. A `validate` that declares a second parameter is asking for the record, the way a policy rule does — a mass write has none, so a mass write naming that field is refused with the loop to write instead (`HENRI_MODEL_VALIDATION_MASS_WRITE`). And a write no hook of the ORM reaches — Mongoose's `bulkWrite`, Sequelize's `increment`/`decrement`, an update operator like `$inc` — is refused on a validated field (`HENRI_MODEL_VALIDATION_UNCHECKED_WRITE`) instead of letting the declaration stop being true. `unique` stays what it is: an index the database enforces, because a check before an insert is a race, and `henri.model.errors()` already turns the duplicate into `{ field: 'must be unique' }`.

A `validate` function in the schema of a Sequelize store now fails the boot pointing at `validates`: Sequelize reads its own `validate` as an object of named validators, so a function there did nothing, while the same line on the other two adapters ran.
