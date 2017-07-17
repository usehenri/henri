const { log, config } = henri;

const renderer = config.has('renderer') ? config.get('renderer') : 'template';

const allowed = {
  react: 'react',
  inferno: 'react',
  preact: 'react',
  vue: 'vue',
  template: 'template',
};

if (!allowed.hasOwnProperty(renderer)) {
  log.fatalError(`
  Unable to load '${renderer}' renderer. See your configuration file...
  
  Valid entries are: ${Object.keys(allowed).join(' ')}
  `);
}

henri.view = require(`./${allowed[renderer]}`);

log.info('view module loaded.');
