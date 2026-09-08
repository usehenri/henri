---
'@usehenri/cli': minor
'@usehenri/core': minor
'@usehenri/drizzle': minor
'@usehenri/mongoose': minor
'@usehenri/sequelize': minor
---

A write the store refused puts back every attribute it set.

`record.update(attrs)` sets the attributes and saves them, and only the second half can fail. Until now the set had already happened, so the value the store refused stayed on the record in hand:

```js
try {
  await post.update(req.permit('title', 'views'));
} catch (error) {
  // post.views was the value the database or the validator just refused
  return res.boom.badData(error.message, { errors: henri.model.errors(error) });
}
```

Anything that then rendered, logged or wrote from `post` was working from a value no store ever accepted. The measurement on the three adapters is what settled the fix: the next `update()` on that record was measured against the stale value on Drizzle and Mongoose, so a second write naming a different field entirely was refused for a field it never named — while on Sequelize the same second write **succeeded**, because Sequelize narrows the statement to the fields the call names, so the row kept the old value and the record went on saying the refused one with nothing to say otherwise.

So the rule, and it is the same sentence on `drizzle`, `postgresql`, `mysql`, `mongoose`, `disk` and `mssql`: **a write the store refused leaves the record holding the values it had.** A rule of `validates`, the schema's own `required` or `enum`, and the unique index all put the attributes back — the database's refusal too, because a single-row `INSERT` or `UPDATE` is refused whole and there is no half-written row for the record to disagree with.

What it is not:

- **Not a reload.** Nothing is read back and a refusal costs no query.
- **Not everything that can go wrong.** A refusal is what `henri.model.errors()` calls one. A hook of yours that throws is not, and that matters for an `afterUpdate` hook in particular: by then the row has moved, and the record keeps the values it now holds.
- **Not `set()` + `save()`.** Those stay two steps and keep what was set, which is how a form keeps what a person typed.

On a `mongoose` or `disk` store `record.update()` is new: Mongoose removed `Document.prototype.update` in version 7, so henri adds it back with the meaning it has on the other two adapters — the models guide already told applications to write `article.update({ ... })`, and now that call exists everywhere. `henri generate scaffold|crud` writes it into the Mongoose controller in place of `set()` then `save()`.
