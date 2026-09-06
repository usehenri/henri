---
title: Controllers
description: Express handlers under app/controllers, autoloaded and reloaded on save, with before hooks, declared parameters, declared answers, implicit rendering and flash messages.
sidebar:
  order: 2
---

Controllers live in `app/controllers`. Every `.js` file there is loaded on boot, reloaded on save and referenced from `config/routes.js` as `file#action`; a file in a subdirectory is prefixed with it (`app/controllers/admin/users.js` is `admin/users#index`).

A controller is a plain object of Express handlers, `(req, res)` or `(req, res, next)`, sync or async, plus an optional `before` block, an optional `params` block saying what each action accepts and an optional `answers` block saying what each action answers. Models are globals, `henri` is a global, and `res.render()` hands data to the view.

A `/** @type {import('@usehenri/core').Controller} */` line above `module.exports` is what gives `req` and `res` completion in an editor; the generators write it for you. See [Types](/reference/types/).

```js
// app/controllers/tasks.js
const FIELDS = ['name', 'category', 'done'];

/**
 * Loads the task of `:id`, or answers a 404 and ends the request
 *
 * @param {object} req Express request
 * @param {object} res Express response
 * @returns {Promise<object|undefined>} The 404 answer, or nothing
 */
const loadTask = async (req, res) => {
  // `:id` is the public identifier of the record; findById() takes it
  req.task = await Task.findById(req.params.id);

  if (!req.task) {
    return res.boom.notFound(`Task ${req.params.id} not found`);
  }
};

module.exports = {
  before: { 'show,edit,update,destroy': loadTask },

  // No res.render(): what an action returns is the data of its own page
  index: async () => ({ tasks: await Task.find() }),

  show: async (req) => ({ task: req.task }),

  create: async (req, res) => {
    let task;

    try {
      task = await Task.create(req.permit(...FIELDS));
    } catch (error) {
      if (error.name !== 'ValidationError') {
        throw error;
      }

      return res.boom.badData(error.message, {
        errors: Object.fromEntries(
          Object.entries(error.errors).map(([field, e]) => [field, e.message])
        ),
      });
    }

    req.flash('notice', 'Task created');

    return res.negotiate({
      html: () => res.redirect(`/tasks/${task.externalId}`),
      json: () => res.resource(task, { status: 201 }),
    });
  },
};
```

This is the shape `henri generate scaffold` writes: a `before` hook loading the record once, `req.permit()` for the input, a `422` with one message per field when validation fails, a `404` when the record does not exist, and `res.negotiate()` so the same action serves a browser (redirect) and an API client (JSON).

Errors thrown or rejected by a controller are logged and answered with a `500`; the message and stack are exposed in development only. Requests nothing claims get a `404`. Both are content negotiated: JSON for API clients (the `res.boom` shape below), an HTML page for browsers.

## `before` hooks

`before` is henri's `before_action`: functions the router runs ahead of the actions they name, in declaration order, once the route is allowed (behind the [role guard](/guides/routes/#roles) and the `Idempotency-Key` replay). A hook is `(req, res, next)` or an async `(req, res)`, and **a hook that answers ends the request**: the action never runs.

```js
module.exports = {
  before: {
    all: [authenticate], // every action
    show: loadTask, // one action
    'edit,update,destroy': [loadTask, mustOwnIt], // several
  },
  // ...
};
```

`all` (or `*`) selects every action, any other key is one action or a comma-separated list. The array form takes the Rails selectors instead:

```js
module.exports = {
  before: [
    authenticate, // every action
    { only: ['show', 'edit', 'update'], run: loadTask },
    { except: ['index', 'new'], run: mustOwnIt },
  ],
  // ...
};
```

