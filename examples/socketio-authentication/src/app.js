'use strict';

const henri = require('../../../index');
const routes = require('./routes');
const services = require('./services');

const app = henri.init();

app.configure(services)
  .configure(routes);

henri.run();
