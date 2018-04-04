const BaseModule = require('./base/module');

const allowed = {
  react: 'react',
  inferno: 'react',
  preact: 'react',
  vue: 'vue',
  template: 'template',
};

class View extends BaseModule {
  constructor() {
    super();
    this.reloadable = false;
    this.runlevel = 3;
    this.name = 'view';
    this.henri = null;

    this.renderer = 'template';
    this.engine = null;

    this.init = this.init.bind(this);
  }

  init() {
    const { config, pen } = this.henri;

    this.renderer = config.has('renderer')
      ? config.get('renderer')
      : 'template';

    if (!allowed.hasOwnProperty(this.renderer)) {
      pen.fatal(
        'view',
        `Unable to load '${
          this.renderer
        }' renderer. See your configuration file...
      
      Valid entries are: ${Object.keys(allowed).join(' ')}
      `
      );
    }
    const Engine = require(`./engines/${allowed[this.renderer]}`);
    this.engine = new Engine(this.henri);

    return this.name;
  }
}

module.exports = View;