A hook may also be given by name (`before: { show: 'loadTask' }`), which resolves to another export of the same controller. `before`, [`params`](#params-what-an-action-accepts) and [`answers`](#answers-what-an-action-answers) are never routable: they are the keys of a controller that are not actions.

## `params`: what an action accepts

`req.permit()` picks fields by name and says nothing about what they hold. `params` says it: one block, keyed by action the way `before` is, one rule per field. What does not match never reaches the action.

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

  index: async (req) => ({ tasks: await Task.paginate(req.permit()) }),
  create: async (req, res) =>
    res.resource(await Task.create(req.permit()), { status: 201 }),
};
```

`all` (or `*`) is every action, any other key is one action or a comma-separated list, and the action's own key wins over the lists before it. A rule may be the type itself: `year: 'integer'` is `year: { type: 'integer' }`.

| Key                      | What it does                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                   | `string`, `text`, `number`, `integer`, `float`, `decimal`, `bigint`, `boolean`, `date`, `json`, `uuid` — the [model types](/guides/models/) — and `array` |
| `required`               | the field has to be there                                                                                                                                 |
| `default`                | what an absent field is worth; a function is called per request                                                                                           |
| `enum`                   | the values accepted, checked after the coercion                                                                                                           |
| `min`, `max`             | the bounds of a number; on a `decimal` or a `bigint` they are compared digit by digit and may be written out as strings themselves                        |
| `minLength`, `maxLength` | the bounds of a length: characters of a string, items of a list                                                                                           |
| `pattern`                | a regular expression a string has to match                                                                                                                |
| `of`                     | the rule every item of a list follows; a list declares it                                                                                                 |

A rule henri cannot carry out fails the boot with `HENRI_PARAMS_DECLARATION_INVALID`, naming the controller, the action and the key: an unknown type, an unknown key (`requird`), a constraint the type does not take (`min` on a string), a `default` the rule itself refuses, a selector naming an action the controller does not export. A declaration that silently accepts everything is the mistake this feature exists to remove.

### Coercion

A query string is all strings. A form body is all strings. A JSON body is not, and that is the rule:

- **A textual source** — the query string, a path parameter, a form body — is _parsed_ into the type. `?page=2` arrives as the number `2`, `?active=true` (or `on`, `yes`, `1`) as `true`, `?at=2024-01-02` as a `Date`. There is no other way for a client to say `2` there.
- **A JSON body** is _checked_, never parsed: `{"page": "2"}` is a caller sending a string where the action declared a number, and it is refused. JSON can say `2`; it said `"2"`. The types JSON cannot carry are the exception and are read from a string there as well: a `date` is an ISO-8601 string, a `uuid` is a string, and so are a `decimal` and a `bigint`.

The last two are the interesting case, because JSON _can_ express them — as a double, which is the value they exist to avoid. `{"price": 19.99}` is refused for that reason, and `{"price": "19.99"}` is what a client sends. From a textual source the digits are kept as a string rather than parsed into a number, so an [exact value](/guides/models/#exact-numbers) is the same string wherever it came from; `enum` matches by value there, so `'10'` matches a declared `'10.00'`, and `minLength`, `maxLength` and `pattern` are not constraints those two take — they measure text — so declaring one fails the boot.

The rest follows: an empty string from a textual source is an absent field (a browser sends one for every input nobody touched) unless the type is `string` or `text`; `null` is an absent field everywhere; a single textual value is a one-item list when the type is `array`, while a JSON body has to send the list; and `?year=1&year=2` is a list arriving where a number was declared, which is refused rather than silently taking one of the two.

What is accepted is written back where it came from, so `req.query.page` is the number and not the string, and `req.permit()` **with no field at all** answers everything the declaration accepted, defaults included. A field nobody declared is dropped, exactly as `req.permit('title')` drops it — there is no strict mode refusing an undeclared key, because a bookmarked url carrying `utm_source` is a link somebody shared and not an attack.

### When it does not match

The action never runs. The answer is a `422` carrying one message per field, negotiated like every other answer henri gives:

```json
{
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "code": "HENRI_PARAMS_INVALID",
  "message": "the parameters are invalid",
  "data": {
    "errors": { "year": "must be a whole number", "title": "is required" }
  }
}
```

`data.errors` is the `{ field: message }` shape [`henri.model.errors()`](/guides/models/) normalizes an ORM's validation failure to, so a form reads one thing whether the request was refused at the boundary or by the model. A browser that posted a form is sent back to the page it came from (`303`) with the messages in the flash, where a page reads them as `errors`; the values are not flashed, because henri cannot tell a password from a title. A browser that asked for anything else gets the `422` page.

The check runs once the route is allowed — behind the [role guard](/guides/routes/#roles) and the [policy](/guides/policies/) — and **ahead of the `before` hooks**, so a hook that loads a record already sees the coerced value. It is registered whatever the verb, so an `index` declaring its query string answers `422` the same way a `create` declaring its body does. An action that declares nothing behaves exactly as it did: nothing is checked, nothing is coerced, and `req.permit(...)` is unchanged.

### It is also the description of the request

[`henri openapi`](/guides/openapi/) reads this block: the fields become the query, path and body parameters of the operation, with the types, the bounds and the enums declared here, and the `422` becomes a response the document names. Declaring `params` is how an action gets a request body in the description that is the one it actually accepts, rather than the writable columns of its model.

## `answers`: what an action answers

`params` declares what arrives. `answers` declares what leaves, in the same block shape and with the same vocabulary — and it sits next to a rule that needs no declaration at all, so read the floor first.

### The floor: every JSON answer is published and stripped

`res.render()`, `res.resource()` and `res.collection()` have always gone through one gate on the way out: a foreign key leaves as the [`externalId`](/guides/models/#two-identifiers) of the row it names, and a field a model marked [`personal: { expose: false }`](/guides/privacy/) is dropped. **`res.json()` now goes through the same gate**, on every action of every controller, declared or not:

```js
// the models say `gender` never leaves; this does not change that
res.json({ rows: [{ email: user.email, gender: user.gender }] });
// => {"rows":[{"email":"ada@usehenri.io"}]}
```

That is the hole this closes. An object a controller builds by hand is not a record — the props of an Inertia page assembled in the action, a total next to a list — so nothing published it and nothing stripped it, and a field marked as never leaving left. There is no setting that turns the floor off: the mark is the model's word about a person, and a controller is not where it is overruled. `res.resource(record, { include })` and `res.render(view, { data, include })` are still how a private field is sent on purpose, and `expose: true` below is the third way.

henri's own answers are untouched by it — the HAL envelope, the page options, the `res.boom.*` body, the 404 and 500 pages, an Inertia page object — because those were built through the gate already or are an envelope with a shape of their own.

What the floor cannot do is see through a name. `res.json({ g: user.gender })` is a string as far as henri is concerned, and so is `{ ownerId: memo.ownerId }` — a plain object carries no model, so nothing knows that key names a row. Both are what a declaration is for.

The other thing it cannot do is read bytes. `res.json()` and `res.jsonp()` are gated because that is where the value still is; `res.send(JSON.stringify(value))`, `res.write()` and a stream hand over a string, and a string is not an answer henri can walk.

### The declaration

```js
module.exports = {
  answers: {
    all: { total: 'integer' },
    index: {
      rows: { model: 'Memo', type: 'array' },
      who: { from: 'User.email', type: 'string' },
    },
    show: { memo: { model: 'Memo' } },
  },

  index: async (req, res) =>
    res.json({
      rows: (await Memo.find()).map((memo) => ({
        ownerId: memo.ownerId,
        title: memo.title,
      })),
      total: await Memo.count(),
      who: req.user.email,
    }),
};
```

`all` (or `*`) is every action, any other key is one action or a comma-separated list, and the action's own key wins over the lists before it — the selectors `before` and `params` already use. A rule may be the type itself: `total: 'integer'` is `total: { type: 'integer' }`.

| Key        | What it does                                                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`     | the [model types](/guides/models/), plus `array` and `record`. Implied by `model` (a record) and by `from` (`json`, the type that says nothing)                                                          |
| `model`    | the model whose records this field holds: one record on its own, a list of them with `type: 'array'`. **This is what publishes a hand-built object**: `ownerId` above leaves as the owner's `externalId` |
| `from`     | `'User.email'`, the column this value came from. The field then obeys that column's marks under whatever name the answer gives it, and `henri openapi` types it from the model file                      |
| `of`       | the rule every item of a list of scalars follows                                                                                                                                                         |
| `required` | the field has to be in the answer                                                                                                                                                                        |
| `expose`   | `true` says this action may carry a field marked `personal: { expose: false }` — the declared form of the `include` `res.resource()` takes                                                               |

