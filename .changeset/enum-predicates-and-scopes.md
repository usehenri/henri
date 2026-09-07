---
'@usehenri/core': minor
'@usehenri/drizzle': minor
'@usehenri/mongoose': minor
'@usehenri/sequelize': minor
---

Enum predicates, scopes and the list of values.

A column that declares an `enum` already says what it may hold, so henri
spells it back as methods rather than making every application write the
strings out by hand:

```js
// app/models/Post.js
schema: {
  status: { type: 'string', enum: ['draft', 'in_review', 'live'] },
}
```

gives, on every adapter:

- `post.isDraft()` on every record;
- `Post.live()` on the model, answering **a condition** — `{ status: 'live' }`
  — intersected with whatever it is given;
- `Post.enums.status`, the frozen list of values.

The predicate is the one with no substitute: `post.status === 'darft'` is
silently false for the life of the application, while `post.isDarft()` is a
`TypeError` the first time it runs. Writing a wrong value was already
refused on every adapter and every write path by the `enum` rule, so it is
the comparison that needed the method — which is also why **Rails' bang
(`post.archived!`) is not here**: `await post.update({ status: 'archived' })`
is already one call that says what it does, and a method named after a
transition invites a state machine henri would not be honouring.

A scope answers a condition rather than records because henri has three
query builders and wraps none of them: a condition is the value all three
read identically, and the one that composes. It goes **under**
`policy.scope(user)` and the client's filters with an `and` spelled for the
adapter — `Post.paginate({ ...req.pagination(), where: Post.live(where) })`
— so a scope narrows a list and can never widen it.

`in_review`, `in-review`, `IN_REVIEW` and `InReview` all give `inReview`. A
value that is not a name (`2fa`) gets no method and stays in the list. A
generated name that is already a method of the model or of a record is a
**boot failure** naming it (`HENRI_MODEL_ENUM_NAME_TAKEN`) rather than a
silent shadow — `new` gives `isNew`, which is how Mongoose and the drizzle
model tell an insert from an update — and the field is where the way out
is written: `predicates: 'status'` prefixes both halves
(`isStatusNew()`, `Post.statusNew()`) and `predicates: false` generates
nothing and keeps the list. The check covers the names henri puts on a
model on every adapter, so a model that boots on one store boots on the
next.
