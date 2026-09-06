---
'@usehenri/core': patch
'@usehenri/cli': patch
---

`henri openapi` describes the parameters an action declared, and the 422 they answer.

The parameter check of a `params` declaration is registered next to the guards whatever the verb, so a `GET` declaring `page: { type: 'integer', min: 1 }` answers 422 on `?page=banana`. The document tied 422 to `mutating && idempotency`, so it denied that answer — and where it did emit one, the component said the `Idempotency-Key` had been reused, which is a different failure fixed a different way.

The document now reads the declarations, from `henri.controllers.accepts()` on a booted application and from the same `declarations()` compiler over the controller files in the command, so both write the same document:

- the declared fields are the query, path and body parameters of the operation, with the types, the bounds and the enums the rule wrote. A mutating action that declares `params` gets that as its request body — what henri actually checks — instead of the model's writable columns, which stay in `components.schemas` as `<Model>Input`.
- every 422 names its cause: `InvalidParameters` (the parameter check), `IdempotencyMismatch` (the key was reused for a different request), `UnprocessableEntity` (both can happen on that operation), and `ValidationFailed` for the account endpoints henri mounts, which used to share the idempotency wording.
- a controller the command could not load, or whose declaration would fail the boot, is marked rather than described as accepting nothing: `x-henri.params.read: false` on the operation, `info.x-henri.params.unread` in the document and a section in `henri openapi --summary`.

`x-henri.enforced` is a list now (`['_links', 'params']`), because a route can enforce both.
