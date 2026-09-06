const path = require('path');

/**
 * Vue (Nuxt) engine
 * Experimental: written for Nuxt 2 and not exercised since 2020. It only
 * loads when `config.experimental.vue === true`.
 *
 * @class VueEngine
 */
class VueEngine {
  /**
   * Creates an instance of VueEngine.
   * @param {Henri} thisHenri The current instance of henri
   * @throws unless config.experimental.vue is true
   * @memberof VueEngine
   */
  constructor(thisHenri) {
    const { config, pen } = thisHenri;

    if (config.get('experimental.vue', true) !== true) {
      throw pen.fatal(
        'vue',
        'the vue renderer is experimental and disabled',
        'Enable it with "experimental": { "vue": true } in your configuration',
        null,
        'HENRI_VIEW_VUE_DISABLED'
      );
    }

    pen.warn(
      'vue',
      'the vue renderer is experimental (nuxt 2) and has not been exercised since 2020'
    );

    this.instance = null;
    this.henri = thisHenri;
    this.conf = {
      dev: !thisHenri.isProduction,
      srcDir: './app/views',
    };
    this.renderer = config.get('renderer').toLowerCase();
    this.Builder = null;

    try {
      let conf = require(
        path.resolve(thisHenri.cwd(), 'config', 'nuxt.config.js')
      );

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
   * @async
   * @returns {Promise<void>} resolves once nuxt is created
   * @throws when nuxt is not installed
   * @memberof VueEngine
   */
  async init() {
    await this.henri.utils.checkPackages(['nuxt'], this.henri);

    const { Nuxt, Builder } = require(
      this.henri.utils.resolveFrom('nuxt', this.henri.cwd())
    );

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
      if (this.henri.isProduction) {
        return res.status(500).send('Internal server error');
      }
      this.henri.pen.error('vue', error);

      return res.status(500).send(error);
    }
  }
}

module.exports = VueEngine;