A rule henri cannot carry out fails the boot with `HENRI_ANSWERS_DECLARATION_INVALID`, naming the controller, the action and the field: an unknown type or key, a `model` that is not one of this application's, a `from` that is not `Model.field`, a list with neither `of` nor `model`, a selector naming an action the controller does not export, and a `from` pointing at a column marked `expose: false` without `expose: true` next to it. A declaration that reads like a guarantee and is quietly ignored is the mistake this exists to remove.

There is no `enum`, no `min`, no `pattern` and no `default`: a declaration describes the shape of an answer, and henri does not validate an application's own values on the way out — the model did that on the way in, and a response that fails after the work is done turns a cosmetic mistake into an outage.

### What is not declared does not leave

An action that declared answers sends the fields it declared, and nothing else:

```js
answers: { peek: { title: 'string' } },
peek: async (req, res) => res.json({ secret: req.memo.body, title: req.memo.title }),
// => {"title":"Minutes"}
```

That is the same rule `req.permit()` follows in the other direction — the declaration is the list, an undeclared key is dropped and never refused — and it is the safe direction: the field nobody declared is the field nobody thought about. It costs nothing to adopt, because it only applies to an action that declared: one that declares nothing keeps every byte it sends today.

The other half goes the other way. A field that was **declared and is missing**, or that holds something other than what was declared, is a mistake in the declaration rather than something leaking, so it is reported once per route in the log and only refused with [`config.api.strict`](/configuration/) — the setting that already means "refuse what would otherwise be a warning about this application's API", where it answers a 500 carrying `HENRI_ANSWERS_MISMATCH`.

