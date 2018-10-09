const path = require('path');

/**
 * Vue (Nuxt) engine
 *
 * @class VueEngine
 */
class VueEngine {
  /**
   * Creates an instance of VueEngine.
   * @param {Henri} thisHenri The current instance of henri
   * @memberof VueEngine
   */
  constructor(thisHenri) {
    this.instance = null;
    this.henri = thisHenri;
    this.conf = {
      dev: !thisHenri.isProduction,
      srcDir: './app/views',
    };
    this.renderer = thisHenri.config.get('renderer').toLowerCase();
    this.Builder = null;

    try {
      // eslint-disable-next-line
      let conf = require(path.resolve(
        thisHenri.cwd(),
        'config',
        'nuxt.config.js'
      ));

      delete conf.rootDir;
      this.conf = Object.assign(this.conf, conf);
    } catch (error) {
      this.henri.pen.warn('vue', 'no vue config file found');
    }

    this.init = this.init.bind(this);
    this.prepare = this.prepare.bind(this);
    this.fallback = this.fallback.bind(this);
    this.render = this.render.bind(this);
  }

  /**
   * The init method
   *
   * @returns {void}
   * @memberof VueEngine
   */
  init() {
    this.henri.utils.checkPackages(['nuxt']);
    // eslint-disable-next-line
    const { Nuxt, Builder } = require(path.resolve(
      this.henri.cwd(),
      'node_modules',
      'nuxt'
    ));

    this.instance = new Nuxt(this.conf);
    this.Builder = Builder;
  }

  /**
   * Called after init to prepare the server
   *
   * @returns {Nuxt.Builder} nuxt.js instance
   * @memberof VueEngine
   */
  prepare() {
    new this.Builder(this.instance).build();
  }

  /**
   * Add catchall route to render directly from the folder
   *
   * @param {Express.Router} router A router to register the catchall
   * @returns {void}
   * @memberof VueEngine
   */
  fallback(router) {
    router.use(this.instance.render);
  }

  /**
   * Used by res.render
   *
   * @param {Express.Request} req Request
   * @param {Express.Response} res Response
   * @param {String} route A string matching the location from ./app/views/pages
   * @param {Object} opts Data or any other options going to the view
   * @returns {Express.Response} An express response
   * @memberof VueEngine
   */
  async render(req, res, route, opts) {
    try {
      const { html, error, redirected } = await this.instance.renderRoute(
        route,
        {
          // TODO: help get the data out there..
          opts,
          req,
          res,
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
      this.henri.pen.error('vue', error);

      return res.status(500).send(error);
    }
  }
}

module.exports = VueEngine;
