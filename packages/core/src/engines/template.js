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
    this.prepare = this.prepare.bind(this);

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
        const view = this.getFile(`./pages${route}`);

        if (!view) {
          return res.status(404).send('Not Found');
        }

        try {
          const result = view(opts.data || {});

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
  async prepare() {
    if (this.instance) {
      return new Promise(resolve => resolve());
    }
  }

  /**
   * Add catchall route to render directly from the folder
   *
   * @param {Express.Router} router A router to register the catchall
   * @returns {void}
   * @memberof TemplateEngine
   */
  fallback(router) {
    router.use(
      this.henri.server.express.static(
        path.join(this.henri.cwd(), 'app/views/public')
      )
    );
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
        '**/*.{hbs,html,htm}',
        { cwd: path.join(this.henri.cwd(), './app/views/partials') },
        async (err, files) => {
          if (err) {
            return reject(err);
          }
          this.partials.map(view => this.hbs.unregisterPartial(view));

          this.partials = [];
          await Promise.all(
            files.map(async view => {
              const fileName = view.replace(path.extname(view), '');
              const data = this.getFile(`./partials/${fileName}`);

              this.hbs.registerPartial(fileName, data);
              this.partials.push(fileName);
              Promise.resolve();
            })
          );
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

    if (this.henri.isProduction && this.cache.has(route)) {
      return this.cache.get(route);
    }

    try {
      const files = glob.sync('**/*.{hbs,html,htm}', {
        cwd: path.join(this.henri.cwd(), './app/views'),
      });
      const match = files.filter(file => file.includes(route.slice(2)));

      if (match.length < 1) {
        throw new Error('not found');
      }

      const pathToFile = path.join(this.henri.cwd(), 'app/views/', match[0]);

      const data = fs.readFileSync(pathToFile);

      let compiled;

      try {
        compiled = this.hbs.compile(data.toString('utf8'));
      } catch (error) {
        return this.henri.pen.error('template', error);
      }

      if (this.henri.isProduction) {
        this.cache.set(route, compiled);
      }

      return compiled;
    } catch (error) {
      this.henri.pen.error('template', `404 - ${route} ${fullRoute}`);

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
