<a href="http://usehenri.io" target="_blank">
  <p align="center">
    <img width="100" alt="" src="https://raw.githubusercontent.com/simplehub/henri/master/henri.png">
  </p>
</a>

# henri - the versatile javascript framework

[![npm version](https://img.shields.io/npm/v/henri.svg?style=flat-square)](https://www.npmjs.com/package/henri)
[![npm downloads](https://img.shields.io/npm/dm/henri.svg?style=flat-square)](https://www.npmjs.com/package/henri)
[![Build Status](https://travis-ci.org/usehenri/henri.svg?branch=master)](https://travis-ci.org/usehenri/henri)
[![Coverage Status](https://coveralls.io/repos/github/usehenri/henri/badge.svg)](https://coveralls.io/github/usehenri/henri)
[![Join slack](http://slack.usehenri.io/badge.svg)](http://slack.usehenri.io/)

henri is an easy to learn rails-like, server-side rendered (react & vue) with powerful ORMs

- [How to use](#how-to-use)
- [Configuration](#configuration)
- [Models](#models)
  - [Disk](#disk)
  - [MongoDB](#mongodb)
  - [MySQL](#mysql)
  - [MSSQL](#mssql)
  - [PostgreSQL](#PostgreSQL)
- [GraphQL](#graphql)
- [Views](#views)
  - [React](#react)
    - [Inferno](#inferno)
    - [Preact](#preact)
  - [Vue.js](#vue)
  - [Handlebars](#handlebars)
  - [Fetching data again](#fetching-data-again)
- [Controllers](#controllers)
- [Routes](#routes)
  - [Roles](#roles)
  - [CRUD](#crud)
  - [Resources](#resources)
  - [Scope](#scope)
- [Mail](#mail)
- [Workers](#workers)
- [Under the hood](#under-the-hood)
- [Plans, plans!](#plans)

## How to use

### Install

```bash
  yarn global add henri

  # or

  npm install -g henri
```

### Create a new project

```bash
  henri new <folder name>
```

The above command will create a directory structure similar to this:

```shell
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

If you have a _Ruby on Rails_ background, this might look familiar.

One last step to start coding is:

```bash
  cd <folder name>
  henri server
```

And you're good to go!

## Configuration

The configuration is a json file located in the `config` directory.

henri will try to load the file matching your `NODE_ENV` and will fallback to `default`.

You can have a `default.json`, `production.json`, etc.

```json
{
  "stores": {
    "default": {
      "adapter": "mongoose",
      "url": "mongodb://user:pass@mongoserver.com:10914/henri-test"
    },
    "dev": {
      "adapter": "disk"
    }
  },
  "secret": "25bb9ed0b0c44cc3549f1a09fc082a1aa3ec91fbd4ce9a090b",
  "renderer": "react"
}
```

## Models

You can easily add models under `app/models`.

They will be autoloaded and available throughout your application (exposed globally).

We use [Mongoose](http://mongoosejs.com/) for MongoDB, [Sequelize](http://docs.sequelizejs.com/) for SQL adapters and [Waterline](https://github.com/balderdashy/waterline) for the disk adapter.

```js
// app/models/User.js

// Whenever you have a User model, it will be overloaded with the following:

// email: string
// password: string
// beforeCreate: encrypts the password
// beforeUpdate: encrypts the password

module.exports = {
  store: 'dev', // see the demo configuration up there
  schema: {
    firstName: { type: 'string' },
    lastName: String,
    tasks: {},
  },
};
```

```js
// app/models/Tasks.js

module.exports = {
  store: 'default', // see the demo configuration up there
  schema: {
    name: { type: 'string', required: true },
    category: {
      type: 'string',
      validations: {
        isIn: ['urgent', 'high', 'medium', 'low'],
      },
      defaultsTo: 'low',
    },
  },
};
```

### Disk

The disk adapter is using [Waterline](https://github.com/balderdashy/waterline) to provide disk-based storage.

This is not for production and you can easily port your models to other adapters.

```bash
  yarn add @usehenri/disk

  # or

  npm install @usehenri/disk --save
```

### MongoDB

The MongoDB adapter is using [Mongoose](http://mongoosejs.com/) to provide a MongoDB ODM.

```bash
  yarn add @usehenri/mongoose

  # or

  npm install @usehenri/mongoose --save
```

### MySQL

The MySQL adapter is using [Sequelize](http://docs.sequelizejs.com/) to provide a MySQL ORM.

```bash
  yarn add @usehenri/mysql

  # or

  npm install @usehenri/mysql --save
```

### MSSQL

The MSSQL adapter is using [Sequelize](http://docs.sequelizejs.com/) to provide a MSSQL ORM.

```bash
  yarn add @usehenri/mssql

  # or

  npm install @usehenri/mssql --save
```

### PostgreSQL

The PostgresQL adapter is also using [Sequelize](http://docs.sequelizejs.com/) to provide a PostgresQL ORM.

```bash
  yarn add @usehenri/postgresql

  # or

  npm install @usehenri/postgresql --save
```

## GraphQL

You can add a `graphql` key to your schema file and they will be automatically loaded, merged and available.

### Definition

```js
// app/models/Task.js

const types = require('@usehenri/mongoose/types');

module.exports = {
  schema: {
    description: { type: types.STRING, required: true },
    type: { type: types.ObjectId, ref: 'Type', required: true },
    location: { type: types.ObjectId, ref: 'Location', required: true },
    reference: { type: types.STRING, required: true },
    notes: { type: types.STRING },
    oos: { type: types.BOOLEAN, default: false },
  },
  options: {
    timestamps: true,
  },
  graphql: {
    types: `
      type Task {
        _id: ID!
        reference: String!
        description: String!
        location: Location
        type: Type
        notes: String!
        oos: Boolean
      }
      type Query {
        tasks: [Task]
        task(_id: ID!): Task
      }
    `,
    resolvers: {
      Query: {
        tasks: async () => {
          return Task.find()
            .populate('type location')
            .exec();
        },
        task: async (_, id) => await Task.findOne(id).populate('type'),
      },
    },
  },
};
```

### Query

You will be able to query this anywhere. Even as an argument to `res.render()`. See below:

```js
// app/controllers/tasks.js

// henri has a gql function which does nothing but help editors parse gql...!
const { gql } = henri;

module.exports = {
  index: async (req, res) => {
    return res.render('/tasks', {
      graphql: gql`
        {
          tasks {
            _id
            reference
            description
            type {
              _id
              name
              prefix
              counter
            }
            location {
              _id
              name
            }
          }
          locations {
            _id
            name
          }
        }
      `,
    });
  },
};
```

## Views

You can use [React](#react), [Vue](#vue) and [Handlebars](#handlebars) as renderer. They are all server-side rendered and the first two options use webpack to push updates to the browser.

### React

We use [next.js](https://github.com/zeit/next.js) to render pages and inject
data from controllers. You can only add pages and if the defined routes don't
match, and next matches a route, it will be rendered.

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

export default data => (
  <div>
    <div>{data}</div>
    <Link href="/home">
      <a>Home</a>
    </Link>
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
yarn add react react-dom inferno inferno-compat inferno-server
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
yarn add react react-dom preact preact-compat
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

### Handlebars

The handlebars options renders your `.html` or `.hbs` files under `app/views/pages`.

It will also load partials from `app/views/partials`

Usage (config file):

```json
{
  "renderer": "template"
}
```

Example:

```twig
<html>

<head>
  <title>Hello!</title>
</head>

<body>
  {{> somePartials }}
  <li>Some data: {{hello}}</li>
</body>

</html>
```

### Fetching data again

You can refetch data from any data-hydrated controller endpoint with GET using the `application/json` header.

## Controllers

You can easily add controllers under `app/controllers`.

They will be autoloaded and available throughout your application.

Controllers are auto-reloaded on save.

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

If you want to access the `res.render` data, you can make the call with
`application/json` header. Everything else will be rendered.

```js
// app/routes.js

module.exports = {
  '/test': 'user#info', // default to 'get /test'

  '/abc/:id': 'moo#iii', // as this controller does not exists, route won't be loaded

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
  },
};
```

### Roles

You can specify an array of roles which need to be matched to access the routes.

### CRUD

The `crud` keyword (instead of http verbs) will create routes in a predefined way:

```js
// 'crud happy': 'life'

GET /happy => life#index
POST /happy => life#create
PATCH /happy/:id => life#update
PUT /happy/:id => life#update
DELETE /happy/:id => life#destroy
```

### Resources

The `resources` keyword (instead of http verbs) add views target to CRUD, ending up with:

```js
// 'resources happy': 'life'

GET /happy => life#index
POST /happy => life#create
PATCH /happy/:id => life#update
PUT /happy/:id => life#update
DELETE /happy/:id => life#destroy

GET /happy/:id/edit => life#edit
GET /happy/new => life#new
GET /happy/:id => life#show
```

### Scope

You can add `scope` to your routes to prefix them with anything you want.

## Mail

We use [nodemailer](https://nodemailer.com) to provide email capabilities.

When running tests, we use nodemailer's ethereal fake-mail service.

### Config

```json
{
  "mail": {
    // ...Same as nodemailer's config
  }
}
```

### Send

We provide a wrapper around `nodemailer.SendMail`:

```js
await henri.mail.send({
  from: '"Henri Server" <foo@example.com>', // sender address
  to: 'bar@example.com, baz@example.com', // list of receivers
  subject: 'Hello ✔', // Subject line
  text: 'Hello world?', // plain text body
  html: '<b>Hello world?</b>' // html body
})
```

If you are using the test accounts, you will see a link to your email in the console.

You can access nodemailer's package directly from `henri.mail.nodemailer` and
transporter from `henri.mail.transporter`.

## Workers

You can add files under `app/workers` and they will be auto-loaded, watched and reloaded.

If they export a `start()` and a `stop()` method, they will be call when initializing and tearing down (reload also).

Example:

```js
let timer;

const start = h => {
  h.pen.info('worker started');
  timer = setInterval(
    () => h.pen.warn(`the argument is the henri object`),
    5000
  );
};

const stop = () => clearInterval(h);

module.exports = { start, stop };
```

## Under the hood

### Vision

_Bundle the best tools in a structured environment to provide a stable and fast-paced development experience._

### Modules

_We use a 7 levels boot system._

1.  All modules are scanned and put in a sequence with same-level modules

2.  We cycle from level 0 to 6, initializing all the same-level modules in a concurrent way

3.  If the module is reloadable, it will unwind and rewind in the same sequence on reloads

See the [Contributing](#contributing) section for more information

## Plans

- Add helpers integration
- Add documentation!
- Build a website
- Report bugs!

## Contributing

- Submit issues, pull requests, anything!

## Thanks to the following and their contributors

- [Next.js](https://github.com/zeit/next.js)
- [Express](https://expressjs.com/)

## Author

- Félix-Antoine Paradis ([@reel](https://github.com/reel))
