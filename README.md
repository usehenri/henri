# henri = Feathers + Next.js
[![Version tag](https://img.shields.io/badge/stable-0.2.0-brightgreen.svg?style=flat)](https://github.com/simplehub/henri)
[![bitHound Dependencies](https://www.bithound.io/github/simplehub/henri/badges/dependencies.svg)](https://www.bithound.io/github/simplehub/henri/master/dependencies/npm)

henri is a simple way to start using [Feathers](http://feathersjs.com/) and [Next.js](https://github.com/zeit/next.js)


## How to use

To install:

```bash
  npm install henri --save
```

Create a default config in `config/default.json` containing Feathers configs:

```json
{
  "host": "localhost",
  "port": 3000,
  "public": "../public/",
  "nedb": "../data/",
  "next": "../client", // Next.js pages location
  "auth": {
    "token": {
      "secret": "very-unique-token" // See Feathers docs for more infos
    }
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

const {
  app, // Feathers (express) app
  view // Next.js server-side app
} = henri.init();

// You should register your service right here / add connectors

// Next.js
app.get('/', (req, res) => {
  return view.render(req, res, '/index');
});

app.get('/a', (req, res) => {
  return view.render(req, res, '/a');
});

app.get('/b', (req, res) => {
  return view.render(req, res, '/a');
});

// express routes
app.get('/hello', (req, res) => {
  return res.render('Hello, Henri!');
});

henri.run();
```

## Plans

 - Upgrade feathers-authentication to 1.0.0+
 - Add example folder
 - Add a generator
 - Add a configuration parser / validator


## Thanks to the following and their contributors

  - [Feathers](http://feathersjs.com/)
  - [Next.js](https://github.com/zeit/next.js)

