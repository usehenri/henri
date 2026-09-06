---
'@usehenri/core': minor
---

Every entry point an application calls checks what it is called with.

JavaScript is not strongly typed and TypeScript erases at runtime, so henri validates exhaustively at its boundaries and trusts what is inside. The configuration was the first boundary and the request a controller answers was the second. This is the third and the last one an application can reach: the roughly fifty methods on `henri.*`, on `req` and on `res`.

Until now some of them threw something a person could act on, some threw a `TypeError` three frames down naming a variable of henri's rather than the mistake, and some did nothing at all — so the application found out later, or never.

**A call henri cannot honour raises `HENRI_ARGUMENT_INVALID`**, naming the method, the argument, what was expected and what arrived, with every problem reported rather than the first:

```
henri.cache.fetch(fn) must be a function, but it is the number 42
req.pagination(overrides.perPage) must be a whole number above zero, but it is the string "abc"
res.render(options) must be an object, but it is the string "oops"
henri.privacy.erase(options.stratgy) is not one of its options: did you mean "options.strategy"?
```

The signatures are data (`src/base/arguments.js`) in the node vocabulary `config-schema.js` already established — no dependency, and no second schema language: `config-validate.js` gained `problems(node, value, key)`, so one walker serves both, and it learned the two kinds a call can pass and a JSON file cannot, `function` and `date`.

**Eight of these were answering something wrong rather than refusing**, and those are the changes worth reading:

- `res.negotiate({})` answered `406 Not Acceptable`, which blames the client's `Accept` header for a mistake in the controller; a non-function handler threw from inside express with no henri frame in the stack.
- `res.render(route, 'oops')` read the string as a GraphQL query — and said so only in development. `data` and `graphql` together silently discarded the data.
- `req.pagination({ perPage: 'abc' })` produced `NaN` and handed it to the ORM as `.limit(NaN)` and to the HAL paging links.
- `res.resource(record, null)` threw a destructuring `TypeError` from the parameter list, over the good message just below it; a non-array `include` reached a substring match where it **un-hides a field marked `personal: { expose: false }`**.
- `henri.privacy.erase(record)` took any object as the person it named, so a record carrying no primary key reached the erasure as `{ id: undefined }` — every row, on some adapters.
- `henri.mail.send(message)` with no recipient succeeded under `NODE_ENV=test`, where the transport is nodemailer's json one, and failed only in production.
- `deliverLater({ delay: 60 })` ignored the misspelled key, which is a mail that leaves immediately.
- `henri.cache.fetch()` refused a bad `ttl` only _after_ the function had run, so it rejected the call and threw away the value it had just computed.

**A selector that names nothing is its own refusal**, `HENRI_ARGUMENT_UNKNOWN_TARGET`: `henri.retention.sweep({ only: 'Propsal' })` and `henri.encryption.rotate({ model: 'Usr' })` used to report a clean, successful, empty run, which is exactly what somebody reads as the work being done — an operator dropping the old key after a rotation that rotated nothing.

Three rules decide where a check goes, and each is in the module header. **An argument is checked once, at the method an application names**: `henri.can()` and `req.can()` both funnel into `henri.policies.can()`, so that is the one that checks, and the loops in `links()`/`paths()` ask an unchecked body they share. **`null` is not the same as absent for an argument** — `options = {}` only fills in for `undefined` — and _is_ the same for a selector inside an options bag, though not for a key whose absence has a default. **A check never goes inside a loop of henri's own**: `res.collection(records)` checks the list and not the rows, and `henri.encryption.encrypt`/`decrypt` guard by hand with three `typeof`s and no allocation, because the adapters call them once per row per encrypted column. The checks run in production too: there is no build step to compile them out, and a check missing from the one place a wrong call is expensive is not worth having.

**What already refuses well was left alone, and saying so is part of it.** A bad cache key, an unstorable cache value, a trail entry with no action, an unknown mailer and a model's own declarations all keep their own codes and messages. `henri.model.errors()`, `henri.policies.get()` and `henri.config.has()` stay total and answer `null` or `false`. `henri.reporter.report()` stays deliberately lenient — it runs on a failure path, so refusing a wrong call there would lose the failure it was called about — and its `null` options no longer read as "the error handler threw".

**None of it can fall behind.** `src/__tests__/arguments.spec.js` walks the surface the way the configuration's own test does: every method `index.d.ts` declares is checked or listed with the reason it is not, every declared signature is checked somewhere in the source, and every entry point is called with garbage derived from its own declaration. A new public method that forgets its check fails it. The declarations moved with the code — `res.negotiate()` now takes an html handler, a json one, or both and never neither, `RenderOptions` is `data` or `graphql` and never both, an erasure strategy is one of the four henri has — and `types/core.test-d.ts` makes eleven of the wrong calls part of the type test.
