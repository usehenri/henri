const fs = require('fs');
const path = require('path');
const { resolveFrom, resolvePackageJson, stack } = require('./utils');
const BaseModule = require('./base/module');
const graph = require('./base/graph');
const { fail } = require('./base/errors');

const debug = require('debug')('henri:modules');

/** Where an application keeps its own modules, next to app/models */
const MODULES_DIR = path.join('app', 'modules');

/** Where it lists the ones that live anywhere else */
const MODULES_FILE = path.join('config', 'modules.js');

/**
 * How a package says it ships a henri module, in its own package.json:
 * `"henri": { "module": "./module.js" }`. An application depending on it
 * gets the module in its boot, with nothing else to write.
 */
const PACKAGE_FIELD = 'henri';

/**
 * Modules handler
 *
 * Modules declare what they need (`needs`, `after`, `before`) or the level
 * they sit at (`runlevel`); the loader builds the graph, refuses to start
 * anything when it cannot be satisfied, and runs everything whose
 * dependencies are done, concurrently. `base/graph.js` holds the rules.
 *
 * @class Modules
 */
class Modules {
  /**
   * Creates an instance of Modules.
   * @param {Henri} henri Henri instance
   * @memberof Modules
   */
  constructor(henri) {
    this.henri = henri;
    this.modules = new Map();

    /** The modules, in registration order */
    this.registered = [];
    /** The graph of the last init() (see base/graph.js) */
    this.plan = null;
    /** What the boot did: order, timings and failures (see analyze()) */
    this.boot = null;
    /** The same, for the last reload */
    this.reloaded = null;
    this.initialized = false;

    /** The reload in flight, if any */
    this._reloading = null;
    /** The single reload queued behind the one in flight, if any */
    this._reloadQueued = null;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.add = this.add.bind(this);
    this.analyze = this.analyze.bind(this);
  }

  /**
   *  Adds a module to henri, not initialized yet
   *
   * @param {BaseModule} func Module instance to be added
   * @throws when the module is invalid or its name is taken
   * @returns {boolean} Result
   * @memberof Modules
   */
  add(func) {
    const { pen } = this.henri;

    if (this.henri.consoleOnly && func.consoleOnly) {
      return false;
    }

    const info = stack()[1];

    const obj = validate(func, info, pen);

    if (!obj) {
      return false;
    }

    obj.henri = this.henri;

    const existing =
      this.modules.get(obj.name) || typeof this.henri[obj.name] !== 'undefined';

    if (existing) {
      return crashOnDuplicateModule(existing, obj, info, pen);
    }

    this.modules.set(obj.name, {
      filename: info.getFileName(),
      func: info.getFunctionName(),
      line: info.getLineNumber(),
      time: Date.now(),
    });

    this.registered.push(obj);

    return true;
  }

  /**
   * Register the modules of this application, before the boot
   *
   * Three sources, in this order: the packages it depends on that ship a
   * module (`"henri": { "module": "./module.js" }` in their package.json),
   * its own `app/modules/*.js`, and whatever `config/modules.js` adds. They
   * are ordinary modules from there on: they pin themselves like henri's
   * own, and they take part in reload and shutdown.
   *
   * @async
   * @throws when a file, one of its entries or a module is invalid
   * @returns {Promise<Array<string>>} the names of the added modules
   * @memberof Modules
   */
  async discover() {
    const { pen } = this.henri;
    const added = [
      ...this.fromPackages(),
      ...this.fromDirectory(),
      ...(await this.fromFile()),
    ];

    added.length > 0 && pen.info('modules', 'application', added.join(', '));

    return added;
  }

