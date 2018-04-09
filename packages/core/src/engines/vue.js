const path = require('path');

class VueEngine {
  constructor(henri) {
    this.instance = null;
    this.henri = henri;
    this.conf = {
      srcDir: './app/views',
      dev: !henri.isProduction,
    };
    this.renderer = henri.config.get('renderer').toLowerCase();
    this.Builder = null;

    try {
      let conf = require(path.resolve(henri.cwd(), 'config', 'nuxt.config.js'));
      delete conf.rootDir;
      this.conf = Object.assign(this.conf, conf);
    } catch (e) {}

    this.init = this.init.bind(this);
    this.prepare = this.prepare.bind(this);
    this.fallback = this.fallback.bind(this);
    this.render = this.render.bind(this);
  }

  init() {
    this.henri.utils.checkPackages(['nuxt']);
    const { Nuxt, Builder } = require(path.resolve(
      henri.cwd(),
      'node_modules',
      'nuxt'
    ));
    this.instance = new Nuxt(this.conf);
    this.Builder = Builder;
  }

  prepare() {
    new this.Builder(this.instance).build();
  }

  fallback(router) {
    router.use(this.instance.render);
  }

  async render(req, res, route, opts) {
    /* html, error, redirected */

    try {
      const { html, error, redirected } = await this.instance.renderRoute(
        route,
        {
          req,
          res,
          // TODO: help get the data out there..
          opts,
        }
      );

      if (error) {
        return res.status(error.statusCode || 500).send(html);
      }

      if (redirected) {
        return res.redirect(redirected.status, redirected.path);
      }

      return res.send(html);
    } catch (error) {
      if (henri.isProduction) {
        return res.status(500).send('Internal server error');
      }
      henri.pen.error('vue', error);
      return res.status(500).send(error);
    }
  }
}

module.exports = VueEngine;
