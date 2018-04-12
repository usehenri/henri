const path = require('path');
const fs = require('fs');
const glob = require('glob');
const hbs = require('handlebars');
const bounce = require('bounce');

/**
 * Handlebars engine
 *
 * @class TemplateEngine
 */
class TemplateEngine {
  /**
   * Creates an instance of TemplateEngine.
   * @param {Henri} henri The current instance of henri
   * @memberof TemplateEngine
   */
  constructor(henri) {
    this.instance = null;
    this.henri = henri;

    this.cache = new Map();
    this.hbs = hbs;
    this.partials = [];

    this.init = this.init.bind(this);
    this.fallback = this.fallback.bind(this);
    this.render = this.render.bind(this);
    this.getFile = this.getFile.bind(this);
    this.init();
  }

  /**
   * The init method
   *
   * @returns {boolean} success
   * @memberof TemplateEngine
   */
  async init() {
    const { pen } = this.henri;

    try {
      await this.registerPartials();
    } catch (error) {
      bounce.rethrow(error, 'system');
    }

    this.instance = {
      render: async (req, res, route, opts) => {
        route = route === '/' ? '/index' : route;
        const data = this.getFile(route);

        if (!data) {
          return res.status(404).send('Not Found');
        }

        let script;

        try {
          script = this.hbs.compile(data);
        } catch (error) {
          return pen.error('template', error);
        }

        try {
          const result = script(opts.data || {});

          res.send(result);
        } catch (error) {
          pen.error(
            'template',
            `An error occured while rendering ${route}`,
            error
          );
          error.stack = error.stack.split('\n');
          error.stack.splice(1, 3);
          error.stack = error.stack.join('\n');
          pen.error('template', error.stack);

          return res.status(500).send('Internal Server Error');
        }
      },
    };

    return true;
  }

  /**
   * Called after init to prepare the server
   *
   * @static
   * @async
   * @returns {Promise} Self resolving promise (for compatibility)
   * @memberof TemplateEngine
   */
  static async prepare() {
    return new Promise(resolve => resolve());
  }

  /**
   * Add catchall route to render directly from the folder
   *
   * @param {Express.Router} router A router to register the catchall
   * @returns {void}
   * @memberof TemplateEngine
   */
  fallback(router) {
    router.get('*', (req, res) => {
      return this.render(req, res, req.path, {});
    });
  }

  /**
   * Used by res.render
   *
   * @param {Express.Request} req Request
   * @param {Express.Response} res Response
   * @param {String} route A string matching the location from ./app/views/pages
   * @param {Object} opts Data or any other options going to the view
   * @returns {void}
   * @memberof TemplateEngine
   */
  render(req, res, route, opts) {
    this.instance.render(req, res, route, opts);
  }

  /**
   * Registers the partials in ./app/views/partials
   *
   * @returns {Promise<Array>} A promise
   * @memberof TemplateEngine
   */
  registerPartials() {
    return new Promise((resolve, reject) => {
      glob(
        '**/*.html',
        { cwd: path.join(this.henri.cwd(), './app/views/partials') },
        (err, files) => {
          if (err) {
            return reject(err);
          }
          this.partials.map(view => this.hbs.unregisterPartial(view));

          this.partials = [];

          files.map(view => {
            const fileName = view.replace('.html', '');
            const data = this.getFile(`../partials/${fileName}`);

            this.hbs.registerPartial(fileName, data);
            this.partials.push(fileName);
          });
          resolve(files);
        }
      );
    });
  }

  /**
   * Loads a file from the filesystem
   *
   * @param {string} route Path relative to the view folder
   * @returns {?string} The data or null
   * @memberof TemplateEngine
   */
  getFile(route) {
    const fullRoute = route.slice(-1) === '/' ? `${route}index` : route;
    const pathToFile = `${path.join(
      this.henri.cwd(),
      'app/views/pages',
      route
    )}.html`;

    if (this.henri.isProduction && this.cache.has(pathToFile)) {
      return this.cache.get(pathToFile);
    }

    try {
      const data = fs.readFileSync(pathToFile);

      if (this.henri.isProduction) {
        this.cache.set(pathToFile, data);
      }

      return data.toString('utf8');
    } catch (error) {
      // Maybe we should cache 404s also..
      this.henri.pen.error(
        'template',
        `404 - ${route} ${fullRoute} ${pathToFile}`
      );

      return null;
    }
  }

  /**
   * Triggered on reload
   *
   * @async
   * @returns {Promise} The partials promise
   * @memberof TemplateEngine
   */
  async reload() {
    await this.registerPartials();
  }
}

module.exports = TemplateEngine;
