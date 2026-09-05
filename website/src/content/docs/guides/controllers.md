---
title: Controllers
description: Express handlers under app/controllers, autoloaded and reloaded on save.
sidebar:
  order: 2
---

Controllers live in `app/controllers`. Every `.js` file there is loaded on boot, reloaded on save and referenced from `config/routes.js` as `file#action`; a file in a subdirectory is prefixed with it (`app/controllers/admin/users.js` is `admin/users#index`).

A controller is a plain object of Express handlers, `(req, res)` or `(req, res, next)`, sync or async. Models are globals, `henri` is a global, and `res.render()` hands data to the view.

```js
// app/controllers/tasks.js
const FIELDS = ['name', 'category', 'done'];

module.exports = {
  index: async (req, res) => {
    res.render('/tasks', { data: { tasks: await Task.find() } });
  },

  show: async (req, res) => {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.boom.notFound(`Task ${req.params.id} not found`);
    }

    return res.render('/tasks/show', { data: { task } });
  },

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

    return res.format({
      html: () => res.redirect(`/tasks/${task.id}`),
      json: () => res.status(201).json({ task }),
      default: () => res.status(201).json({ task }),
    });
  },
};
```

This is the shape `henri generate scaffold` writes: `req.permit()` for the input, a `422` with one message per field when validation fails, a `404` when the record does not exist, and `res.format()` so the same action serves a browser (redirect) and an API client (JSON).

Errors thrown or rejected by a controller are logged and answered with a `500`; the message and stack are exposed in development only. Requests nothing claims get a `404`. Both are content negotiated: JSON for API clients (the `res.boom` shape below), an HTML page for browsers.

## `res.render(route, options)`

`route` is the page to render: `/tasks/show` is `app/views/pages/tasks/show.js` with the React renderer, `pages/tasks/show.jsx` with Inertia, `pages/tasks/show.hbs` with Handlebars. `options` takes one of:

- `data`: an object passed to the page as its `data` prop or template context
- `graphql`: a query string; its result becomes `data` (see [GraphQL](/guides/graphql/))

Besides `data`, the view engine receives `user` (the public user or `null`), `paths` (the named routes the user may call), `query` (`req.query`), `csrf` (the CSRF token), `localUrl` (the server url), `errors` (GraphQL errors, if any) and `graphql` (`{ endpoint, query }`). A React page gets all of them as props except `query` (use `router.query`); Inertia pages and Handlebars templates get `query` too. A client asking for `application/json` gets the whole object as JSON instead of HTML; this is what the React helpers use to refresh a page.

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