  /**
   * The modules of the packages the application depends on
   *
   * A package ships one by pointing at it from its own package.json:
   * `"henri": { "module": "./module.js" }`. Depending on the package is all
   * an application has to do, which is what lets somebody publish one.
   *
   * @param {string} [cwd] the application directory
   * @throws when a package points at something that is not a module
   * @returns {Array<string>} the names of the added modules
   * @memberof Modules
   */
  fromPackages(cwd = this.henri.cwd()) {
    const added = [];
    let manifest;

    try {
      manifest = JSON.parse(
        fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
      );
    } catch (error) {
      debug('no readable package.json in %s', cwd);

      return added;
    }

    const names = [
      ...Object.keys(manifest.dependencies || {}),
      ...Object.keys(manifest.devDependencies || {}),
    ].sort();

    for (const name of names) {
      const file = packageModule(name, cwd);

      if (!file) {
        continue;
      }

      debug('%s ships a henri module: %s', name, file);
      added.push(...this.register(require(file), `the ${name} package`));
    }

    return added;
  }

  /**
   * The modules an application keeps in `app/modules`
   *
   * One module per file, the way `app/models` holds one model per file. A
   * module that did not name itself is named after its file.
   *
   * @param {string} [dir] the directory to read
   * @throws when a file does not hold a module
   * @returns {Array<string>} the names of the added modules
   * @memberof Modules
   */
  fromDirectory(dir = path.join(this.henri.cwd(), MODULES_DIR)) {
    const added = [];
    let files;

    try {
      files = fs
        .readdirSync(dir)
        .filter((file) => file.endsWith('.js') && !file.startsWith('.'))
        .sort();
    } catch (error) {
      debug('no %s in this application', MODULES_DIR);

      return added;
    }

    for (const file of files) {
      const full = path.join(dir, file);

      delete require.cache[require.resolve(full)];

      added.push(
        ...this.register(require(full), path.join(MODULES_DIR, file), () =>
          path.basename(file, '.js')
        )
      );
    }

    return added;
  }

  /**
   * The modules `config/modules.js` adds
   *
   * The file exports an array (or a function of the henri instance returning
   * one) whose entries are module instances, module classes, or the name of
   * a package exporting either. It is for what the two conventions above do
   * not cover: a module that lives elsewhere, or one loaded conditionally.
   *
   * @async
   * @param {string} [file] the file to read
   * @throws when the file, one of its entries or a module is invalid
   * @returns {Promise<Array<string>>} the names of the added modules
   * @memberof Modules
   */
  async fromFile(file = path.join(this.henri.cwd(), MODULES_FILE)) {
    const { pen } = this.henri;
    let exported;

    try {
      exported = require(file);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND' && error.message.includes(file)) {
        debug('no %s in this application', MODULES_FILE);

        return [];
      }

      throw pen.fatal(
        'modules',
        `unable to load ${MODULES_FILE}`,
        error.message,
        null,
        'HENRI_BOOT_MODULES_FILE_UNREADABLE'
      );
    }

    const entries =
      typeof exported === 'function' ? await exported(this.henri) : exported;

    if (!Array.isArray(entries)) {
      throw pen.fatal(
        'modules',
        `${MODULES_FILE} should export an array of modules`,
        `it exported ${typeof entries}`,
        null,
        'HENRI_BOOT_MODULES_FILE_INVALID'
      );
    }

