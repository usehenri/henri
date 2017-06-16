const path = require('path');

const url = require('url');

const viewFolder = path.resolve('./app/views');

const { app, log, config } = henri;

const renderer = config.has('renderer') ? config.get('renderer') : 'template';

const allowed = {
  react: 'react',
  inferno: 'react',
  preact: 'react',
  vue: 'vue',
  template: 'template',
};

if (!allowed.hasOwnProperty(renderer)) {
  console.log('');
  log.error(
    `Unable to load '${renderer}' renderer. See your configuration file...`
  );
  log.error('');
  log.error(`Valid entries are: ${Object.keys(allowed).join(' ')}`);
  console.log('');
  process.exit(-1);
}

henri.view = loader = require(`./${allowed[renderer]}`);

log.info('view module loaded.');
