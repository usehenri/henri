const path = require('path');

const { app, controllers, log, next } = henri;

henri._globalRoutes = [];
const routes = require(path.resolve('./app/routes'));

function register(verb, route, controller, fn) {
  if (typeof fn === 'function') {
    app[verb](route, fn);
  }
  const name = `${verb} ${route}`;
  const entry = {};
  entry[
    name
  ] = `${controller}${typeof fn !== 'function' ? ' (unknown controller)' : ' (ok)'}`;
  henri._globalRoutes.push(entry);
}

for (const key in routes) {
  const controller = routes[key];
  const routeKey = key.split(' ');
  let verb = routeKey.length > 1 ? routeKey[0].toLowerCase() : 'get';
  let route = routeKey.length > 1 ? routeKey[1] : key;

  if (controllers.hasOwnProperty(controller)) {
    register(verb, route, controller, controllers[controller]);
    register(verb, `/_data${route}`, controller, controllers[controller]);
    log.info(`${key} => ${controller}: registered.`);
  } else {
    register(verb, route, controller);
    log.error(`${key} => ${controller}: unknown controller for route `);
  }
}

if (process.env.NODE_ENV !== 'production') {
  app.get('/_routes', (req, res) => res.json(henri._globalRoutes));
}
next.prepare().then(() => {
  const handle = next.getRequestHandler();
  henri.app.get('*', (req, res) => {
    return handle(req, res);
  });
  henri.start(global['_initialDelay'] || null);
});