The declaration is one level deep, like `params`: it describes the fields of the answer, not the inside of a record it names. What leaves inside a declared record is what the record holds, published and stripped by the floor.

### It is also the description of the answer

[`henri openapi`](/guides/openapi/) refused to describe what a controller writes: such an operation carried the statuses henri produces, `x-henri.known: false` and no success status at all. A declared answer is exactly what it could not know, so an operation that has one carries a `200` with the schema — `$ref`ing the model's record schema for a field naming a model, the column's own schema for a field naming one, and `additionalProperties: false`, because the document says what the gate does.

## Implicit rendering

An action that returns without answering renders its own page with what it returned, the way Rails renders `tasks/show` when the action falls through:

```js
show: async (req) => ({ task: req.task }),
// is res.render('/tasks/show', { data: { task: req.task } })
```

The page is `/<controller>/<action>`, and `/<controller>` for `index` (`app/views/pages/tasks/index.js` is the `/tasks` page). A non-object return value renders the page with no data. Nothing changes for an action that answers explicitly — `res.render()`, `res.json()`, `res.resource()`, `res.redirect()`, `res.boom.*`, `next()` — even when it does not await the answer. `return false` opts out, for the rare action that answers later on its own.

## Flash messages

`req.flash(type, message)` queues a message in the session; `req.flash(type)` reads and clears it, and `req.flash()` reads and clears the whole bag. A message survives exactly one redirect:

```js
req.flash('notice', 'Task created');
res.redirect('/tasks');
```

The page rendered next receives them as `flash` next to `data`, `user` and `paths` (`{ notice: ['Task created'] }`), which consumes them: `{{#each @flash.notice}}` in a Handlebars page, the `flash` prop of a React page (`useHenri().flash`), `useHenri().flash` with Inertia. A request that renders nothing leaves them alone, so a `POST` that answers JSON does not eat the notice of the page after it.

Flash messages live in the express session, which exists only in an application with a user model. Without one, `req.flash()` is a no-op answering an empty bag rather than an error.

## `res.render(route, options)`

`route` is the page to render: `/tasks/show` is `app/views/pages/tasks/show.jsx` with the Inertia renderer, `pages/tasks/show.js` with React, `pages/tasks/show.hbs` with Handlebars. `options` takes one of:

- `data`: an object passed to the page as its `data` prop or template context
- `graphql`: a query string; its result becomes `data` (see [GraphQL](/guides/graphql/))

