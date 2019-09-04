const path = require('path');
const fs = require('fs');
const next = require('next');

let builder;

// This code has moved in NextJS 6.1.0
try {
  // eslint-disable-next-line global-require
  builder = require(path.resolve(require.resolve('next'), '../build')).default;
} catch (err) {
  // eslint-disable-next-line global-require
  builder = require(path.resolve(require.resolve('next'), '../../build'))
    .default;
}

const moduleAlias = require('module-alias');

class ReactEngine {
  constructor(thisHenri) {
    this.instance = null;
    this.henri = thisHenri;
    // eslint-disable-next-line global-require
    this.conf = thisHenri.isTest ? {} : require('./conf');
    this.renderer = thisHenri.config.get('renderer').toLowerCase();

    this.init = this.init.bind(this);
    this.build = this.build.bind(this);
    this.prepare = this.prepare.bind(this);
    this.fallback = this.fallback.bind(this);
    this.render = this.render.bind(this);
  }

  init() {
    const {
      utils: { checkPackages },
    } = this.henri;

    switch (this.renderer) {
      case 'react':
        checkPackages([
          'react@16.8',
          'react-dom',
          'sass-loader',
          'raw-loader',
          'cache-loader',
          'node-sass',
        ]);
        break;
      case 'preact':
        checkPackages([
          'react',
          'react-dom',
          'next',
          'preact',
          'preact-compat',
          'sass-loader',
          'raw-loader',
          'cache-loader',
          'node-sass',
        ]);
        break;
      case 'inferno':
        checkPackages([
          'react',
          'react-dom',
          'next',
          'inferno',
          'inferno-compat',
          'inferno-server',
          'sass-loader',
          'raw-loader',
          'cache-loader',
          'node-sass',
        ]);
        break;
      default:
        checkPackages([
          'react',
          'react-dom',
          'react-hot-loader',
          'sass-loader',
          'raw-loader',
          'cache-loader',
          'node-sass',
        ]);
        break;
    }

    if (this.henri.isProduction) {
      if (this.renderer === 'inferno') {
        moduleAlias.addAlias('react', 'inferno-compat');
        moduleAlias.addAlias('react-dom/server', 'inferno-server');
        moduleAlias.addAlias('react-dom', 'inferno-compat');
      }
      if (this.renderer === 'preact') {
        moduleAlias.addAlias('react', 'preact-compat');
        moduleAlias.addAlias('react-dom', 'preact-compat');
      }
    }
  }

  async build() {
    const { pen } = this.henri;

    try {
      pen.info('view', 'building next.js pages for production');

      await builder(path.resolve(this.henri.cwd(), './app/views'), this.conf);
    } catch (err) {
      pen.error('view', 'unable to generate a production build');
      pen.error('view', err);
    }
  }

  async prepare() {
    const { pen } = this.henri;
    const BID = path.resolve(this.henri.cwd(), './app/views/.next/BUILD_ID');

    if (this.henri.isProduction) {
      if (!fs.existsSync(BID) || process.env.FORCE_BUILD === 'true') {
        await this.build();

        if (process.env.CMD_BUILD === 'true') {
          const buildId = fs.readFileSync(BID);

          pen.info('react', `build ${buildId} successful`, 'exiting');
          process.exit(0);
        }
      } else {
        pen.info('view', 'reusing production build');
      }
    }

    const versions = {
      //eslint-disable-next-line global-require
      next: require(path.resolve(
        require.resolve('next'),
        '../../../package.json'
      )).version,
      //eslint-disable-next-line global-require
      react: require(path.resolve(require.resolve('react'), '../package.json'))
        .version,
    };

    pen.info(
      'view',
      'starting next.js instance...',
      `next.js = ${versions.next}`,
      `react = ${versions.react}`
    );

    this.instance = next({
      conf: this.conf,
      dev: !this.henri.isProduction,
      dir: path.resolve(this.henri.cwd(), './app/views'),
    });

    return this.instance.prepare();
  }

  fallback(router) {
    const handle = this.instance.getRequestHandler();

    router.get('*', (req, res) => {
      return handle(req, res);
    });
  }

  render(req, res, route, opts) {
    this.instance.render(req, res, route, opts);
  }
}

module.exports = ReactEngine;
