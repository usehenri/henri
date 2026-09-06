---
title: Filtering and sorting
description: A declared filter and sort surface for an index action — what a client may narrow a list by, with which operators, and what it may order it by, refused with a 422 when it asks for anything else.
sidebar:
  order: 7
---

Every index page ends up re-implementing this:

```js
// Don't
index: async (req, res) => {
  const where = {};

  if (req.query.state) {
    where.state = req.query.state;
  }
  if (req.query.q) {
    where.title = { $like: `%${req.query.q}%` };
  }

  return res.collection(
    await Proposal.where(where).order(req.query.sort || '-createdAt')
  );
},
```

Three things are wrong with it and only one of them is obvious. The order comes straight from the query string, so `?sort=password` is a valid request. The `state` is whatever a client sent, so a filter can reach a row the page was never meant to show. And the whole thing has to be written again for the next index, slightly differently.

The Rails answer to this is `ransack`, at a hundred and seventeen million downloads — and also, deservedly, near the top of the list of gems people find most frustrating, because `?q[email_cont]=@&s=password asc` reaches every column of every model and what an endpoint exposes stops being something anybody wrote down.

henri takes the opposite position:

> **Nothing undeclared is filterable, and nothing undeclared is sortable.**

## The declaration

A controller says what an action's list may be narrowed by and ordered by, in a `filters` export next to [`params`](/guides/controllers/#params-what-an-action-accepts) and keyed by action the same way:

```js
module.exports = {
  filters: {
    index: {
      where: {
        state: { enum: ['submitted', 'accepted'], type: 'string' },
        level: {
          enum: ['beginner', 'intermediate', 'advanced'],
          type: 'string',
        },
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
};
```

and a client writes it in the query string:

```
GET /proposals?filter[state]=accepted&filter[submittedAt][gte]=2026-01-01&sort=-submittedAt,title
```

A filter is a **parameter**, so it uses the vocabulary `params` already has (`type`, `enum`, `min`, `max`, `minLength`, `maxLength`, `pattern`) plus two keys of its own:

| Key         | What it is                                                             |
| ----------- | ---------------------------------------------------------------------- |
| `operators` | What may be asked of this field, on top of what its type already gives |
| `column`    | The column, when the name a client writes is not it                    |

A rule may be the type itself (`state: 'string'`). `required` and `default` are refused: a filter is what a client _may_ ask for, never what it has to — the narrowing an action always applies belongs in the scope.

The four keys of one action's declaration are `where`, `sort`, `default` and `model`. `sort` may be a list of column names or a map of the name a client writes to the column it means (`sort: { newest: 'createdAt' }`). `model` is only needed when the controller is not named after the model it lists.

## The operators

Thirteen words, and they mean the same thing on all three adapters:

| Operator                 | What it keeps                                                               | Shape                        |
| ------------------------ | --------------------------------------------------------------------------- | ---------------------------- |
| `eq`                     | rows where the column is the value (the default, written `filter[state]=x`) | one value                    |
| `ne`                     | rows where it is not                                                        | one value                    |
| `in`                     | rows where it is one of them                                                | a comma-separated list       |
| `nin`                    | rows where it is none of them                                               | a comma-separated list       |
| `lt`, `lte`, `gt`, `gte` | rows above or below                                                         | one value                    |
| `between`                | rows between the two, inclusive                                             | exactly two, comma-separated |
| `null`                   | rows with no value (`true`) or with one (`false`)                           | `true` or `false`            |
| `starts`                 | rows whose text starts with the value                                       | one value                    |
| `ends`                   | rows whose text ends with it                                                | one value                    |
| `contains`               | rows whose text holds it, anywhere                                          | one value                    |

They are henri's vocabulary and not the ORM's: henri turns them into **the adapter's own condition** — Sequelize's `Op` symbols, the `$` spellings Mongoose and Drizzle share — and never into SQL.

Two terms on one column are one comparison, so `?filter[at][gte]=x&filter[at][lte]=y` is a range and not the second clause overwriting the first.

### What a field gets by default, and why

The line is what a database can answer with an index:

