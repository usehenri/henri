---
title: Routes
description: config/routes.js, HTTP verbs, roles, crud, resources, scope and omit.
sidebar:
  order: 3
---

Routes are defined in `config/routes.js`. Any page in `app/views/pages` is also rendered when no route matches first.

A route is a key (a path, or an HTTP verb and a path) pointing to `controller#action`, or to an object with a `controller` and options (`roles`, `scope`, `omit`).

```js
// config/routes.js
module.exports = {
  '/test': 'user#info', // defaults to 'get /test'

  '/abc/:id': 'moo#iii', // the controller does not exist: see below

  '/user/find': 'user#fetch',

  'get /poo': 'user#postinfo',

  'post /poo': 'user#create',

  'get /secured': {
    controller: 'secure#index',
    roles: ['admin'],
  },

  'resources todo': {
    controller: 'todo',
  },

  'crud categories': {
    scope: 'api',
    controller: 'categories',
    omit: ['destroy'], // the DELETE route is not created
  },
};
```

Keys are `verb /path` with any Express verb (`get`, `post`, `put`, `patch`, `delete`, `options`, `head`, ...), or `resources`/`crud` followed by a name. When two keys expand to the same verb and path, the later one wins.

`henri routes` prints the expanded table (verb, path, controller, path helper and roles) without starting the server. While the server runs, `r` prints the loaded routes and `u` the ones whose controller is missing, and in development `GET /_routes` and `GET /_controllers` return the same as JSON, from the machine running the server only.

In development, a route pointing to a missing controller answers `501 Not Implemented` so you notice; in production it is skipped. Requests nothing claims get a `404`, errors thrown by a controller a `500`; both are content negotiated (JSON `{ statusCode, error, message }` for API clients, an HTML page for browsers, with the stack in development only).

## Roles

Give a route an array of roles and only authenticated users whose `roles` contain every one of them can reach it. Denied requests get a `401` (not logged in, `Authentication required`) or a `403` (missing role, with the required `roles` in `data`) as JSON; a browser asking for HTML is redirected to `config.user.loginPath`, `/login` by default. henri mounts `POST /login` but no login page: add one there (see [Users](/guides/users/#login-and-logout)).

A route with `roles` in an application without a user model logs a warning at boot and denies every request.

## CRUD

The `crud` keyword replaces the HTTP verb and creates the API routes for a resource:

```text
// 'crud happy': 'life'

GET    /happy      => life#index
POST   /happy      => life#create
PATCH  /happy/:id  => life#update
PUT    /happy/:id  => life#update
DELETE /happy/:id  => life#destroy
```

## Resources

The `resources` keyword adds the view routes to CRUD:

```text
// 'resources happy': 'life'

GET    /happy           => life#index
POST   /happy           => life#create
PATCH  /happy/:id       => life#update
PUT    /happy/:id       => life#update
DELETE /happy/:id       => life#destroy

GET    /happy/:id/edit  => life#edit
GET    /happy/new       => life#new
GET    /happy/:id       => life#show
```

`henri generate scaffold Post` writes the `resources posts` key and a controller with the seven actions; `henri generate crud Post` the `crud posts` key and the four JSON actions.

## Scope

Add `scope` to prefix the generated routes: `scope: 'api'` turns `/happy` into `/api/happy`.

## Omit (crud and resources only)

Add an `omit` array to skip some of the generated actions: `omit: ['destroy', 'edit']`.

## Named paths

Every loaded route gets a name, `<action>_<controller>_path` (`show_todo_path`, `index_categories_path`), mapping to `{ method, route, roles }`. Pages rendered with `res.render()` (and the JSON answer of the same URL) receive them in `paths`, filtered by the roles of the current user; a page served by the view engine's fallback, without a controller, only gets the routes that need no role. The React and Inertia helpers `pathFor()` and `getRoute()` build URLs from these names, so a renamed route does not break your links.
