---
'@usehenri/core': minor
'@usehenri/cli': minor
---

`_embedded`: a record's relations, in the answer that already holds it.

henri answered half of HAL. `_links` said where a client may go next; `_embedded` was only ever the items of a collection, never a record's own relations — so a client that wants an invoice and its lines makes two requests, and a page of twenty invoices makes twenty one. That is the client-side N+1 `_embedded` exists to prevent, and this is henri's answer to it.

An action says what may travel with a record in an `embeds` block, next to `params`, `answers` and `filters`:

```js
// app/controllers/invoices.js
module.exports = {
  embeds: {
    show: {
      customer: 'customerId',
      lines: { limit: 200, through: 'Line.invoiceId' },
    },
    index: { customer: 'customerId' },
  },

  show: async (req, res) => res.resource(req.invoice, { embed: ['lines'] }),
};
```

A relation is written as **the foreign key it goes through**, because that is the only thing henri can check: `'customerId'` is a key this model declared and the record it names is embedded; `'Line.invoiceId'` is a key another model declared at this one and the records naming it are. Both have to be declared references — `belongsTo()`, `references: { model }`, Mongoose's `ref` — and anything else fails the boot, for the reason `base/references.js` gives at length: henri reads no field name to decide what points where.

A client asks with `?embed=lines,customer` and only for what the action declared; anything else is a **422 before the action runs**, at most `config.api.maxEmbeds` (3) relations may be asked for at once, and an action with no `embeds` block has no such surface at all. `res.resource(record, { embed })` is the caller's word and wins over the query string.

**The exit gate is the same gate.** The embedded records are handed to the same `toPublic()` call as the records they hang off, in one list, so `publish()` and `henri.privacy.strip()` run over them exactly as they run over everything else: foreign keys leave as the `externalId` of the row they name, no primary key leaves, and a column marked `personal: { expose: false }` is no more reachable through `_embedded` than through the record itself. There is no `embed` that skips either pass, because `_embedded` is assembled out of what the gate handed back.

**The policy is asked per record.** Every embedded record is asked `show` against its own model's policy, by the rule `_links` already follows: a model with a policy is asked about every record, a model with none is not asked at all. A record the policy refuses is **absent** — not a stub and not a `null`, because the request the client would otherwise have made would have been a 404, and a 404 carries nothing.

**One statement per relation per answer**, whatever the page size: the parents' keys are collected, deduplicated and asked for once, then the rows are grouped in memory — the shape `base/references.js` already uses for its own lookups. A list is capped per record at `limit`, or at `config.api.maxEmbedded` (25), ordered by the foreign key and then by the target's `externalId`; a relation that holds more than it promised is reported once per route and the client is served the prefix, rather than the answer failing after the work is done.

`henri openapi` describes it: one `embed` parameter whose enum is the relation names, `x-henri.embeds` next to `x-henri.filters`, and `embeds` in `x-henri.enforced`.

Two new configuration keys, `api.maxEmbeds` and `api.maxEmbedded`, and three new error codes: `HENRI_EMBED_DECLARATION_INVALID`, `HENRI_EMBED_INVALID` and `HENRI_EMBED_ADAPTER_UNSUPPORTED`.
