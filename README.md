<p align="center"><img width="100" alt="" src="https://raw.githubusercontent.com/simplehub/henri/master/henri.png"></p>

# henri - a powerful api coupled with react ssr
[![NPM](https://nodei.co/npm/henri.svg?downloads=true&downloadRank=true)](https://nodei.co/npm/henri/)

[![npm version](https://img.shields.io/npm/v/henri.svg?style=flat-square)](https://www.npmjs.com/package/henri)
[![npm downloads](https://img.shields.io/npm/dm/henri.svg?style=flat-square)](https://www.npmjs.com/package/henri)
[![bitHound Dependencies](https://www.bithound.io/github/simplehub/henri/badges/dependencies.svg)](https://www.bithound.io/github/simplehub/henri/master/dependencies/npm)

henri is a simple way to start using [Feathers](http://feathersjs.com/) and [Next.js](https://github.com/zeit/next.js)

- [How to use](#how-to-use)
  - [Examples](#examples)
  - [Basic setup](#basic-setup)
- [Server example](#server)
- [Client helpers](#client)
  - [withClient](#withclient)
  - [withAuth](#withauth)
  - [withLock](#withlock)
  - [withData](#withdata)
- [Plans, plans!](#plans)

## How to use

To install:

```bash
  npm install henri --save
```

### Examples

Examples (outdated) can be found [here](https://github.com/simplehub/henri/examples/).

### Basic setup

Create a default config in `config/default.json` containing Feathers configs:

```json
{
  "host": "localhost",
  "port": 3030,
  "endpoint": "http://localhost:3000/",
  "nedb": "../data/",
  "next": "../src/client/",
  "auth": {
    "secret": "some-secret",
    "local": {},
    "cookie": {
      "enabled": true
    }
  }
}

```

With the above config, your directory structure should look like this:

```
├── config/
│   ├── default.json
├── node_modules/
├── src/
│   ├── client/
│   │   ├── pages
│   │   │   ├── index.js
│   │   │   ├── a.js
│   │   │   ├── b.js
│   │   ├── static
│   │   │   ├── favicon.ico
│   │   │   ├── some.css
│   ├── index.js
├── package.json
```

And finally, add this to your `src/index.js` and you're ready to go:

```js
const henri = require('henri');

// Feathers app (express-like)
const app = henri.init();

// The Next.js renderer
const view = app.view;
// You should register your service right here / add connectors

// Next.js
app.get('/', (req, res) => {
  return view.render(req, res, '/index');
});

app.get('/a', (req, res) => {
  return view.render(req, res, '/a');
});

app.get('/b', (req, res) => {
  // Allow from multiple origin (Access-Control-Allow-Origin=*)
  res.forceCORS = true;
  return app.view.render(req, res, '/a');
});

// normal express routes
app.get('/hello', (req, res) => {
  return res.render('Hello, Henri!');
});

henri.run();
```

## Server

Once you have required henri, we invoke `init()` to bootstrap and return an express-like instance:
```js
const app = henri.init();
```

Routes can be added directly or using `configure()`: 

```js
// src/index.js

const henri = require('henri');
const routes = require('./routes');

const app = henri.init();

app.configure(routes);

app.get('/hello', (req, res) => {
  return res.render('Hello, Henri!');
});

henri.run();

```

```js
// src/routes.js

module.exports = function () {
  const app = this;

  const view = app.view;

  app.get('/', (req, res) => {
    if (req.authenticated) {
      console.log('user is authenticated');
    }
    return view.render(req, res, '/');
  });
};

```

You can configure services, middlewares and hooks the same way you do with Feathers.

## Client

We provide 4 Higher-Order Components to help you interact with your backend and provide helper methods:

### `withClient`

`withClient` provides you the `client` props and `session` (on first server load)

```jsx
import React from 'react';

import { withClient } from 'henri/client';

class IndexPage extends React.Component {
  componentDidMount() {
    const { client } = this.props;
    const service = client.service('/message');
    service.find({}).then(msgs => {
      this.setState({ messages: msgs.data });
    });
  }
  render() {
    return (
      <App {...this.props}>
        <div>Hello!</div>
        <ul>
          {this.state.messages && this.state.messages.map((msg, i) => {
            <li key={i}>{msg.body}</li>
          })}
        </ul>
      </App>
    );
  }
}

export default withClient(IndexPage);

```

### `withAuth`

`withAuth` will use `withClient` and populate the `user` props and expose the following methods:

 -  `login({ email: 'hello@usehenri.io, password: 'bar' }).then...`
 -  `signup({ email: 'hello@usehenri.io, password: 'bar', other: 'fields' })`
 -  `logout(e, callback)`

`login` and `signup` return a promise:

```jsx
import React from 'react';

import { withAuth } from 'henri/client';

class LoginPage extends React.Component {
  constructor() {
    super();
    this.update = this.update.bind(this);
    this.login = this.login.bind(this);
    this.state = { email: '', password: '' };
  }
  update(ev) {
    this.setState({ [ev.target.name]: ev.target.value });
  }
  login(ev) {
    ev.preventDefault();
    const { login } = this.props;
    const { email, password } = this.state;

    login({email, password}).then(() => debug('woohoo')).catch(() => debug('oooh snap'));
  }
  render() {
    return (
      <App {...this.props}>
        <div>Hello!</div>
        <div>
          <form onSubmit={this.login}>
            <input type='text' placeHolder='email' onChange={(e) => this.update(e)} name='email' value={this.state.email} />
            <input type='password' placeHolder='password' onChange={(e) => this.update(e)} name='password' value={this.state.password} />
          </form>
        </div>
      </App>
    );
  }
}

export default withAuth(IndexPage);

```

### `withLock`

`withLock` takes two arguments: the component we need to secure and a `fallback component` or `route` location. `withLock` is wrapped by `withAuth()` (and `withClient()`)...

```jsx
import React from 'react';

import { withLock } from 'henri/client';

import Error401 from '../components/error401';

const secureComponent = (props) => <div>really secure. wohh</div>;

export default withLock(secureComponent, Error401);

// Or...

export default withLock(secureComponent, '/login');

```

### `withData`

`withData` also takes two arguments: the child component and a query or some data to return.

`withData` is **NOT** wrapped by `withAuth()` or `withClient()`...

It will use `getInitialProps` and `componentDidMount` to make sure you always have your data handy.
```jsx
import React from 'react';

import { withClient, withData } from 'henri/client';

class IndexPage extends React.Component {
  render() {
    return (
      <App {...this.props}>
        <div>Hello!</div>
        <ul>
          {this.props.data && this.props.data.map((msg, i) => {
            <li key={i}>{msg.body}</li>
          })}
        </ul>
      </App>
    );
  }
}

export default withClient(withData(IndexPage, (props) => {
  const { client } = this.props;
  const service = client.service('/message');

  return service.find({});
}));

```

## Plans

 - Fix `withData` so it works server-side
 - Add a `withRedux` helper
 - Add a generator (possibly?)
 - Report bugs!

## Contributing

 - Submit issues, pull requests, anything!

## Thanks to the following and their contributors

  - [Feathers](http://feathersjs.com/)
  - [Next.js](https://github.com/zeit/next.js)

## Author

  - Félix-Antoine Paradis ([@reel](https://github.com/reel))
