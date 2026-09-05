---
title: Controllers
description: Express handlers under app/controllers, autoloaded and reloaded on save.
sidebar:
  order: 4
---

Add controllers under `app/controllers`. They are autoloaded, reloaded on save and referenced from routes as `file#action`.

A controller is a plain object of Express handlers. Models are globals, `henri` is a global, and `res.render()` hands data to the view.

```js
// app/controllers/user.js

module.exports = {
  info: async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(403).send("Sorry! You can't see that.");
    }

    if (await User.countDocuments({ email: 'felix@usehenri.io' })) {
      await User.updateOne(
        { email: 'felix@usehenri.io' },
        { password: 'blue' }
      );
      return res.send('user exists.');
    }

    return res.send('no such user');
  },

  create: async (req, res) => {
    await User.create({ email: 'felix@usehenri.io', password: 'moo' });
    res.redirect('/');
  },

  fetch: async (req, res) => {
    const users = await User.find();
    res.send(users);
  },

  postinfo: async (req, res) => {
    const data = req.isAuthenticated() ? await User.find() : {};
    res.render('/log', { data });
  },
};
```

## `res.render(route, options)`

`route` is the page to render (`/log` is `app/views/pages/log.js` for React, `app/views/pages/log.hbs` for Handlebars). `options` takes one of:

- `data`: an object passed to the page as its `data` prop or template context
- `graphql`: a query string; its result becomes `data` (see [GraphQL](/guides/graphql/))

The view also receives the logged-in `user` (its public representation: `id`, `email`, `roles` and the fields listed in `config.user.public`), the `paths` allowed for that user, the request `query` and the `csrf` token. If the client asked for `application/json`, the same object is sent as JSON instead of HTML.

## `req.permit(...fields)`

Never hand `req.body` to a model as is: a client could set `roles` or any other column. `req.permit()` returns a plain object holding only the fields you list, taken from the query string, the body and the path parameters (a path parameter wins over the body, the body over the query string); fields that were not sent are left out.

```js
create: async (req, res) => {
  const user = await User.create(req.permit('email', 'password', 'name'));

  res.status(201).json({ user: henri.user.publicUser(user) });
},
```

`henri.params(req).permit([...])` is the same helper for code that does not go through the middleware chain.

## What is on `henri`

Inside a controller (or anywhere else) the `henri` global exposes the loaded modules: `henri.config`, `henri.pen` (the logger: `info`, `warn`, `error`, `fatal`), `henri.mail`, `henri.graphql`, `henri.user`, `henri.router`, `henri.server.app` (the Express app) and `henri.validator` ([validator.js](https://github.com/validatorjs/validator.js)).

`henri.user` works the same on every database adapter: `findByEmail(email)` (trimmed and lowercased, returns the instance with its password hash), `findById(id)` (without the password) and `publicUser(user)` (what may be sent to a browser).

`henri.addMiddleware(name, fn)` registers a function that receives the router before the routes are mounted, which is how you add your own Express middlewares.
