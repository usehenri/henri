---
title: OpenAPI
description: henri openapi writes the OpenAPI 3.1 description of what an application exposes, from its routes, its models and its configuration — and says, in the document, what it cannot know.
sidebar:
  order: 8
---

```bash
henri openapi                      # the document, on stdout
henri openapi --out openapi.json   # written to a file the application commits
henri openapi --summary            # what it covers, and what henri cannot know
```

`henri openapi` writes the [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0.html) description of the HTTP surface an application exposes. It is generated, never hand-written: it reads `config/routes.js` the way the router reads it, `app/models` the way the adapters read it, and `config/<env>.json` the way the boot reads it. It starts no server and opens no database, so it runs in CI and in a container that has neither.

Most frameworks cannot generate a good one, because they know nothing about their own answers: the description ends up being a second, hand-maintained copy of the application that drifts the moment a controller changes. henri is unusually well placed here, because a large part of what an application answers is henri's own doing — the HAL envelopes, the paging, the error body, the guards — and that part can be derived rather than guessed.

The other part cannot, and this page is mostly about that.

## What the document says

Everything below comes from the application, never from a convention henri hopes it follows.

| In the document                   | Read from                                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The paths and the verbs           | `config/routes.js`, expanded by [`base/routes.js`](/guides/routes/) — the same table `henri routes` prints                                                                |
| The path parameters               | The `:id` of the route, typed as the record's `externalId` when the model carries one                                                                                     |
| The query and body parameters     | The [`params`](/guides/controllers/#params-what-an-action-accepts) an action declared, where it declared any — the types, the bounds, the enums and what is required      |
| The schemas                       | `app/models`, plus the columns the adapters add (`externalId`, `createdAt`/`updatedAt`, `deletedAt`, and the user's `email`, `roles`, `confirmedAt`, `passwordChangedAt`) |
| The HAL envelopes                 | [`res.resource()` and `res.collection()`](/guides/api/#answering-hal), for the routes expanded from `resources` and `crud`                                                |
| The error envelope                | [`res.boom.*`](/guides/api/) and the 404/500 handlers, with the `code` of the [error catalogue](/reference/errors/)                                                       |
| Which statuses a route can answer | Its own guards: `roles`, `policy`, `version`, `Idempotency-Key`, the rate limit                                                                                           |
| `page` and `per_page`             | `config.api.perPage` and `config.api.maxPerPage`                                                                                                                          |
| The security schemes              | The session cookie and the bearer token the [user module](/guides/users/) mounts, and the `X-CSRF-Token` a mutating request needs                                         |
| `POST /login`, the account flows  | `config.user`: they are in the document only when henri actually mounts them                                                                                              |
| The identity endpoints            | `config.user.identities`: the providers are the `enum` of the path parameter, and every refusal is described by the `data.reason` it carries                              |
| `/livez`, `/readyz`, `/healthz`   | Always: every henri application answers them                                                                                                                              |

Every operation also carries `x-henri.enforced`, a list naming what henri actually checks on that route — `_links` on the ones expanded from `resources` and `crud`, `params` on the ones whose action declared any, `answers` on the ones whose action declared what it sends — as opposed to what it expects.

A field marked `personal: { expose: false }` is in **no** schema, because [privacy](/guides/privacy/) strips that name from every answer henri builds, at every depth. Neither is `password`. A declared foreign key is typed as the `externalId` of the row it names, because that is what [`base/references.js`](/guides/models/#identifiers) publishes — and `null`, because a key that names no row resolves to nothing.

A [`decimal` and a `bigint`](/guides/models/#exact-numbers) are `{ "type": "string" }` with a `pattern` (`^-?\d+(\.\d+)?$` and `^-?\d+$`) and a `format` (`decimal`, `int64`), because a string is what the JSON answer carries and a JSON number is a double. `minimum` and `maximum` are deliberately left off those two: a numeric bound on a value the document has just called a string describes nothing. The model still enforces it.

## What an action declared it accepts

A controller that declares [`params`](/guides/controllers/#params-what-an-action-accepts) has told henri the shape of the request it takes, which is exactly what an OpenAPI operation wants. So the document is built from it rather than around it:

- a field the route templates (`:id`) is that **path parameter**, typed by the rule;
- on a verb with no body, everything else is a **query parameter**;
- on a mutating verb, everything else is the **request body** — the declaration, not the model's columns — with `required` where the rule says so and `additionalProperties: true`, because an undeclared key is dropped rather than refused and the action may still permit one of the model's columns by name;
- and the operation answers **422**, on every verb.

That last one is the reason this exists. The check is registered next to the guards whatever the verb, so an `index` declaring `page: { type: 'integer', min: 1 }` answers `422` on `?page=banana` — an answer the document used to deny, because it tied `422` to the idempotency of a mutating route. Which `422` it is now has a name of its own:

| Component             | What answered it                                                                     |
| --------------------- | ------------------------------------------------------------------------------------ |
| `InvalidParameters`   | The parameter check: `HENRI_PARAMS_INVALID`, one message per field in `data.errors`  |
| `IdempotencyMismatch` | The `Idempotency-Key` was already used for a different method, url or body           |
| `UnprocessableEntity` | Both can happen on this operation; `code` says which                                 |
| `ValidationFailed`    | A value one of the account endpoints henri mounts refused (a duplicate address, say) |

A generated client reading a parameter refusal as a replayed key is exactly the kind of drift this document exists not to have.

### Where the declarations are read

They live in a controller file, and the block holds regular expressions and functions, so there is nothing to scan for. **`henri openapi` loads the controller with `require()`** — which is what reading the action names already did — and compiles the block with the same `declarations()` the boot compiles it with. A booted application hands over what `henri.controllers.accepts()` already holds. One compiler, one answer: `GET /_openapi.json` and `henri openapi` agree operation for operation, and the suites check that.

The command still starts no server and opens no database, but loading a controller does run whatever that file runs at import time. A henri controller is a plain object of handlers, so that is normally nothing; a file that reaches for a model global while it loads throws, and then:

```json
"x-henri": { "params": { "read": false } }
```

The operation declares no parameters of its own and no `422` for them, its description says why, and `info.x-henri.params.unread` lists every such action — `henri openapi --summary` prints them. That is the one place the two ways of building this document can differ, so it is in the document rather than left to be discovered.

## What it refuses to say

A controller can answer anything. `res.render()` is not JSON. A hand-written route points at an action henri never wrapped. A generated document that describes an answer henri does not give is worse than no document at all, so the rule is: **an honest `unknown` beats a wrong `object`.**

### An operation henri did not wrap

A hand-written route (`get /about`), a `member` or `collection` route of a resource, the root of a namespace: these carry **no success status at all**. What they carry is the failures henri answers before the action runs — a 401 from the role guard, a 404 from the policy, a 406 from the version guard, a 409 from an idempotency replay — plus a `default` response saying so in words:

```json
"default": {
  "description": "Not described: what this action answers is the controller's own. A failure henri answers itself uses the error envelope; anything else is this application's.",
  "content": { "application/json": { "schema": {} } }
}
```

`{}` is the JSON Schema for "any value". It is the only correct answer, and the operation's `x-henri.known` is `false` so a reader — a person or an agent — never has to work that out from prose.

### An operation that said what it answers

There is one way to move an operation out of that column without changing what it answers: the action declares it. An [`answers`](/guides/controllers/#answers-what-an-action-answers) block is a description of what leaves, which is exactly what this document could not know, so an operation that has one carries a `200` built from it — a field naming a model `$ref`s that model's record schema, a field naming a column carries that column's schema, and `additionalProperties` is `false` because henri drops what the action did not declare. `x-henri.known` is then `true`, `x-henri.answers` lists the fields and `x-henri.enforced` names `answers`. The `default` response stays, for the statuses the action chooses itself.

### Which of two shapes a guarded route answers

The routes expanded from `resources` and `crud` are the ones henri does guard — but what it guards is `_links`, and nothing else. Two of henri's own answers carry them: the HAL envelope of `res.resource()` and `res.collection()`, and the page options of `res.render()` and of the implicit render (an action that returns an object without answering). A `resources` route that renders a page answers the second one, and it is a perfectly ordinary thing to do — the showcase's `events#index` does it.

So a successful response names both, HAL first (`anyOf`), and the description says which is which: `_embedded` is what tells them apart. Promising one and letting an application answer the other is exactly the drift this document exists not to have.

### A form page

`new` and `edit` are the same story with the odds reversed, so they name both shapes too — and they are counted as unknown, because a form page is a body henri does not write.

### A required field

Nothing in a response schema is `required`, and every schema is open (`additionalProperties: true`). An action may present its records before sending them — the showcase does, and its proposals carry an embedded `speaker`, `event` and `track` that are in no model. A response schema that claimed `title` is always there would be wrong for every application that presents a summary. What the schema does say is: _these columns, with these types, when they are there._ Each property's description says whether the model requires the column.

The one exception is `_links`, and only when `config.api.strict` is on: with it, henri refuses a `resources` JSON answer that has none, so `required` is the truth.

### A request body an action did not declare

`req.permit('title')` names the fields and henri never sees that list. Without a [`params`](/guides/controllers/#params-what-an-action-accepts) declaration the input schema is the model's writable columns — no `required`, `additionalProperties: true` — because a column the model requires may well be set by the server (the speaker of a proposal is the session, never the body). A **foreign key gets no type at all**: whether a form posts an `externalId`, a primary key or nothing is the application's decision.

With a declaration the body is the declaration, which is the shape henri itself checks; the model's columns stay in `components.schemas` as `<Model>Input` and the operation says so.

### An action that does not exist

A route pointing at an action the controller does not export answers 501 in development and is never registered in production. The document says exactly that, rather than describing an endpoint nobody can call.

## Reading the coverage

Every operation carries an `x-henri` object, and `info.x-henri.coverage` totals them:

```bash
$ henri openapi --summary

OpenAPI 3.1.0 for @usehenri/showcase 0.0.0

  47 operations, 36 paths
  27 described from the routes, the models and henri's own endpoints
  20 whose answer henri cannot know

  What henri cannot know (the controller writes the body; only the failures henri answers itself are described):
    GET /  main#home
    GET /about  main#about
    ...
```

Twenty of forty-seven is not a failure of the tool: it is what an application with pages, member routes and form actions actually looks like. Moving an operation from one column to the other is a matter of answering it with `res.resource()` or `res.collection()` from a `resources` route, which is what henri asks for anyway — or of declaring its answer, for the ones that legitimately send something else.

## Where the document lives

**As a file.** `henri openapi --out openapi.json` writes it where the application commits it, and the diff of that file in a pull request is the diff of the API. Regenerating it in CI and failing on a change nobody meant is a two-line job.

**As an endpoint, in development only.** A booted application answers `GET /_openapi.json`, next to `/_routes` and `/_controllers` and under the same rule: **development only, and from the loopback interface only.** The document names every route of the application, the roles that guard each one and the policy behind it, which is a map an anonymous visitor has no business reading. An application that wants to publish it puts the generated file in `app/views/public/`, where it is served as a static file, or serves it from a route of its own — a deliberate decision rather than a default.

## For coding agents

The [MCP server](/guides/agents/) exposes it as the `openapi` tool. It is the fastest way for an agent to learn the HTTP surface of an application: one call, every path, its guards, its request body and the answers henri produces — and, where henri cannot know, a mark saying so instead of a shape to be misled by.

## What is out of scope

- **A UI.** No Swagger UI, no Redoc, no bundled viewer. The document is a file; point whatever you like at it.
- **Request validation.** henri does not validate a request against the document, and the arrow points the other way: [`params`](/guides/controllers/#params-what-an-action-accepts) is the gate and the document is written from it. A second, generated gate reading this file back would be a second source of truth.
- **Client generation.** The document is standard; the generators for it already exist and are better than anything shipped here would be.
- **GraphQL.** It has a schema of its own. `config.graphql` names where to ask for it, and the description says so in `info.description` rather than describing the endpoint.

## Exit codes

`henri openapi` exits `0`, `3` outside an application, `2` on `--out` without a file name, and `1` with `HENRI_API_DESCRIPTION_UNWRITABLE` when the file cannot be written. See [Errors](/reference/errors/).
