const henri = require('./henri');
const Config = require('./config');
const Log = require('./log');
const Controllers = require('./controllers');

global['henri'] = henri;

henri.config = new Config();
henri.log = new Log();

henri.modules.add(new Controllers(henri));

henri.modules.init();
