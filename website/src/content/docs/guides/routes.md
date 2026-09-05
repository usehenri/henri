---
title: Routes
description: config/routes.js, HTTP verbs, roles, crud, resources, scope and omit.
sidebar:
  order: 5
---

Routes are defined in `config/routes.js`. Any page in `app/views/pages` is also rendered when no route matches first.

A route is a key (a path, or an HTTP verb and a path) pointing to `controller#action`, or to an object with a `controller` and options.

```js
// config/routes.js

module.exports = {
  '/test': 'user#info', // defaults to 'get /test'

  '/abc/:id': 'moo#iii', // the controller does not exist: the route is not loaded

  '/user/find': 'user#fetch',

  'get /poo': 'user#postinfo',

  'post /poo': 'user#create',

  'get /secured': {
    controller: 'secureController#index',
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

In development, routes pointing to a missing controller answer `501 Not Implemented` so you notice; in production they are skipped. `GET /_routes` and `GET /_controllers` list what is loaded (development only, and only from the machine running the server), and pressing `R` or `U` in the terminal prints the same.

Requests nothing claims get a `404`, and errors thrown (or rejected) by a controller are logged and answered with a `500`. Both are content-negotiated: JSON clients receive `{ statusCode, error, message }`, browsers a page (with the stack in development, only the status in production).

## Roles

Give a route an array of roles and only authenticated users whose `roles` contain every one of them can reach it. Everybody else is redirected to `/login`.

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

## Scope

Add `scope` to prefix the generated routes: `scope: 'api'` turns `/happy` into `/api/happy`.

## Omit (crud and resources only)

Add an `omit` array to skip some of the generated actions: `omit: ['destroy', 'edit']`.

## Named paths

Every loaded route gets a name, `<action>_<controller>_path` (`show_todo_path`, `index_categories_path`), that the views receive in `paths` filtered by the current user's roles. The React helpers `pathFor()` and `getRoute()` build URLs from these names, so a renamed route does not break your links.