    return this.register(entries, MODULES_FILE);
  }

  /**
   * Add what a file or a package exported: one module, or an array of them
   *
   * @param {any} exported what was required
   * @param {string} source where it came from, named in the errors
   * @param {?function} [fallbackName] the name of a module that has none
   * @throws when an entry is not a module
   * @returns {Array<string>} the names of the added modules
   * @memberof Modules
   */
  register(exported, source, fallbackName = null) {
    const added = [];

    for (const entry of [].concat(exported)) {
      const mod = this.instantiate(entry, source);

      if (fallbackName && (!mod.name || mod.name === 'unnamed')) {
        mod.name = fallbackName(mod);
      }

      this.add(mod) && added.push(mod.name);
    }

    return added;
  }

  /**
   * Turn what a file exported into a module instance
   *
   * @param {string|function|BaseModule} entry a name, a class or an instance
   * @param {string} [source] where it came from, named in the errors
   * @throws when the entry cannot become a module
   * @returns {BaseModule} the instance
   * @memberof Modules
   */
  instantiate(entry, source = MODULES_FILE) {
    const { pen } = this.henri;

    if (typeof entry === 'string') {
      let resolved;

      try {
        resolved = require(resolveFrom(entry, this.henri.cwd()));
      } catch (error) {
        throw pen.fatal(
          'modules',
          `${source} asks for '${entry}', which is not installed`,
          error.message,
          null,
          'HENRI_BOOT_MODULE_NOT_INSTALLED'
        );
      }

      return this.instantiate(
        (resolved && resolved.default) || resolved,
        source
      );
    }

    if (entry instanceof BaseModule) {
      return entry;
    }

    if (typeof entry === 'function') {
      const Klass = entry;

      return Klass.prototype instanceof BaseModule
        ? new Klass(this.henri)
        : entry(this.henri);
    }

    throw pen.fatal(
      'modules',
      `${source} holds an entry that is not a module`,
      `got ${entry === null ? 'null' : typeof entry}`,
      null,
      'HENRI_BOOT_INVALID_MODULE'
    );
  }

  /**
   * Initialize all the loaded modules
   *
   * The graph is built first: a missing dependency or a cycle fails here,
   * before anything starts. Every module then runs as soon as what it waits
   * on is done, so modules nothing separates run concurrently.
   *
   * @async
   * @throws the error of the first module that fails to initialize
   * @returns {Promise<boolean>} results
   * @memberof Modules
   */
  async init() {
    debug('starting init');

    const { pen } = this.henri;

    if (this.registered.length < 1) {
      throw pen.fatal(
        'modules',
        'init',
        'no modules loaded before init',
        null,
        'HENRI_BOOT_NO_MODULES'
      );
    }

    const plan = graph.build(this.registered, {
      ceiling: parseInt(this.henri.runlevel, 10),
    });

    if (plan.order.length < 1) {
      throw pen.fatal(
        'modules',
        'init',
        `no modules loaded before init (the boot stops at level ${plan.ceiling})`,
        null,
        'HENRI_BOOT_NO_MODULES'
      );
    }

    this.plan = plan;

    for (const name of plan.order) {
      this.henri[name] = plan.nodes.get(name).module;
    }

    const records = this.track(plan);

    this.boot = {
      ceiling: plan.ceiling,
      chart: plan.chart,
      duration: null,
      failed: null,
      records,
      skipped: plan.skipped,
      startedAt: new Date().toISOString(),
    };

    try {
      this.boot.duration = await this.run(plan, records, {
        label: 'loaded',
        method: 'init',
      });
    } catch (error) {
      this.report(error, records, pen);
      throw error;
    }

    pen.info('modules', 'loading', '...done!');

    this.initialized = true;

    return true;
  }

  /**
   * The record of every module of a plan, before anything runs
   *
   * @param {object} plan the plan built by base/graph.js
   * @returns {Map<string, object>} the records, by name
   * @memberof Modules
   */
  track(plan) {
    const records = new Map();

    for (const name of plan.order) {
      const node = plan.nodes.get(name);

      records.set(name, {
        blockedBy: null,
        blocks: [...node.blocks],
        duration: null,
        error: null,
        finishedAt: null,
        name,
        pin: node.pin,
        releaseDuration: null,
        runlevel: node.runlevel,
        startedAt: null,
        state: 'waiting',
        waitsOn: [...node.waitsOn].map((from) => ({
          name: from,
          why: node.why.get(from),
        })),
      });
    }

    return records;
  }

  /**
   * Walk the graph, running one method of every module it holds
   *
   * A module starts as soon as the ones it waits on are done. The first
   * rejection stops the walk: what it blocked never starts, which is what
   * the diagnostics report.
   *
   * @async
   * @param {object} plan the plan built by base/graph.js
   * @param {Map<string, object>} records the records to fill
   * @param {object} options what to run
   * @param {string} options.method `init` or `reload`
   * @param {string} options.label how the log calls it (`loaded`)
   * @param {Array<string>} [options.only] the modules to run, all of them by default
   * @throws the error of the first module that fails
   * @returns {Promise<number>} how long the walk took, in milliseconds
   * @memberof Modules
   */
  async run(plan, records, { label, method, only = plan.order }) {
    const { pen } = this.henri;
    const started = performance.now();
    const wanted = new Set(only);
    const inFlight = new Map();
    const size = wanted.size;
    let count = 0;

    /**
     * Run one module once its dependencies are done
     *
     * @param {string} name the module name
     * @returns {Promise<void>} resolves when it (and its deps) are done
     */
    const walk = (name) => {
      if (inFlight.has(name)) {
        return inFlight.get(name);
      }

      const node = plan.nodes.get(name);
      const record = records.get(name);
      const promise = Promise.all([...node.waitsOn].map(walk)).then(
        async () => {
          record.blockedBy = latest(node.waitsOn, records);

          if (!wanted.has(name)) {
            return;
          }

          const func = node.module[method];
          let result;

          record.startedAt = performance.now() - started;
          record.state = 'running';

          try {
            result =
              typeof func === 'function' ? await func.call(node.module) : false;
          } catch (error) {
            record.finishedAt = performance.now() - started;
            record.state = 'failed';
            record.error = (error && error.message) || String(error);

            throw error;
          }

          record.finishedAt = performance.now() - started;
          record.duration = record.finishedAt - record.startedAt;
          record.state = 'done';

          count++;
          pen.info('modules', result || name, label, `${count}/${size}`);
        }
      );

      inFlight.set(name, promise);
      // The rejection travels through the dependents and out of run()
      promise.catch(() => {});

      return promise;
    };

    await Promise.all(only.map(walk));

    return performance.now() - started;
  }

  /**
   * Print what a failed boot managed to do
   *
   * @param {Error} error the error of the module that failed
   * @param {Map<string, object>} records the records of the boot
   * @param {Pen} pen the logger
   * @returns {void}
   * @memberof Modules
   */
  report(error, records, pen) {
    const of = (state) =>
      [...records.values()]
        .filter((record) => record.state === state)
        .map((record) => record.name);
    const failed = of('failed');
    const running = of('running');
    const never = of('waiting');

    this.boot && (this.boot.failed = failed[0] || null);

    pen.error(
      'modules',
      failed[0] || 'boot',
      'failed',
      (error && error.message) || error
    );

    running.length > 0 &&
      pen.error('modules', 'still running', running.join(', '));
    never.length > 0 && pen.error('modules', 'never started', never.join(', '));

    debug('boot failed', error);
  }

  /**
   * What the boot did: the systemd-analyze of henri
   *
   * @param {string} [name] one module, instead of all of them
   * @returns {?object} the analysis, null when henri never booted
   * @memberof Modules
   */
  analyze(name = null) {
    if (!this.boot) {
      return null;
    }

    return {
      ceiling: this.boot.ceiling,
      chart: this.boot.chart,
      criticalPath: this.criticalPath(this.boot.records),
      duration: round(this.boot.duration),
      failed: this.boot.failed,
      modules: chartOf(this.boot.records, name),
      ok: this.initialized,
      reload: this.reloadAnalysis(name),
      skipped: this.boot.skipped,
      startedAt: this.boot.startedAt,
    };
  }

  /**
   * What the last reload did, in the shape `analyze()` uses for the boot
   *
   * @param {?string} [name] one module, instead of all of them
   * @returns {?object} the analysis, null when nothing reloaded yet
   * @memberof Modules
   */
  reloadAnalysis(name = null) {
    if (!this.reloaded) {
      return null;
    }

    return {
      criticalPath: this.criticalPath(this.reloaded.records),
      duration: round(this.reloaded.duration),
      modules: chartOf(this.reloaded.records, name).filter(
        (module) =>
          module.state !== 'waiting' || module.releaseDuration !== null
      ),
      released: this.reloaded.released,
      startedAt: this.reloaded.startedAt,
    };
  }

  /**
   * The chain that decided how long a walk took
   * Walks back from the module that finished last through whatever each one
   * was waiting on the longest.
   *
   * @param {Map<string, object>} records the records of the walk
   * @returns {Array<object>} the modules of the path, first started first
   * @memberof Modules
   */
  criticalPath(records) {
    if (!records) {
      return [];
    }

    const done = [...records.values()].filter(
      (record) => record.finishedAt !== null
    );

    if (done.length < 1) {
      return [];
    }

    const path = [];
    let current = done.reduce((last, record) =>
      record.finishedAt > last.finishedAt ? record : last
    );

    while (current) {
      path.unshift({
        duration: round(current.duration),
        name: current.name,
        startedAt: round(current.startedAt),
      });
      current = current.blockedBy ? records.get(current.blockedBy) : null;
    }

    return path;
  }

  /**
   * Reloads all the modules
   * Reloads are serialized: a call while one is in flight queues exactly one
   * more run (every caller in the meantime gets that same run).
   *
   * @async
   * @throws the error of the first module that fails to reload
   * @returns {Promise<boolean>} reload status
   * @memberof Modules
   */
  reload() {
    const { pen } = this.henri;

    if (!this.initialized) {
      pen.warn('modules', 'cannot reload when not initialized');

      return Promise.resolve(false);
    }

    if (this._reloading) {
      if (!this._reloadQueued) {
        debug('reload already in flight, queueing one more');

        const runNext = () => {
          this._reloadQueued = null;

          return this.reload();
        };

        this._reloadQueued = this._reloading.then(runNext, runNext);
      }

      return this._reloadQueued;
    }

    this._reloading = this._reload().finally(() => {
      this._reloading = null;
    });

    return this._reloading;
  }

  /**
   * The reload itself, in two phases over the same graph
   *
   * A reload is not a shutdown followed by a boot: modules re-initialize in
   * place, forward, and tear down whatever they hold inside their own
   * `reload()`. What that leaves out is a module holding something another
   * one is about to replace, so the graph is walked backwards first and
   * every module implementing `release()` is asked to let go: when it runs,
   * nothing has rebuilt yet. Then the reloadable modules run `reload()`
   * forwards, exactly like the boot. A module that implements neither sees
   * no difference.
   *
   * @private
   * @async
   * @throws the error of the first module that fails to release or reload
   * @returns {Promise<boolean>} reload status
   * @memberof Modules
   */
  async _reload() {
    this.evictCache();

    const records = this.track(this.plan);
    const started = performance.now();

    this.reloaded = {
      duration: null,
      records,
      released: [],
      startedAt: new Date().toISOString(),
    };

    try {
      this.reloaded.released = await this.release(records);

      const reloadable = this.plan.order.filter((name) => {
        const mod = this.plan.nodes.get(name).module;

        return mod.reloadable && typeof mod.reload === 'function';
      });

      await this.run(this.plan, records, {
        label: 'reloaded',
        method: 'reload',
        only: reloadable,
      });
    } finally {
      this.reloaded.duration = performance.now() - started;
    }

    return true;
  }

  /**
   * Ask every module holding something to let go, before anything rebuilds
   *
   * The graph backwards, the way a shutdown goes, so a module lets go
   * before the modules it depends on are rebuilt under it. `release()` is
   * optional and called on every module that has one, reloadable or not: a
   * module that does not reload can still hold a connection the model
   * module is about to replace.
   *
   * @async
   * @param {Map<string, object>} records the records of this reload
   * @throws the error of the first module that fails to release
   * @returns {Promise<Array<string>>} the modules that released, in order
   * @memberof Modules
   */
  async release(records) {
    const { pen } = this.henri;
    const released = [];

    for (const mod of this.stopOrder) {
      if (typeof mod.release !== 'function') {
        continue;
      }

      const record = records.get(mod.name);
      const started = performance.now();

      await mod.release();

      record && (record.releaseDuration = performance.now() - started);
      released.push(mod.name);
      pen.info('modules', mod.name, 'released');
    }

    return released;
  }

  /**
   * Remove the application files from the require cache
   * Only files under henri.cwd() and outside node_modules are evicted, so
   * dependencies (mongoose, sequelize, apollo...) keep a single instance.
   *
   * @param {object} [cache=require.cache] the cache to evict from
   * @returns {number} the number of evicted entries
   * @memberof Modules
   */
  evictCache(cache = require.cache) {
    const root = `${path.resolve(this.henri.cwd())}${path.sep}`;
    const skip = `${path.sep}node_modules${path.sep}`;
    let evicted = 0;

    for (const id of Object.keys(cache)) {
      if (id.startsWith(root) && !id.includes(skip)) {
        delete cache[id];
        evicted++;
      }
    }

    debug('evicted %d entries from the require cache', evicted);

    return evicted;
  }

  /**
   * The order modules are stopped in: the graph, backwards
   *
   * @returns {Array<BaseModule>} the modules, last started first
   * @memberof Modules
   */
  get stopOrder() {
    if (!this.plan) {
      return [];
    }

    return this.plan.order
      .map((name) => this.plan.nodes.get(name).module)
      .reverse();
  }

  /**
   * Stops the modules
   * Every module is stopped, even when one of them fails; the failures are
   * returned so the caller can decide what to do.
   *
   * @async
   * @returns {Promise<Array<Error>>} the errors, empty when everything stopped
   * @memberof Modules
   */
  async stop() {
    const { pen } = this.henri;
    const errors = [];

    for (const mod of this.stopOrder) {
      if (typeof mod.stop !== 'function') {
        continue;
      }

      try {
        if (await mod.stop()) {
          pen.info(`modules`, mod.name, `stopped`);
        }
      } catch (error) {
        pen.error('modules', mod.name, 'failed to stop', error);
        error.module = mod.name;
        errors.push(error);
      }
    }

    return errors;
  }
}