- **every type** gets `eq`, `ne`, `in`, `nin` and `null`. An equality is an index lookup and a bounded amount of work whatever the column holds.
- **an ordered type** — `date`, `number`, `integer`, `float`, `decimal`, `bigint` — also gets `lt`, `lte`, `gt`, `gte` and `between`. A range over an ordered column is a range scan, which is the other thing an index does.
- **the three text operators are opt-in, per field, by name.** `contains` on an unindexed text column is a full scan an unauthenticated client can ask for as often as it likes, and there is no bound henri can put on it: the honest answer is that the application says which columns it has thought about.

`starts` is a prefix, which an ordinary b-tree index answers. `ends` and `contains` are not: on PostgreSQL they want a trigram index (`CREATE INDEX ... USING gin (title gin_trgm_ops)`), on MySQL a full-text one, on MongoDB a text index — and henri cannot check that you made one. Declaring the operator is the application saying it knows.

### A value is a literal

`%` and `_` in a text-operator value are **refused** with a 422 rather than escaped. They are the wildcards this whole surface exists to keep a client from sending, and the three dialects do not agree on an escape character (sqlite has none without an `ESCAPE` clause henri would have to write as SQL). On MongoDB the value becomes a fully escaped literal `$regex`, walked character by character, never a pattern from the request.

An application that wants wildcard search writes that query itself.

## Ordering

`?sort=-submittedAt,title` — most significant first, `-` for descending, at most `config.api.maxSort` of them (three). A column the action did not list is a 422.

**henri appends the record's `externalId` to every order it builds.** A page is only stable when the order is total, and paging through a list ordered by `submittedAt` alone silently shows and hides the rows that share a timestamp. `externalId` is a uuid v7, unique and indexed on all three adapters, so the tiebreaker costs nothing and the page is exact. A model that opted out of `externalId` (`options: { externalId: false }`) gets no tiebreaker.

`default` is what applies when the request asks for nothing, and it names columns the declaration already listed.

## What can never be declared

These fail the **boot**, naming the controller, the action and the field (`HENRI_FILTER_DECLARATION_INVALID`) — not the request, because a filter surface that got there at request time would be a 500 waiting for the first client to ask for it:

- **a column the model does not have.** A typo that filtered nothing would quietly answer the whole table.
- **a randomised `encrypted` column**, and anything but an equality on a deterministic one. The adapters refuse exactly this (`HENRI_ENCRYPTION_NOT_QUERYABLE`); this inherits the refusal rather than routing around it. See [Encrypted attributes](/guides/encryption/).
- **an order over an `encrypted` column**, either kind: the rows would come back ordered by ciphertext.
- **an order over a `text` or a `json` column.** A `text` column has no bound and no order worth sorting by — the database answers it with a filesort over everything. A `string` is bounded and is fine.
- **a `json` column, in a `where`**: there is no comparison henri can spell on three adapters.
- **a column marked `personal: { expose: false }`.** henri promised that value never leaves; a filter over it hands it back one bit at a time, which is the same value with more steps. A field marked plain `personal: true` **is** filterable — it is in the answer already. See [Personal data](/guides/privacy/).
- **a declared foreign key.** Its public value is another row's `externalId`, so matching it is a lookup henri would have to make per term — the same refusal [the derived GraphQL schema](/guides/graphql/) makes. Resolve it in the controller and put the key in the scope:

  ```js
  const scope = { state: PUBLIC_STATES };

  if (req.query.event) {
    const edition = await Event.findById(req.query.event);

    scope.eventId = edition ? edition.id : 0;
  }

  const { order, where } = await req.filters({ scope });
  ```

## The scope wins

`req.filters()` answers `policy.scope(user) AND (what the client asked for)`. An **and**, spelled for the adapter — never a merge of keys, so two conditions on one column intersect and never replace each other.

**A client-supplied filter narrows a list and can never widen it.** That is the whole promise, and it is what makes the surface safe to expose: the worst a hostile query string can do is answer fewer rows.

