---
title: Controllers
description: Express handlers under app/controllers, autoloaded and reloaded on save, with before hooks, implicit rendering and flash messages.
sidebar:
  order: 2
---

Controllers live in `app/controllers`. Every `.js` file there is loaded on boot, reloaded on save and referenced from `config/routes.js` as `file#action`; a file in a subdirectory is prefixed with it (`app/controllers/admin/users.js` is `admin/users#index`).

A controller is a plain object of Express handlers, `(req, res)` or `(req, res, next)`, sync or async, plus an optional `before` block. Models are globals, `henri` is a global, and `res.render()` hands data to the view.

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

A hook may also be given by name (`before: { show: 'loadTask' }`), which resolves to another export of the same controller. `before` is never routable: it is the one key of a controller that is not an action.

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

`route` is the page to render: `/tasks/show` is `app/views/pages/tasks/show.js` with the React renderer, `pages/tasks/show.jsx` with Inertia, `pages/tasks/show.hbs` with Handlebars. `options` takes one of:

- `data`: an object passed to the page as its `data` prop or template context
- `graphql`: a query string; its result becomes `data` (see [GraphQL](/guides/graphql/))

Besides `data`, the view engine receives `user` (the public user or `null`), `paths` (the named routes the user may call), `query` (`req.query`), `csrf` (the CSRF token), `localUrl` (the server url), `flash` (the [flash messages](#flash-messages)), `errors` (GraphQL errors, if any) and `graphql` (`{ endpoint, query }`). A React page gets all of them as props except `query` (use `router.query`); Inertia pages and Handlebars templates get `query` too. A client asking for `application/json` gets the whole object as JSON instead of HTML; this is what the React helpers use to refresh a page.

`res.hbs(route, options)` renders a Handlebars template whatever the configured renderer, with the same options.

## `req.permit(...fields)`

Never hand `req.body` to a model as is: a client could set `roles` or any other column. `req.permit()` returns a plain object holding only the fields you list, taken from the query string, the body and the path parameters (a path parameter wins over the body, the body over the query string). Fields that were not sent are left out, and `__proto__`, `constructor` and `prototype` are never copied.

```js
const data = req.permit('email', 'password', 'name');
const same = req.permit(['email', 'password', 'name']); // arrays are flattened
```

`henri.params(req).permit(...)` is the same helper for code outside the middleware chain, and `henri.params(req).all()` the merged parameters, for reading only.

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

## `res.format(handlers)`

Express's content negotiation. henri's own answers put `json` before `html` so that a client accepting `*/*` (curl, `fetch()` with no `Accept`) gets JSON and only a browser gets HTML; do the same in your controllers when the order matters, and always give a `default`.

## What is on `henri`

Inside a controller (or anywhere else) the `henri` global exposes the loaded modules: `henri.config`, `henri.pen` (the logger), `henri.mail`, `henri.graphql`, `henri.user`, `henri.router`, `henri.server.app` (the Express app), `henri.model.stores`, `henri.validator` ([validator.js](https://github.com/validatorjs/validator.js)) and `henri.gql`. See the [API reference](/reference/api/).

`henri.addMiddleware(name, fn)` registers a function that receives the router before the routes are mounted, which is how you add your own Express middlewares. It must be called before the router starts (runlevel 5), so from a model file or a custom module rather than a controller.
