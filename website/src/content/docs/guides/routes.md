---
title: Routes
description: config/routes.js, HTTP verbs, roles, root, crud, resources, only and except, member and collection, namespaces and nested resources.
sidebar:
  order: 3
---

Routes are defined in `config/routes.js`. Any page in `app/views/pages` is also rendered when no route matches first.

A route is a key (a path, or an HTTP verb and a path) pointing to `controller#action`, or to an object with a `controller` and options (`roles`, `scope`, `only`, `except`, `member`, `collection`, `nested`).

```js
// config/routes.js
module.exports = {
  root: 'main#home', // GET /

  '/test': 'user#info', // defaults to 'get /test'

  '/abc/:id': 'moo#iii', // the controller does not exist: see below

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
    except: ['destroy'], // the DELETE route is not created
  },

  'namespace admin': {
    'resources users': { roles: ['admin'] }, // /admin/users -> admin/users
  },
};
```

Keys are `verb /path` with any Express verb (`get`, `post`, `put`, `patch`, `delete`, `options`, `head`, ...), or one of the keywords `root`, `resources`, `crud` and `namespace`. When two keys expand to the same verb and path, the later one wins.

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

The controller defaults to the name of the resource, so `'resources posts': {}` is `'resources posts': { controller: 'posts' }`.

## Root

`root` maps `GET /` to an action, like `'get /'` does:

```js
module.exports = {
  root: 'main#home', // or { controller: 'main#home', roles: ['member'] }
};
```

## Scope

Add `scope` to prefix the generated routes: `scope: 'api'` turns `/happy` into `/api/happy`.

## Only and except (crud and resources only)

`only` keeps the actions it lists, `except` drops them; both accept a string or an array, and the routes keep the order above.

```js
module.exports = {
  'resources posts': { only: ['index', 'show'] },
  'resources comments': { except: ['edit', 'new'] },
};
```

`omit` is the former name of `except` and still works. Prefer `except`: `omit` is deprecated and will be dropped in a future major.

## Member and collection routes

Actions outside the seven get a route with `member` (one record, under `/:id`) or `collection` (the whole resource):

```js
module.exports = {
  'resources posts': {
    collection: { 'get search': 'search' }, // GET /posts/search -> posts#search
    member: { 'post archive': 'archive' }, // POST /posts/:id/archive
  },
};
```

Both accept an array of keys (`member: ['post archive', 'preview']`, the action is named after the segment, `get` by default), or an object whose value is the action (`'archive'`), another `controller#action`, or an object of route options (`{ action: 'archive', roles: ['admin'] }`, which inherits the options of the resource). The path helper is the usual `<action>_<controller>_path`, here `search_posts_path` and `archive_posts_path`. Collection routes are registered before `/:id` so they are reachable.

Unlike the seven actions, these routes are not required to answer HAL (see [JSON API](/guides/api/)).

## Namespaces

`namespace <name>` holds a routes object; every route inside is prefixed with `/<name>` and every controller with `<name>/`, which is a sub-directory of `app/controllers`:

```js
module.exports = {
  'namespace admin': {
    'get /dashboard': 'dashboard#index', // GET /admin/dashboard -> admin/dashboard#index
    'resources users': { roles: ['admin'] }, // /admin/users -> admin/users
  },
};
```

Namespaces nest. Options are not inherited: each route inside declares its own `roles`.

## Nested resources

`nested` holds a routes object expanded under one record of the parent:

```js
module.exports = {
  'resources posts': {
    nested: {
      'resources comments': { only: ['index', 'create'] },
    },
  },
};
```

gives `GET` and `POST /posts/:post_id/comments` on the `comments` controller. The parameter is the singular of the parent followed by `_id`; `param: 'slug'` renames it. The nested controller is not prefixed by the parent, only by the namespace it is in.

## API options

Three more options tune the [JSON API](/guides/api/) per route: `version: 'v1'` refuses clients asking for another `application/vnd.henri.vN+json` version with a `406`, `rateLimit: { windowMs, max }` limits the route on its own (always enforced, even in development), and `idempotent: false` opts a mutating route out of the `Idempotency-Key` handling.

```js
module.exports = {
  'resources artworks': {
    controller: 'artworks',
    scope: 'api/v1',
    version: 'v1',
  },
  'post /reports': {
    controller: 'reports',
    action: 'create',
    rateLimit: { windowMs: 60000, max: 5 },
  },
};
```

## Named paths

Every loaded route gets a name, `<action>_<controller>_path` (`show_todo_path`, `index_categories_path`), mapping to `{ method, route, roles }`. The rule holds whatever the route came from, so a member route of `posts` is `archive_posts_path` and a controller in a sub-directory keeps its folder: `admin/users#index` is `index_admin/users_path`. Pages rendered with `res.render()` (and the JSON answer of the same URL) receive them in `paths`, filtered by the roles of the current user; a page served by the view engine's fallback, without a controller, only gets the routes that need no role. The React and Inertia helpers `pathFor()` and `getRoute()` build URLs from these names, so a renamed route does not break your links.