The scope is [`policy.scope(user)`](/guides/policies/#scoping-a-list) and it is asked for by default, which is what makes this safe to reach for: an action that calls `req.filters()` on a model whose policy declares no scope gets the refusal `henri.policies.scope()` already gives rather than "everything".

```js
await req.filters(); // the policy of this route
await req.filters({ policy: 'proposal' }); // another one
await req.filters({ scope: { state: PUBLIC } }); // a condition of your own
await req.filters({ scope: false }); // this list is public
```

`scope: false` is how an application says, once and in writing, that a list takes no scope at all.

## What `req.filters()` answers

```js
const { model, order, sort, terms, where } = await req.filters();
```

| Key     | What it holds                                                       |
| ------- | ------------------------------------------------------------------- |
| `where` | the condition to query with, spelled for this model's adapter       |
| `order` | the order, spelled for the same, with the tiebreaker appended       |
| `sort`  | what the request asked to order by (`{ column, descending, name }`) |
| `terms` | what it asked to filter by (`{ column, name, operator, value }`)    |
| `model` | the model the declaration is about                                  |

`sort` and `terms` are for the page: a table header that shows which column is sorted, a set of chips that shows what is filtered, and the query string to put back in every link.

## The refusal

A request that asks for something the action did not declare is a **422 before the action runs**, behind the role and the policy guards, with one message per term:

```json
{
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "message": "the filters are invalid",
  "code": "HENRI_FILTER_INVALID",
  "data": {
    "errors": {
      "filter[speakerId]": "is not a filter Proposal accepts here (level, state, submittedAt, title)",
      "sort": "cannot order by \"abstract\" (submittedAt, title)"
    }
  }
}
```

It is negotiated like every other answer henri gives, so a browser gets the page and an API client gets the body above.

An **empty value is an absent filter**: a browser sends `filter[state]=` for every select nobody touched, and an index page is a form.

## The links carry it

Nothing to do. `res.collection()` builds `next` and `prev` out of the url as requested and only ever sets `page` and `per_page`, so the filter and the sort ride along:

```
Link: </proposals?filter%5Bstate%5D=accepted&sort=title&page=2&per_page=12>; rel="next"
```

Page two of a filtered list is page two of the same list, which is the whole reason the tiebreaker above exists.

## `henri openapi` describes it

A declared filter is a description of a request, which is what an OpenAPI operation wants, so [`henri openapi`](/guides/openapi/) writes one query parameter per comparison, spelled the way a client writes it:

```json
{
  "name": "filter[state]",
  "in": "query",
  "required": false,
  "schema": { "type": "string", "enum": ["submitted", "accepted"] }
},
{
  "name": "filter[title][contains]",
  "in": "query",
  "schema": { "type": "string" }
},
{
  "name": "sort",
  "in": "query",
  "style": "form",
  "explode": false,
  "schema": {
    "type": "array",
    "maxItems": 3,
    "items": {
      "type": "string",
      "enum": ["submittedAt", "-submittedAt", "title", "-title"]
    }
  }
}
```

A list operator (`in`, `nin`, `between`) is an array in OpenAPI's `form` style with no explode, which _is_ the comma-separated spelling. `x-henri.filters` carries the same thing as a summary — the model, the sortable columns and the operators of each field — and `x-henri.enforced` names `filters` on an operation that has them.

## Configuration

| Key              | Default | What it bounds                                     |
| ---------------- | ------- | -------------------------------------------------- |
| `api.maxFilters` | `8`     | the most `filter[...]` terms one request may carry |
| `api.maxSort`    | `3`     | the most columns one request may order by          |

## Deliberately not here

- **No `or` between filters.** A client composing boolean algebra over your columns is `ransack`, and it is the thing this page exists to avoid.
- **No free-text search across columns.** That is a search engine, and henri is not one.
- **No cursor paging.** The tiebreaker makes offset paging exact; a cursor is a different feature with a different contract.
- **No filtering across an association.** Resolve it in the controller and put the key in the scope, the way a reference is resolved above.
- **No operator an application can add.** The vocabulary is closed, because every word in it has to mean the same thing on three adapters.