/**
 * The file of the module a package ships, if it ships one
 *
 * @param {string} name the package name
 * @param {string} cwd the application directory
 * @returns {?string} the absolute path of the module, null when there is none
 */
function packageModule(name, cwd) {
  let manifest;

  try {
    manifest = resolvePackageJson(name, cwd);
  } catch (error) {
    return null;
  }

  const declared = manifest && manifest[PACKAGE_FIELD];

  if (
    !declared ||
    typeof declared !== 'object' ||
    typeof declared.module !== 'string'
  ) {
    return null;
  }

  // From the package.json on disk, so the module file does not have to be
  // listed in the package's `exports` map to be reachable
  const root = path.dirname(resolveFrom(`${name}/package.json`, cwd));

  return path.resolve(root, declared.module);
}

/**
 * The dependency that finished last, which is the one that held a module up
 *
 * @param {Set<string>} waitsOn the names it waits on
 * @param {Map<string, object>} records the records of the boot
 * @returns {?string} the name, null when it waited on nothing
 */
function latest(waitsOn, records) {
  let found = null;

  for (const name of waitsOn) {
    const record = records.get(name);

    if (!record || record.finishedAt === null) {
      continue;
    }

    if (!found || record.finishedAt > records.get(found).finishedAt) {
      found = name;
    }
  }

  return found;
}

