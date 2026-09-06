---
'@usehenri/core': minor
---

Controllers declare the shape of what each action accepts.

`req.permit('title', 'year')` picks fields by name and says nothing about what they hold. `?year=banana` reached the model, and what a person saw was whatever the ORM said — a 500 on a good day, a silent `NaN` on a bad one. There was no way for an action to say what it takes.

There is now, in the block `before` already established: an export the router reads, keyed by action, never an action itself.

```js
module.exports = {
  params: {
    all: { format: { type: 'string', enum: ['html', 'json'] } },
    create: {
      title: { type: 'string', required: true, maxLength: 120 },
      year: { type: 'integer', min: 1400, max: 2100 },
      tags: { type: 'array', of: 'uuid', maxLength: 5 },
    },
    'index,search': { page: { type: 'integer', min: 1, default: 1 } },
  },

  create: async (req, res) =>
    res.resource(await Task.create(req.permit()), { status: 201 }),
};
```

The vocabulary is the one the models already use — `type`, `required`, `default`, `enum` — plus the bounds a request genuinely needs: `min`/`max` for a number, `minLength`/`maxLength` for a length (characters of a string, items of a list), `pattern`, and `of` for a list, which a query string produces on its own. No dependency was added and no second vocabulary invented.

**Coercion is the interesting half, and the source is the rule.** A textual source — the query string, a path parameter, a form body — is _parsed_ into the declared type: `?page=2` arrives as the number `2`, `?active=on` as `true`, `?at=2024-01-02` as a `Date`, because a string is all a client can send there. A JSON body is _checked_ and never parsed: `{"page": "2"}` is a caller sending a string where a number was declared, and it is refused. JSON can say `2`; it said `"2"`.

What is accepted is written back where it came from, so `req.query.page` is the number and not the string, and `req.permit()` **with no field at all** answers everything the declaration accepted, defaults included. An undeclared key is still dropped, never refused — a bookmarked url carrying `utm_source` is a link somebody shared, not an attack.

A request that does not match never reaches the action. It answers `422` with one message per field under `data.errors` — the `{ field: message }` shape `henri.model.errors()` already normalizes an ORM's validation failure to, so a form reads one thing whichever side refused it — and carries `HENRI_PARAMS_INVALID`. A browser that posted a form goes back to the page it came from with the messages in the flash; anything else gets the negotiated page or the JSON.

**A declaration henri cannot carry out fails the boot**, naming the controller, the action and the key (`HENRI_PARAMS_DECLARATION_INVALID`): an unknown type, an unknown key (`requird`), a constraint the type does not take (`min` on a string), a `default` the rule itself refuses, a selector naming an action the controller does not export. A declaration that quietly accepts everything is the failure this exists to remove.

The check runs where the guards already are: behind the role guard and the policy, ahead of the `before` hooks, so a hook that loads a record already sees the coerced value. An action that declares nothing is untouched, and `req.permit(...)` is unchanged.
