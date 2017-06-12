const path = require('path');
const next = require(path.resolve(process.cwd(), 'node_modules', 'next'));
const url = require('url');
const conf = require('./conf');

const { app, log } = henri;

const dev = process.env.NODE_ENV !== 'production';

const reactView = next({
  dir: path.resolve('./app/views'),
  dev,
  conf,
});

henri.next = reactView;

log.info('view module loaded.');
