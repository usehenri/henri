const config = require('config');

if (!global['henri']) {
  global['henri'] = {};
}

global['henri'].config = config;
