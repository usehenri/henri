---
'@usehenri/core': minor
'@usehenri/cli': minor
---

A refused record and a record that is not there answer the same 404.

A record-level refusal answers `404` rather than `403` for one reason: a `403` confirms the record is there, which is half of what whoever asked wanted. The body then said it anyway. Measured on an application signed in as somebody who does not own the record:

```
record exists, the policy refuses   404 {"message":"Not allowed to show this memo",...}
record does not exist               404 {"message":"Memo 01a0…000 not found",...}
```

Both halves were henri's own text — `PolicyError`'s message and the `res.boom.notFound()` line `henri generate scaffold` writes into every controller it makes — so every scaffolded application using `policy: true` announced the refusal in the field a client reads first.

Now the message of a `404` refusal is a development aid: it is answered in development and in a test process, and in production the reason phrase is the whole body. That is the call `base/http.js` already made for the route 404, in one function so the two halves cannot drift, and the reason still reaches the `policies denied` log line in every environment. A refusal an application configured to answer `403` keeps its message everywhere — `config.policies.status: 403` is that application deciding to tell them.

The other half is **`res.notFound(why)`**, new on the response, and what the generator now writes:

```js
if (!req.task) {
  return res.notFound(`Task ${req.params.id} not found`);
}
```

`why` follows the same rule, so the pair is one answer. It also negotiates — the error page for a browser, the boom envelope for an API client — which `res.boom.notFound()` does not: it answers JSON whatever the client asked for, so a browser could tell the two apart by shape even when the words matched. `res.boom` is unchanged and is still the answer for everything else.

One difference is left and is documented rather than closed (`3.policies.js`, and a caution in the policies guide): the `401` an **anonymous** visitor gets is uniform only when it is decided before anything is looked up. A rule that takes a record cannot be, so on a route guarded only by such a rule an anonymous visitor still gets the login page for an id that exists and a 404 for one that does not. A `roles` on the route turns them away at the gate, before the lookup.
