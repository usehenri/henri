const path = require('path');
const fs = require('fs');
const glob = require('glob');

class TemplateEngine {
  constructor(henri) {
    this.instance = null;
    this.henri = henri;

    this.cache = new Map();
    this.hbs = require('handlebars');
    this.partials = [];

    this.init = this.init.bind(this);
    this.prepare = this.prepare.bind(this);
    this.fallback = this.fallback.bind(this);
    this.render = this.render.bind(this);
    this.getFile = this.getFile.bind(this);
    this.init();
  }

  async init() {
    const { pen } = this.henri;

    await this.registerPartials();

    this.instance = {
      render: async (req, res, route, opts) => {
        route = route === '/' ? '/index' : route;
        const data = this.getFile(route);

        if (!data) {
          return res.status(404).send('Not Found');
        }

        let script;
        try {
          // script = new vm.Script('`' + data.replace(/`/g, '\\`') + '`');
          script = this.hbs.compile(data);
        } catch (e) {
          return pen.error('template', e);
        }

        try {
          // const result = script.runInNewContext({ data: opts.data });
          const result = script(opts.data || {});
          res.send(result);
        } catch (e) {
          pen.error('template', `An error occured while rendering ${route}`, e);
          e.stack = e.stack.split('\n');
          e.stack.splice(1, 3);
          e.stack = e.stack.join('\n');
          pen.error('template', e.stack);
          return res.status(500).send('Internal Server Error');
        }
      },
    };
  }

  prepare() {
    return new Promise(resolve => resolve());
  }

  fallback(router) {
    router.get('*', (req, res) => {
      return this.render(req, res, req.path, {});
    });
  }

  render(req, res, route, opts) {
    this.instance.render(req, res, route, opts);
  }

  registerPartials() {
    return new Promise((resolve, reject) => {
      glob(
        '**/*.html',
        { cwd: path.join(this.henri.cwd(), './app/views/partials') },
        (err, files) => {
          if (err) {
            return reject(err);
          }
          this.partials.map(v => this.hbs.unregisterPartial(v));

          this.partials = [];

          files.map(v => {
            const fileName = v.replace('.html', '');
            const data = this.getFile('../partials/' + fileName);
            this.hbs.registerPartial(fileName, data);
            this.partials.push(fileName);
          });
          resolve(files);
        }
      );
    });
  }

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
    } catch (e) {
      // Maybe we should cache 404s also..
      this.henri.pen.error(
        'template',
        `404 - ${route} ${fullRoute} ${pathToFile}`
      );
      return null;
    }
  }

  async reload() {
    await this.registerPartials();
  }
}

module.exports = TemplateEngine;
