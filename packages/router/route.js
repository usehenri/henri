const url = require('url');

class Route {
  constructor(key, opts) {
    this.verb = '';
    this.route = '';
    this.opts = typeof opts === 'string' ? { controller: opts } : opts;
    this.result = {};
    this.scope = this.opts.scope ? `/${this.opts.scope}/` : '/';
    this.parse(key, opts);
    this.process();
    return this.result;
  }

  parse(key, opts) {
    const routeKey = key.split(' ');
    const verb = routeKey.length > 1 ? routeKey[0].toLowerCase() : 'get';
    this.route = routeKey.length > 1 ? routeKey[1] : key;
    this.verb = !verbs.includes(verb) ? 'get' : verb;
    this.opts = Object.assign(this.opts, { route: this.route, verb });
  }

  process() {
    if (this.verb === 'resources' || this.verb === 'crud') {
      const route = trim(this.route, '/');
      this.buildResource(`get`, `${this.scope}${route}`, 'index');
      this.buildResource(`get`, `${this.scope}${route}/:id/edit`, 'edit');
      this.buildResource(`patch`, `${this.scope}${route}/:id`, 'update');
      this.buildResource(`put`, `${this.scope}${route}/:id`, 'update');
      this.buildResource(`delete`, `${this.scope}${route}/:id`, 'destroy');

      if (this.verb === 'resources') {
        this.buildResource(`get`, `${this.scope}${route}/new`, 'new');
        this.buildResource(`post`, `${this.scope}${route}`, 'create');
        this.buildResource(`get`, `${this.scope}${route}/:id`, 'show');
      }
    } else {
      this.buildResource(this.verb, this.route);
    }
  }

  buildResource(verb, key, method) {
    const rebuilt = url.resolve(key, '');
    this.result[`${verb} ${rebuilt}`] = this.buildOpts(verb, rebuilt, method);
  }

  buildOpts(verb, key, method = null) {
    const { opts } = this;
    return Object.assign({}, opts, {
      controller: method ? `${opts.controller}#${method}` : opts.controller,
      route: key,
      verb: verb,
    });
  }
}

const verbs = [
  'checkout',
  'copy',
  'delete',
  'get',
  'head',
  'lock',
  'merge',
  'mkactivity',
  'mkcol',
  'move',
  'm-search',
  'notify',
  'options',
  'patch',
  'post',
  'purge',
  'put',
  'report',
  'search',
  'subscribe',
  'trace',
  'unlock',
  'unsubscribe',
  'resources',
  'crud',
];

function trim(s, mask) {
  while (~mask.indexOf(s[0])) {
    s = s.slice(1);
  }
  while (~mask.indexOf(s[s.length - 1])) {
    s = s.slice(0, -1);
  }
  return s;
}

module.exports = Route;
