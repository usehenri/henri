const path = require('path');

const { app, controllers, log, next } = henri;

const routes = require(path.resolve('./app/routes'));

for (const key in routes) {
  const controller = routes[key];
  const routeKey = key.split(' ');
  let verb = routeKey.length > 1 ? routeKey[0].toLowerCase() : 'get';
  let route = routeKey.length > 1 ? routeKey[1] : key;

  if (controllers.hasOwnProperty(controller)) {
    app[verb](route, controllers[controller]);
    app[verb](`/_data${route}`, controllers[controller]);
    log.info(`${key} => ${controller}: registered.`);
  } else {
    log.error(`${key} => ${controller}: unknown controller for route `);
  }
}

next.prepare().then(() => {
  const handle = next.getRequestHandler();
  henri.app.get('*', (req, res) => {
    return handle(req, res);
  });
  henri.start(global['_initialDelay'] || null);
});