/**
 * The records of a walk, as the analysis reports them
 *
 * @param {Map<string, object>} records the records
 * @param {?string} name one module, or null for all of them
 * @returns {Array<object>} the modules, first started first
 */
function chartOf(records, name) {
  return [...records.values()]
    .filter((record) => !name || record.name === name)
    .map((record) => ({
      blockedBy: record.blockedBy,
      blocks: record.blocks,
      duration: round(record.duration),
      error: record.error || null,
      name: record.name,
      pin: record.pin,
      releaseDuration: round(record.releaseDuration),
      runlevel: record.runlevel,
      startedAt: round(record.startedAt),
      state: record.state,
      waitsOn: record.waitsOn,
    }))
    .sort(
      (one, two) =>
        (one.startedAt === null ? Infinity : one.startedAt) -
        (two.startedAt === null ? Infinity : two.startedAt)
    );
}

/**
 * Milliseconds, with a tenth of a millisecond of precision
 *
 * @param {?number} value the duration
 * @returns {?number} the rounded duration
 */
function round(value) {
  return typeof value === 'number' ? Math.round(value * 10) / 10 : null;
}

/**
 * Validate new modules
 *
 * @throws Error
 * @param {BaseModule} obj a module
 * @param {stack} info the stack information
 * @returns {BaseModule} the valid module
 */