Besides `data`, the view engine receives `user` (the public user or `null`), `paths` (the named routes the user may call), `query` (`req.query`), `csrf` (the CSRF token), `localUrl` (the server url), `flash` (the [flash messages](#flash-messages)), `errors` (GraphQL errors, if any) and `graphql` (`{ endpoint, query }`). A React page gets all of them as props except `query` (use `router.query`); Inertia pages and Handlebars templates get `query` too. A client asking for `application/json` gets the whole object as JSON instead of HTML; this is what the React helpers use to refresh a page.

`res.hbs(route, options)` renders a Handlebars template whatever the configured renderer, with the same options.

`data` and `graphql` are one or the other, never both: the query answers the page and the data would be thrown away, so the call is refused. So is a second argument that is not an object — it used to be read as a GraphQL query, and it said so only in development. See [Wrong calls](/reference/api/#wrong-calls).

## `req.permit(...fields)`

Never hand `req.body` to a model as is: a client could set `roles` or any other column. `req.permit()` returns a plain object holding only the fields you list, taken from the query string, the body and the path parameters (a path parameter wins over the body, the body over the query string). Fields that were not sent are left out, and `__proto__`, `constructor` and `prototype` are never copied.

```js
const data = req.permit('email', 'password', 'name');
const same = req.permit(['email', 'password', 'name']); // arrays are flattened
```

Every field has to be a name. One stray `undefined` — `req.permit(maybe)` where `maybe` turned out to be nothing — is refused rather than answering `{}`, which used to be a write that quietly saved nothing.

`henri.params(req).permit(...)` is the same helper for code outside the middleware chain, and `henri.params(req).all()` the merged parameters, for reading only.

An action that declared [`params`](#params-what-an-action-accepts) has had those fields checked and coerced before it ran, so `req.permit('year')` answers the number and not the string it arrived as, and `req.permit()` with no field answers the whole declaration. Without a declaration `req.permit()` answers `{}`: nothing is permitted unless it is named.

## `res.boom`

`res.boom.<name>(message, data)` answers a JSON error with a fixed shape. `message` defaults to the reason phrase and `data` is optional:

```js
res.boom.notFound('No such task', { id: req.params.id });
// 404 { "statusCode": 404, "error": "Not Found", "message": "No such task", "data": { "id": "..." } }
```

| Helper              | Status |
| ------------------- | ------ |
| `badRequest`        | 400    |
| `unauthorized`      | 401    |
| `forbidden`         | 403    |
| `notFound`          | 404    |
| `methodNotAllowed`  | 405    |
| `conflict`          | 409    |
| `badData`           | 422    |
| `tooManyRequests`   | 429    |
| `internal`          | 500    |
| `notImplemented`    | 501    |
| `badGateway`        | 502    |
| `serverUnavailable` | 503    |

`message` is a string: the envelope promises one and the [OpenAPI description](/guides/openapi/) says so, so `res.boom.badData({ title: 'is required' })` is refused — the detail goes in `data`, which is the second argument.

A third argument names the failure: `res.boom.notFound('No such task', null, 'HENRI_MODEL_UNKNOWN_STORE')` adds a `code` to the body. It is the same envelope the 404 and 500 handlers answer with, and a failure henri raises itself already carries its own — see [Error codes](/reference/errors/).

The React `Form` reads `data.errors` of a `422` and shows each message under its field, and the `RequestError` thrown by `fetch()` exposes `message`, `statusCode` and `data`.

## `res.resource(record, options)` and `res.collection(records, options)`

The JSON answers of an API: the public fields of a record (or a page of records under `_embedded`) with HAL `_links` built from the route helpers and filtered by the user's roles, `application/hal+json` when asked for, a `Location` header on `201`. `req.pagination()` reads `?page=` and `?per_page=` for the collection. See [JSON API](/guides/api/).

## `res.negotiate({ html, json })`

Runs `html` for browsers and `json` for API clients (`application/json`, `application/hal+json`, `application/vnd.henri.v1+json`), which is how a scaffolded controller serves both a page and a HAL answer from one action:

```js
return res.negotiate({
  html: () => res.render('/tasks/show', { data: { task } }),
  json: () => res.resource(task),
});
```

One of the two is required. With neither, express answers `406 Not Acceptable`, which blames the client's `Accept` header for a mistake in the controller — so henri refuses the call instead.

## `res.format(handlers)`

Express's content negotiation. henri's own answers put `json` before `html` so that a client accepting `*/*` (curl, `fetch()` with no `Accept`) gets JSON and only a browser gets HTML; do the same in your controllers when the order matters, and always give a `default`.

## What is on `henri`

Inside a controller (or anywhere else) the `henri` global exposes the loaded modules: `henri.config`, `henri.pen` (the logger), `henri.mail`, `henri.graphql`, `henri.user`, `henri.router`, `henri.server.app` (the Express app), `henri.model.stores`, `henri.validator` ([validator.js](https://github.com/validatorjs/validator.js)) and `henri.gql`. See the [API reference](/reference/api/).

`henri.addMiddleware(name, fn)` registers a function that receives the router before the routes are mounted, which is how you add your own Express middlewares. It must be called before the router starts, so from a model file or from a [module](/reference/under-the-hood/#writing-a-module) declaring `before: ['router']`, rather than a controller.
