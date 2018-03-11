const henri = require('./henri');
const Config = require('./config');
const Log = require('./log');
const Controllers = require('./controllers');
const Server = require('./server');
const Model = require('./model');

global['henri'] = henri;

Promise.all([
  henri.modules.add(new Config(henri)),
  henri.modules.add(new Log(henri)),
  henri.modules.add(new Controllers(henri)),
  henri.modules.add(new Server(henri)),
  henri.modules.add(new Model(henri)),
]);

async function init(prefix = '.', runlevel = 6) {
  await henri.modules.init(prefix, runlevel);
  return henri;
}

module.exports = init;