function validate(obj, info) {
  const file = info.getFileName();
  const line = info.getLineNumber();
  const func = info.getFunctionName();
  const label = `${file}:${line} :: ${func}`;

  if (!(obj instanceof BaseModule)) {
    throw fail(
      'HENRI_BOOT_INVALID_MODULE',
      `modules => ${label} is not extending BaseModule`
    );
  }

  if (typeof obj.runlevel !== 'number') {
    throw fail(
      'HENRI_BOOT_INVALID_MODULE',
      `modules => ${label} runlevel is not defined`
    );
  }

  if (typeof obj.name !== 'string') {
    throw fail(
      'HENRI_BOOT_INVALID_MODULE',
      `modules => ${label} name is not a string`
    );
  }

  if (obj.runlevel < graph.MIN_RUNLEVEL || obj.runlevel > graph.MAX_RUNLEVEL) {
    throw fail(
      'HENRI_BOOT_RUNLEVEL_OUT_OF_RANGE',
      `modules => ${obj.name} runlevel is out of range: the levels go from ` +
        `${graph.MIN_RUNLEVEL} to ${graph.MAX_RUNLEVEL}`
    );
  }

  if (typeof obj.init !== 'function') {
    throw fail(
      'HENRI_BOOT_INVALID_MODULE',
      `modules => ${obj.name} init is not a function`
    );
  }

  for (const key of ['after', 'before', 'needs']) {
    if (
      typeof obj[key] !== 'undefined' &&
      typeof obj[key] !== 'string' &&
      !Array.isArray(obj[key])
    ) {
      throw fail(
        'HENRI_BOOT_INVALID_MODULE',
        `modules => ${obj.name} ${key} should be a module name or an array of them`
      );
    }
  }

  if (typeof obj.release !== 'undefined' && typeof obj.release !== 'function') {
    throw fail(
      'HENRI_BOOT_INVALID_MODULE',
      `modules => ${obj.name} release is not a function`
    );
  }

  if (obj.reloadable) {
    if (typeof obj.reload !== 'function') {
      throw fail(
        'HENRI_BOOT_INVALID_MODULE',
        `modules => ${obj.name} has no valid reload function. Is it reloadable?`
      );
    }
  }

  return obj;
}

/**
 * Crash the application on duplicate modules (overlapping)
 *
 * @throws always
 * @param {BaseModule} existing the existing module
 * @param {BaseModule} func the new module that collides
 * @param {stack} info the new module stack
 * @param {pen} pen the pen module (this.henri.pen)
 * @returns {void}
 */
function crashOnDuplicateModule(existing, func, info, pen) {
  pen.error(
    'modules',
    'duplicate',
    func.name,
    `original`,
    `${existing.filename}:${existing.line}`
  );
  pen.error(
    'modules',
    `duplicate`,
    func.name,
    'new',
    `${info.getFileName()}:${info.getLineNumber()}`
  );

  throw pen.fatal(
    'modules',
    'you have a module trying to load over another...',
    'a module name is how it is reached (henri.<name>): rename one of the two',
    null,
    'HENRI_BOOT_DUPLICATE_MODULE'
  );
}

module.exports = Modules;
