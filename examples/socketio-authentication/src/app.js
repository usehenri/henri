'use strict';

const henri = require('../../../');
const routes = require('./routes');
const services = require('./services');

const app = henri.init();

app.configure(services)
  .configure(routes);

henri.run();
