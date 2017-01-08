# henri = Feathers + Next.js
[![NPM](https://nodei.co/npm/henri.svg?downloads=true&downloadRank=true)](https://nodei.co/npm/henri/)

[![Version tag](https://img.shields.io/badge/stable-0.3.1-brightgreen.svg?style=flat)](https://github.com/simplehub/henri)
[![bitHound Dependencies](https://www.bithound.io/github/simplehub/henri/badges/dependencies.svg)](https://www.bithound.io/github/simplehub/henri/master/dependencies/npm)

henri is a simple way to start using [Feathers](http://feathersjs.com/) and [Next.js](https://github.com/zeit/next.js)


## How to use

To install:

```bash
  npm install henri --save
```

## Full example

A fully fonctionnal application can be found here: [https://github.com/simplehub/henri-full-example](https://github.com/simplehub/henri-full-example)

## Basic setup

Create a default config in `config/default.json` containing Feathers configs:

```json
{
  "host": "localhost",
  "port": 3030,
  "nedb": "../data/",
  "next": "../client/",
  "auth": {
    "secret": "some-secret",
    "local": {}
  }
}

```

With the above config, your directory structure should look like this:

```
├── client/
│   ├── pages
│   │   ├── index.js
│   │   ├── a.js
│   │   ├── b.js
│   ├── static
│   │   ├── favicon.ico
│   │   ├── some.css
├── config/
│   ├── default.json
├── node_modules/
├── public/
├── src/
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
  return view.render(req, res, '/a');
});

// express routes
app.get('/hello', (req, res) => {
  return res.render('Hello, Henri!');
});

henri.run();
```

## Plans

 - Add a generator

## Thanks to the following and their contributors

  - [Feathers](http://feathersjs.com/)
  - [Next.js](https://github.com/zeit/next.js)

