# Currently looking at changing feathers.js to a homemade, expressjs, rails-like autoloading backend.

# Please, fill an issue if you have any input on this.

<a href="http://usehenri.io" target="_blank">
  <p align="center">
    <img width="100" alt="" src="https://raw.githubusercontent.com/simplehub/henri/master/henri.png">
  </p>
</a>

# henri - the versatile javascript framework
[![NPM](https://nodei.co/npm/henri.svg?downloads=true&downloadRank=true)](https://nodei.co/npm/henri/)

[![npm version](https://img.shields.io/npm/v/henri.svg?style=flat-square)](https://www.npmjs.com/package/henri)
[![npm downloads](https://img.shields.io/npm/dm/henri.svg?style=flat-square)](https://www.npmjs.com/package/henri)
[![bitHound Dependencies](https://www.bithound.io/github/simplehub/henri/badges/dependencies.svg)](https://www.bithound.io/github/simplehub/henri/master/dependencies/npm)

henri is an easy to learn rails-like, server-side rendered (react & vue) with powerful ORMs

- [How to use](#how-to-use)
- [Configuration](#configuration)
- [Models](#models)
  - MongoDB
  - MariaDB/MySQL
  - Postgresql
  - MSSQL
- [Views](#views)
  - [React](#react)
    - [Inferno](#inferno)
    - [Preact](#preact)
  - [Vue.js](#vue)
  - [Template (template literal)](#template)
- [Controllers](#controllers)
- [Routes](#routes)
>>>>>>> 8993dcb... docs(cli): adding some documentation
- [Plans, plans!](#plans)

## How to use

### To install:

```bash
  npm install henri --save
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
    }
  },
  "secret": "25bb9ed0b0c44cc3549f1a09fc082a1aa3ec91fbd4ce9a090b"
}
```

## Models

You can easily add models under `app/models`.

They will be autoloaded and available throughout your application. 

You can have multiple adapters and you can have relations between models living
on different adapters, thanks to [waterline](https://github.com/balderdashy/waterline)

Also, we support [mongoose](http://mongoosejs.com/) for MongoDB and [sequalize](http://docs.sequelizejs.com/) for SQLs

```js
// app/models/User.js

// Whenever you have a User model, it will be overloaded with the following:

// email: string
// password: string
// beforeCreate: encrypts the password
// beforeUpdate: encrypts the password

module.exports = {
  identity: 'user',
  datastore: 'sql01', // see the demo configuration up there
  attributes: {
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
  datastore: 'default', // see the demo configuration up there
  attributes: {
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

## Views

We use [next.js](https://github.com/zeit/next.js) to render pages and inject
data from controllers. You can only add pages and if the defined routes don't
match, and next matches a route, it will be rendered. 

The data injected into the view can be refetched with the `/_data/` suffix.

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

 - Add server reload
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
