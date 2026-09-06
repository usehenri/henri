---
'@usehenri/core': minor
'@usehenri/mongoose': patch
---

A declared filter and sort surface for an index action.

Every index page ends up re-implementing this, and it is the one surface where an application writing a query out of request parameters gets hurt. The Rails answer is `ransack`, at a hundred and seventeen million downloads and also near the top of the list of gems people find most frustrating: `?q[email_cont]=@&s=password asc` reaches every column of every model, so what an endpoint exposes stops being something anybody wrote down. henri takes the opposite position: **nothing undeclared is filterable, and nothing undeclared is sortable.**

A controller says what a list may be narrowed and ordered by in a `filters` export, next to `params` and keyed by action the same way:

```js
filters: {
  index: {
    where: {
      state: { enum: ['submitted', 'accepted'], type: 'string' },
      submittedAt: { type: 'date' },
      title: { operators: ['contains'], type: 'string' },
    },
    sort: ['submittedAt', 'title'],
    default: '-submittedAt',
  },
},

index: async (req, res) => {
  const { order, where } = await req.filters();
  const { page, perPage, records, total } = await Proposal.paginate({
    ...req.pagination(),
    order,
    where,
  });

  return res.collection(records, { page, perPage, total });
},
```

and a client writes `?filter[state]=accepted&filter[submittedAt][gte]=2026-01-01&sort=-submittedAt,title`. A filter is a parameter, so it uses the `params` vocabulary and is refused the same way: a 422 with one message per term (`HENRI_FILTER_INVALID`), before the action runs, behind the role and policy guards.

**The operators are henri's, not the ORM's** — `eq`, `ne`, `in`, `nin`, `lt`, `lte`, `gt`, `gte`, `between`, `null`, `starts`, `ends`, `contains` — turned into the adapter's own condition (Sequelize's `Op` symbols, the `$` spellings Mongoose and Drizzle share) and never into SQL. Every type gets the equalities; an ordered type gets the ranges; **the three text operators are opt-in, per field**, because `contains` on an unindexed column is a full scan an unauthenticated client can ask for as often as it likes. A text value carrying `%` or `_` is refused rather than escaped: the wildcards are the thing this surface exists to keep out, no dialect agrees on an escape character, and on MongoDB the value becomes a fully escaped literal `$regex`.

**The scope wins.** `req.filters()` answers `policy.scope(user) AND (what the client asked for)` — an `and`, spelled for the adapter, so two conditions on one column intersect and a filter can only ever narrow a list. The scope is asked of the policy by default, so an action reaching for this on a model whose policy declares no scope gets the refusal `henri.policies.scope()` already gives; `req.filters({ scope: false })` is how an application says a list is public.

**What can never be declared fails the boot**, naming the controller, the action and the field (`HENRI_FILTER_DECLARATION_INVALID`): a column the model does not have, a randomised `encrypted` one, anything but an equality over a deterministic one, an order over a `text`, `json` or `encrypted` column, a declared foreign key (a lookup per term — the refusal the derived GraphQL schema already makes), and a field marked `personal: { expose: false }`, because a filter over a value henri promised not to hand over answers the same value one bit at a time.

henri appends the record's `externalId` to every order it builds: a page is only stable when the order is total, and paging through a list ordered by one timestamp silently shows and hides the rows that share it. The paging links carry the filter and the sort, because `res.collection()` builds them out of the url as requested. `config.api.maxFilters` (8) and `config.api.maxSort` (3) bound one request, and `henri openapi` describes the whole surface: one query parameter per comparison, spelled the way a client writes it, plus `x-henri.filters`.

`Model.paginate()` on Mongoose now accepts `order` as the name of its `sort` option, so what `req.filters()` answers reads the same on every adapter.
