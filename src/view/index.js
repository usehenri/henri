const path = require('path');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';

console.log(path.resolve('./app/views'));
const reactView = next({
  dir: path.resolve('./app/views'),
  dev
});

if (!global['henri']) {
  global['henri'] = {};
}

global['henri'].next = reactView;
