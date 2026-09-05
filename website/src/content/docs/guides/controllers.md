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

The view also receives the logged-in `user`, the `paths` allowed for that user and the request `query`. If the client asked for `application/json`, the same object is sent as JSON instead of HTML.

## What is on `henri`

Inside a controller (or anywhere else) the `henri` global exposes the loaded modules: `henri.config`, `henri.pen` (the logger: `info`, `warn`, `error`, `fatal`), `henri.mail`, `henri.graphql`, `henri.user`, `henri.router`, `henri.server.app` (the Express app) and `henri.validator` ([validator.js](https://github.com/validatorjs/validator.js)).

`henri.addMiddleware(name, fn)` registers a function that receives the router before the routes are mounted, which is how you add your own Express middlewares.
