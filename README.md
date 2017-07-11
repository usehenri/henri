
<a href="http://usehenri.io" target="_blank">
  <p align="center">
    <img width="100" alt="" src="https://raw.githubusercontent.com/simplehub/henri/master/henri.png">
  </p>
</a>

# henri - the versatile javascript framework
[![NPM](https://nodei.co/npm/henri.svg?downloads=true&downloadRank=true)](https://nodei.co/npm/henri/)

[![npm version](https://img.shields.io/npm/v/henri.svg?style=flat-square)](https://www.npmjs.com/package/henri)
[![npm downloads](https://img.shields.io/npm/dm/henri.svg?style=flat-square)](https://www.npmjs.com/package/henri)
[![Build Status](https://travis-ci.org/usehenri/henri.svg?branch=master)](https://travis-ci.org/usehenri/henri)
[![Coverage Status](https://coveralls.io/repos/github/usehenri/henri/badge.svg)](https://coveralls.io/github/usehenri/henri)

henri is an easy to learn rails-like, server-side rendered (react & vue) with powerful ORMs

- [How to use](#how-to-use)
- [Configuration](#configuration)
- [Models](#models)
  - [Disk](#disk)
  - [MongoDB](#mongodb)
  - [MariaDB/MySQL](#mysql)
  - [Postgresql](#postgresql)
- [Views](#views)
  - [React](#react)
    - [Inferno](#inferno)
    - [Preact](#preact)
  - [Vue.js](#vue)
  - [Template (template literal)](#template)
- [Controllers](#controllers)
- [Routes](#routes)
- [Plans, plans!](#plans)

## How to use

### To install:

```bash
  yarn global add henri

  # or

  npm install -g henri
```

### To create a new project:

```bash
  henri new <folder name>
```

The above command will create a directory structure similar to this:

```
├── app
│   ├── controllers
│   ├── helpers
│   ├── models
│   └── views
│       ├── assets
│       ├── components
│       ├── pages
│       ├── public
│       │   ├── css
│       │   ├── fonts
│       │   ├── img
│       │   ├── js
│       │   └── patterns
│       └── styles
├── config
│   ├── default.json
│   ├── production.json
│   └── webpack.js            <- Overload Next.js webpack settings
└── logs
├── package.json
```

If you have a rails background, this might look familiar.

One last step to start coding is:

```bash
  cd <folder name>
  henri server
```

And you're good to go!

## Configuration

The configuration is a json file located in the `config` directory. We use
the [config](https://github.com/lorenwest/node-config) package to load them.

You can have a `default.json`, `production.json`, etc.

```json
{
  "log": "main.log", 
  "stores": { 
    "default": {
      "adapter": "disk"
    },
    "sql01": {
      "adapter": "mysql",
      "user": "someuser",
      "password": "somepass",
      "host": "somedb01.dbland.com",
      "database": "thedb"
    },
    "mongo": {
      "adapter": "mongo",
      "url": "mongodb://user:pass@mongoserver.com:10914/henri-test"
    }
  },
  "secret": "25bb9ed0b0c44cc3549f1a09fc082a1aa3ec91fbd4ce9a090b",
  "renderer": "react"
}
```

## Models

You can easily add models under `app/models`.

They will be autoloaded and available throughout your application. 

You can have multiple adapters and you can have relations between models living
on different adapters, thanks to [waterline](https://github.com/balderdashy/waterline)

```js
// app/models/User.js

// Whenever you have a User model, it will be overloaded with the following:

// email: string
// password: string
// beforeCreate: encrypts the password
// beforeUpdate: encrypts the password

module.exports = {
  identity: 'user',
  store: 'sql01', // see the demo configuration up there
  schema: {
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    tasks: { collection: 'tasks' }
  }
};

```

```js
// app/models/Tasks.js

module.exports = {
  identity: 'tasks',
  store: 'default', // see the demo configuration up there
  schema: {
    name: { type: 'string', required: true },
    category: {
      type: 'string',
      validations: {
        isIn: ['urgent', 'high', 'medium', 'low']
      },
      defaultsTo: 'low'
    }
  }
};

```

### Disk

The disk adapter is using waterline (and NeDB) to provide disk-based storage.

This is not for production and you can easily port your models to other waterline-connected adapters.

```bash
  yarn add henri @usehenri/disk

  # or

  npm install @usehenri/disk --save
```

### MongoDB

The MongoDB adapter is using waterline to provide a MongoDB ODM.


```bash
  yarn add henri @usehenri/mongo

  # or

  npm install @usehenri/mongo --save
```

### MySQL

The MariaDB/MySQL adapter is using waterline to provide a MySQL ORM.


```bash
  yarn add henri @usehenri/mysql

  # or

  npm install @usehenri/mysql --save
```

### PostgreSQL

The PostgreSQL adapter is using waterline to provide a PostgreSQL ORM.


```bash
  yarn add henri @usehenri/postgresql

  # or

  npm install @usehenri/postgresql --save
```

## Views

You can use [React](#react), [Vue](#vue) and template literals as renderer. They are all server-side rendered and the first two options use webpack to push updates to the browser.

### React
We use [next.js](https://github.com/zeit/next.js) to render pages and inject
data from controllers. You can only add pages and if the defined routes don't
match, and next matches a route, it will be rendered. 

The data injected into the view can be refetched with the `/_data/` suffix.

Usage (config file):

```json
{
  "renderer": "react"
}

```

Example:
```jsx

// app/views/pages/log.js 

import React from 'react';
import Link from 'next/link';

export default (data) => (
  <div>
    <div>{data}</div>
    <Link href="/home"><a>Home</a></Link>
  </div>
);

```

You can also add webpack configuration in `config/webpack.js`:

```js
// If you want to have jQuery as a global...

module.exports = {
  webpack: async (config, { dev }, webpack) => {
    config.plugins.push(
      new webpack.ProvidePlugin({
        $: 'jquery',
        jQuery: 'jquery',
      })
    );
    return config;
  },
};

```

#### Inferno

You can use Inferno instead of React in production. In development, React will be used for hot re/loading.

Installation:

```bash
yarn add react react-dom next inferno inferno-compat inferno-server
```
Usage (config file):

```json
{
  "renderer": "inferno"
}

```

#### Preact

You can use Preact instead of React in production. In development, React will be used for hot re/loading.

Installation:

```bash
yarn add react react-dom next preact preact-compat
```
Usage (config file):

```json
{
  "renderer": "preact"
}

```

### Vue.js
We use [Nuxt.js](https://nuxtjs.org/) to render pages and inject
data from controllers. You can only add pages and if the defined routes don't
match, and nuxt matches a route, it will be rendered. 

The data injected into the view can be refetched with the `/_data/` suffix.

Usage (config file):

```json
{
  "renderer": "vue"
}

```

Example:
```vue

<template>
  <div>
    <h1>Welcome!</h1>
    <nuxt-link to="/about">About page</nuxt-link>
  </div>
</template>

```


### Template

The template literal renderer is a simple home-made addons that reads the html files relative to `app/views/pages` and processes it as a template literal in a Node VM and injects data.

The data injected into the view can be refetched with the `/_data/` suffix.

Usage (config file):

```json
{
  "renderer": "template"
}

```

Example:
```html

<html>

<head>
  <title>Hello!</title>
</head>

<body>

  <li>Some data: ${data.hello}</li>
</body>

</html>

```

## Controllers

You can easily add controllers under `app/controllers`.

They will be autoloaded and available throughout your application.

```js
// app/controllers/User.js

module.exports = {
  info: async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(403).send("Sorry! You can't see that.");
    }
    const { user } = henri;
    if (await User.count({ email: 'felix@usehenri.io' })) {
      await User.update({ email: 'felix@usehenri.io' }, { password: 'blue' });
      return res.send('user exists.');
    }
    try {
      await user.compare('moo', pass);
      res.send('logged in!');
    } catch (error) {
      res.send('not good');
    }
  },
  create: (req, res) => {
    await User.create({ email: 'felix@usehenri.io', password: 'moo' });
  },
  fetch: async (req, res) => {
    const users = await User.find();
    res.send(users);
  },
  postinfo: async (req, res) => {
    let data = req.isAuthenticated() ? await User.find() : {};
    res.render('/log', data);
  }
};
```

## Routes

Routes are defined in `app/routes.js`. Also, any pages in `app/views/pages` will
be rendered if no routes match before.

Routes are a simple object with a key standing as a route or an action verb
(used by express) and a route.

Each route define here will also have a `/_data/` route attached that will return
only the data injected into the view if you use `res.render`. 

As with the `/log` route above, fetching `/log` will give you a SSR React page and
calling `/_data/log` will return a json object containing the users.

```js
// app/routes.js

module.exports = {
  '/test': 'user#info', // default to 'get /test'
  '/abc/:id': 'moo#iii', // as this controller does not exists, route won't be loaded
  '/user/find': 'user#fetch', 
  'get /poo': 'user#postinfo',
  'post /poo': 'user#create'
};

```

## Plans

 - Add helpers integration
 - Add documentation!
 - Build a website
 - Add React HOC to handle data and refresh
 - Report bugs!

## Contributing

 - Submit issues, pull requests, anything!

## Thanks to the following and their contributors

  - [Next.js](https://github.com/zeit/next.js)
  - [Express](https://expressjs.com/)
  - [Waterline](https://github.com/balderdashy/waterline)

## Author

  - Félix-Antoine Paradis ([@reel](https://github.com/reel))
