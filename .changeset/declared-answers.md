---
'@usehenri/core': minor
'@usehenri/cli': minor
---

A declared shape for what leaves, the way `params` declares what arrives.

`res.render()`, `res.resource()` and `res.collection()` have always gone through one gate on the way out: a foreign key leaves as the `externalId` of the row it names, and a field a model marked `personal: { expose: false }` is dropped. `res.json()` went through nothing, and that was not a corner: an Inertia page whose props are assembled in the controller, a JSON route answering a total next to a list, any object built by hand — none of them is a record, so nothing published its foreign keys and nothing stripped what the model said must never leave.

```js
// what the models said never leaves, leaving
res.json({ rows: [{ email: user.email, gender: user.gender }] });
```

**The floor.** Every JSON answer of every controller action now goes through the same publish and the same strip, in the same order, whether or not the action declared anything. There is no setting that turns it off: the mark is the model's word about a person, and a controller is not where it is overruled. henri's own answers — the HAL envelope, the page options, `res.boom.*`, the 404 and 500 pages, an Inertia page object — are left exactly as they were, because they went through the gate already or are an envelope of their own.

**The declaration.** Opt-in per action, in the block `before` and `params` already established, with the same selectors and the same vocabulary:

```js
module.exports = {
  answers: {
    all: { total: 'integer' },
    index: {
      rows: { model: 'Memo', type: 'array' },
      who: { from: 'User.email', type: 'string' },
    },
  },
};
```

`model` names the model whose records a field holds, and it is the only way an object that never was a record can have its foreign keys published — henri reads no field name, so a hand-built `{ ownerId }` was an opaque string until the controller said what it was. `from` is `'User.email'`, the column a value came from: the field then obeys that column's marks under whatever name the answer gives it, which is the one leak a strip matching by name cannot see, and a `from` pointing at a column marked `expose: false` fails the boot unless the rule says `expose: true` — the declared form of the `include` that `res.resource()` takes.

**What is not declared does not leave.** That is `req.permit()`'s rule pointed the other way: the declaration is the list, an undeclared key is dropped and never refused. It costs an existing application nothing, because an action that declares nothing keeps every byte it sends. The other half goes the other way: a field that was declared and is missing, or holds another type, is a mistake in the declaration rather than something leaking, so it is reported once per route and only refused with `config.api.strict` — the setting that already meant that for the HAL links — as a 500 carrying `HENRI_ANSWERS_MISMATCH`. A rule henri cannot carry out fails the boot with `HENRI_ANSWERS_DECLARATION_INVALID`, naming the controller, the action and the field.

`res.json()` stays synchronous whenever it can, which is nearly always: the walk is free, and only a foreign key nobody eager loaded costs a lookup.

`henri openapi` reads it. An operation whose body a controller writes carried the statuses henri produces, `x-henri.known: false` and no success status at all; one that declares its answer now carries a `200` built from the declaration — a `$ref` to the model's record schema for a field naming a model, the column's own schema for a field naming one, and `additionalProperties: false`, because the document says what the gate does.
