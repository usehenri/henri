const fs = require('fs');
const os = require('os');
const path = require('path');

const Henri = require('../henri');
const BaseModule = require('../base/module');
const graph = require('../base/graph');

/**
 * A module built from a bag of properties, recording what it did
 */
class Mod extends BaseModule {
  constructor(opts) {
    super();
    Object.assign(this, opts);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A henri with modules that push their name into a log as they run
 *
 * @param {Array<object>} modules the module declarations
 * @param {number} [runlevel=6] the boot ceiling
 * @returns {object} `{ henri, log }`
 */
const build = (modules, runlevel = 6) => {
  const henri = new Henri({ runlevel });
  const log = [];

  for (const declaration of modules) {
    const { delay = 0, fails = null, ...rest } = declaration;

    henri.modules.add(
      new Mod({
        init: async () => {
          log.push(`init:${rest.name}`);
          delay && (await sleep(delay));

          if (fails) {
            throw fails;
          }

          return rest.name;
        },
        ...rest,
      })
    );
  }

  return { henri, log };
};

describe('the boot graph', () => {
  describe('ordering', () => {
    test('runs a module after what it needs, and the rest together', async () => {
      const { henri, log } = build([
        { name: 'alpha', needs: ['beta'], runlevel: 1 },
        { delay: 10, name: 'beta', runlevel: 1 },
        { name: 'gamma', runlevel: 1 },
      ]);

      await henri.modules.init();

      // Gamma neither needs nor is needed: it does not wait for beta
      expect(log).toEqual(['init:beta', 'init:gamma', 'init:alpha']);
      expect(henri.modules.plan.order).toEqual(['beta', 'gamma', 'alpha']);
    });

    test('accepts a single name where a list is expected', async () => {
      const { henri, log } = build([
        { name: 'alpha', needs: 'beta', runlevel: 1 },
        { delay: 5, name: 'beta', runlevel: 1 },
      ]);

      await henri.modules.init();

      expect(log).toEqual(['init:beta', 'init:alpha']);
    });

    test('before pins a module ahead of one that never heard of it', async () => {
      const { henri, log } = build([
        { name: 'late', needs: ['early'], runlevel: 1 },
        { name: 'early', runlevel: 1 },
        { before: ['late'], name: 'wedged', needs: ['early'], runlevel: 1 },
      ]);

      await henri.modules.init();

      expect(log).toEqual(['init:early', 'init:wedged', 'init:late']);
    });

    test('after is ordering only: an absent module is not a dependency', async () => {
      const { henri, log } = build([
        { after: ['nobody'], name: 'alone', runlevel: 1 },
      ]);

      await expect(henri.modules.init()).resolves.toBe(true);
      expect(log).toEqual(['init:alone']);
    });

    test('a numeric pin still lands between the levels around it', async () => {
      const { henri, log } = build([
        { name: 'low', needs: [], runlevel: 1 },
        { name: 'high', needs: ['low'], runlevel: 5 },
        // Says nothing but its level: it goes after low and before high
        { name: 'pinned', runlevel: 3 },
      ]);

      await henri.modules.init();

      expect(log).toEqual(['init:low', 'init:pinned', 'init:high']);
      expect(henri.modules.analyze('pinned').modules[0].pin).toBe('runlevel');
      expect(henri.modules.analyze('high').modules[0].pin).toBe('name');
    });

    test('two modules that named nothing keep their registration order', async () => {
      const { henri } = build([
        { name: 'second', runlevel: 6 },
        { name: 'first', runlevel: 4 },
      ]);

      await henri.modules.init();

      expect(henri.modules.plan.order).toEqual(['first', 'second']);
    });

    test('nothing left under the ceiling is a boot that cannot happen', async () => {
      const { henri } = build([{ name: 'high', runlevel: 5 }], 2);

      await expect(henri.modules.init()).rejects.toThrow(
        /no modules loaded before init \(the boot stops at level 2\)/
      );
    });

    test('the boot ceiling leaves the levels above it out', async () => {
      const { henri, log } = build(
        [
          { name: 'low', runlevel: 1 },
          { name: 'high', runlevel: 5 },
        ],
        2
      );

      await henri.modules.init();

      expect(log).toEqual(['init:low']);
      expect(henri.modules.analyze().skipped).toEqual([
        { name: 'high', runlevel: 5 },
      ]);
      expect(henri.high).toBeUndefined();
    });
  });

  describe('refusing to start', () => {
    test('names both modules when nobody provides a dependency', async () => {
      const { henri, log } = build([
        { name: 'jobs', needs: ['queue'], runlevel: 6 },
        { name: 'workers_of_the_world', runlevel: 1 },
      ]);

      await expect(henri.modules.init()).rejects.toThrow(
        /"jobs" needs "queue", which no module provides/
      );
      // Nothing ran: the graph is built before anything starts
      expect(log).toEqual([]);
      expect(henri.modules.initialized).toBe(false);
    });

    test('lists what is loaded and suggests the closest name', async () => {
      const { henri } = build([
        { name: 'jobs', needs: ['worker'], runlevel: 6 },
        { name: 'workers', runlevel: 1 },
      ]);

      await expect(henri.modules.init()).rejects.toThrow(
        /Loaded modules: jobs \(6\), workers \(1\)[\s\S]*Did you mean: workers\?/
      );
    });

    test('says so when the ceiling is what left the dependency out', async () => {
      const { henri } = build(
        [
          { name: 'early', needs: ['late'], runlevel: 1 },
          { name: 'late', runlevel: 5 },
        ],
        2
      );

      await expect(henri.modules.init()).rejects.toThrow(
        /"early" needs "late", which this boot leaves out: "late" sits at level 5 and the boot stops at level 2/
      );
    });

    test('names the modules of a cycle and what put it there', async () => {
      const { henri, log } = build([
        { name: 'one', needs: ['two'], runlevel: 6 },
        { name: 'two', needs: ['one'], runlevel: 6 },
      ]);

      await expect(henri.modules.init()).rejects.toThrow(
        /circular dependency: (one -> two -> one|two -> one -> two)/
      );
      await expect(henri.modules.init()).rejects.toThrow(/\(needs\)/);
      expect(log).toEqual([]);
    });

    test('a numeric pin cannot make a cycle with a named one', async () => {
      const { henri } = build([
        { name: 'model', runlevel: 3 },
        { name: 'router', needs: ['model'], runlevel: 5 },
        { name: 'middleware', runlevel: 4 },
      ]);

      await expect(henri.modules.init()).resolves.toBe(true);
      expect(henri.modules.plan.order).toEqual([
        'model',
        'middleware',
        'router',
      ]);
    });
  });

  describe('what a failed boot says', () => {
    test('reports the module that failed, and what never started', async () => {
      const boom = new Error('no default store');
      const { henri, log } = build([
        { name: 'config_like', runlevel: 1 },
        {
          fails: boom,
          name: 'model_like',
          needs: ['config_like'],
          runlevel: 3,
        },
        { name: 'router_like', needs: ['model_like'], runlevel: 5 },
      ]);

      await expect(henri.modules.init()).rejects.toBe(boom);

      const analysis = henri.modules.analyze();
      const state = (name) =>
        analysis.modules.find((module) => module.name === name).state;

      expect(analysis.ok).toBe(false);
      expect(analysis.failed).toBe('model_like');
      expect(state('config_like')).toBe('done');
      expect(state('model_like')).toBe('failed');
      expect(state('router_like')).toBe('waiting');
      expect(log).not.toContain('init:router_like');
    });
  });

  describe('analyze', () => {
    test('says where a module ended up and what it waited on', async () => {
      const { henri } = build([
        { delay: 5, name: 'store', runlevel: 1 },
        { after: ['store'], name: 'metrics', needs: ['store'], runlevel: 6 },
      ]);

      await henri.modules.init();

      const analysis = henri.analyze();
      const metrics = analysis.modules.find(
        (module) => module.name === 'metrics'
      );

      expect(analysis.ok).toBe(true);
      expect(analysis.ceiling).toBe(6);
      expect(metrics.waitsOn).toEqual([{ name: 'store', why: 'needs' }]);
      expect(metrics.blockedBy).toBe('store');
      expect(metrics.runlevel).toBe(6);
      expect(metrics.state).toBe('done');
      expect(typeof metrics.duration).toBe('number');
      expect(analysis.criticalPath.map((step) => step.name)).toEqual([
        'store',
        'metrics',
      ]);
      expect(analysis.chart[6].modules).toEqual(['metrics']);
      expect(analysis.chart[1].purpose).toBe(graph.LEVELS[1]);
    });

    test('answers null before the boot, and one module when asked', async () => {
      const { henri } = build([{ name: 'alone', runlevel: 1 }]);

      expect(henri.analyze()).toBeNull();

      await henri.modules.init();

      expect(henri.analyze('alone').modules).toHaveLength(1);
      expect(henri.analyze('nope').modules).toHaveLength(0);
      expect(henri.analyze().reload).toBeNull();
    });
  });

  describe('release and reload', () => {
    test('releases backwards before anything reloads, then reloads forwards', async () => {
      const log = [];
      const henri = new Henri({ runlevel: 6 });
      const mod = (name, opts = {}) =>
        new Mod({
          init: async () => name,
          name,
          release: async () => log.push(`release:${name}`),
          reload: async () => log.push(`reload:${name}`),
          reloadable: true,
          runlevel: 1,
          ...opts,
        });

      henri.modules.add(mod('store'));
      henri.modules.add(mod('cache', { needs: ['store'] }));

      await henri.modules.init();
      await expect(henri.reload()).resolves.toBe(true);

      expect(log).toEqual([
        'release:cache',
        'release:store',
        'reload:store',
        'reload:cache',
      ]);
    });

    test('release is offered to a module that does not reload', async () => {
      const log = [];
      const henri = new Henri({ runlevel: 6 });

      henri.modules.add(
        new Mod({ init: async () => 'store', name: 'store', runlevel: 1 })
      );
      henri.modules.add(
        new Mod({
          init: async () => 'holder',
          name: 'holder',
          needs: ['store'],
          release: async () => log.push('release:holder'),
          runlevel: 1,
        })
      );

      await henri.modules.init();
      await henri.reload();

      expect(log).toEqual(['release:holder']);
      expect(henri.analyze().reload.released).toEqual(['holder']);
    });

    test('a module with neither hook sees nothing new', async () => {
      const { henri } = build([{ name: 'quiet', runlevel: 1 }]);

      await henri.modules.init();

      await expect(henri.reload()).resolves.toBe(true);
      expect(henri.analyze().reload.released).toEqual([]);
    });

    test('a failing release fails the reload and names the module', async () => {
      const henri = new Henri({ runlevel: 6 });

      henri.modules.add(
        new Mod({
          init: async () => 'leaky',
          name: 'leaky',
          release: async () => {
            throw new Error('cannot let go');
          },
          runlevel: 1,
        })
      );

      await henri.modules.init();
      await expect(henri.reload()).rejects.toThrow('cannot let go');
    });

    test('the reload shows up in the analysis', async () => {
      const henri = new Henri({ runlevel: 6 });

      henri.modules.add(
        new Mod({
          init: async () => 'first',
          name: 'first',
          reload: async () => 'first',
          reloadable: true,
          runlevel: 1,
        })
      );
      henri.modules.add(
        new Mod({
          init: async () => 'second',
          name: 'second',
          needs: ['first'],
          reload: async () => 'second',
          reloadable: true,
          runlevel: 1,
        })
      );

      await henri.modules.init();
      await henri.reload();

      const { reload } = henri.analyze();

      expect(reload.modules.map((module) => module.name)).toEqual([
        'first',
        'second',
      ]);
      expect(typeof reload.duration).toBe('number');
      expect(reload.criticalPath.map((step) => step.name)).toEqual([
        'first',
        'second',
      ]);
      // The boot analysis is not overwritten by a reload
      expect(henri.analyze().modules).toHaveLength(2);
    });

    test('refuses a release that is not a function', () => {
      const henri = new Henri({ runlevel: 1 });

      expect(() =>
        henri.modules.add(
          new Mod({
            init: async () => 'bad',
            name: 'bad',
            release: 'soon',
            runlevel: 1,
          })
        )
      ).toThrow(/bad release is not a function/);
    });
  });

  describe('shutdown', () => {
    test('stops in the reverse of the graph, not of the levels', async () => {
      const order = [];
      const henri = new Henri({ runlevel: 6 });
      const mod = (name, opts = {}) =>
        new Mod({
          init: async () => name,
          name,
          runlevel: 1,
          stop: async () => {
            order.push(name);

            return name;
          },
          ...opts,
        });

      // Registered upside down on purpose: the graph decides, not the order
      henri.modules.add(mod('last', { needs: ['middle'] }));
      henri.modules.add(mod('middle', { needs: ['first'] }));
      henri.modules.add(mod('first'));

      await henri.modules.init();
      await expect(henri.stop()).resolves.toEqual([]);

      expect(order).toEqual(['last', 'middle', 'first']);
    });
  });

  describe('modules from outside core', () => {
    let dir;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-modules-'));
    });

    afterEach(() => fs.rmSync(dir, { force: true, recursive: true }));

    const base = JSON.stringify(require.resolve('../base/module'));

    /**
     * Write a config/modules.js and read it back through fromFile()
     *
     * @param {string} source the content of the file
     * @returns {object} `{ henri, file }`
     */
    const write = (source) => {
      const file = path.join(dir, `modules-${Math.random()}.js`);

      fs.writeFileSync(file, source);

      return { file, henri: new Henri({ runlevel: 6 }) };
    };

    /**
     * The source of a module file naming itself
     *
     * @param {string} [name] the name it takes, none when omitted
     * @param {string} [extra] more constructor lines
     * @returns {string} the file
     */
    const source = (name = null, extra = '') => `
      const BaseModule = require(${base});

      module.exports = class extends BaseModule {
        constructor() {
          super();
          ${name ? `this.name = '${name}';` : ''}
          ${extra}
        }
        async init() { return this.name; }
      };
    `;

    test('takes an instance, a class and a factory', async () => {
      const { file, henri } = write(`
        const BaseModule = require(${JSON.stringify(require.resolve('../base/module'))});

        class Instance extends BaseModule {
          constructor() {
            super();
            this.name = 'from_instance';
          }
          async init() { return this.name; }
        }

        class Klass extends BaseModule {
          constructor(henri) {
            super();
            this.name = 'from_class';
            this.given = Boolean(henri);
          }
          async init() { return this.name; }
        }

        module.exports = [
          new Instance(),
          Klass,
          (henri) => {
            const mod = new Instance();
            mod.name = 'from_factory';
            mod.given = Boolean(henri);
            return mod;
          },
        ];
      `);

      await expect(henri.modules.fromFile(file)).resolves.toEqual([
        'from_instance',
        'from_class',
        'from_factory',
      ]);

      await henri.modules.init();

      expect(henri.from_class.given).toBe(true);
      expect(henri.from_factory.given).toBe(true);
    });

    test('takes a function of henri returning the list', async () => {
      const { file, henri } = write(`
        const BaseModule = require(${JSON.stringify(require.resolve('../base/module'))});

        module.exports = (henri) => [
          Object.assign(new BaseModule(), {
            init: async () => 'seen',
            name: 'seen',
            runlevel: henri.runlevel,
          }),
        ];
      `);

      await expect(henri.modules.fromFile(file)).resolves.toEqual(['seen']);
    });

    test('does nothing when the application has no config/modules.js', async () => {
      const henri = new Henri({ runlevel: 6 });

      await expect(
        henri.modules.fromFile(path.join(dir, 'nothing.js'))
      ).resolves.toEqual([]);
    });

    test('refuses a file that does not export a list', async () => {
      const { file, henri } = write('module.exports = { not: "a list" };');

      await expect(henri.modules.fromFile(file)).rejects.toThrow(
        /should export an array of modules/
      );
    });

    test('refuses an entry that is not a module', async () => {
      const { file, henri } = write('module.exports = [42];');

      await expect(henri.modules.fromFile(file)).rejects.toThrow(
        /holds an entry that is not a module/
      );
    });

    test('says which package is missing', async () => {
      const { file, henri } = write(
        'module.exports = ["@usehenri/not-a-package"];'
      );

      await expect(henri.modules.fromFile(file)).rejects.toThrow(
        /asks for '@usehenri\/not-a-package', which is not installed/
      );
    });

    test('app/modules is scanned, one module per file', async () => {
      const app = path.join(dir, 'app', 'modules');
      const henri = new Henri({ runlevel: 6 });

      fs.mkdirSync(app, { recursive: true });
      fs.writeFileSync(path.join(app, 'audit.js'), source('audit'));
      // No name of its own: it takes the one of its file
      fs.writeFileSync(path.join(app, 'metrics.js'), source());
      fs.writeFileSync(path.join(app, '.keep.js'), source('hidden'));
      fs.writeFileSync(path.join(app, 'notes.md'), 'not a module');

      expect(henri.modules.fromDirectory(app)).toEqual(['audit', 'metrics']);

      await henri.modules.init();

      expect(henri.metrics.name).toBe('metrics');
      expect(henri.audit.runlevel).toBe(6);
    });

    test('app/modules is optional', () => {
      const henri = new Henri({ runlevel: 6 });

      expect(henri.modules.fromDirectory(path.join(dir, 'nowhere'))).toEqual(
        []
      );
    });

    test('refuses a file of app/modules that holds no module', () => {
      const app = path.join(dir, 'app', 'modules');
      const henri = new Henri({ runlevel: 6 });

      fs.mkdirSync(app, { recursive: true });
      fs.writeFileSync(path.join(app, 'oops.js'), 'module.exports = 42;');

      expect(() => henri.modules.fromDirectory(app)).toThrow(
        /app\/modules\/oops\.js holds an entry that is not a module/
      );
    });

    test('a package ships a module by declaring it in its package.json', async () => {
      const pkg = path.join(dir, 'node_modules', 'henri-audit-log');
      const henri = new Henri({ runlevel: 6 });

      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(
        path.join(pkg, 'package.json'),
        JSON.stringify({
          henri: { module: './module.js' },
          main: 'index.js',
          name: 'henri-audit-log',
          version: '1.0.0',
        })
      );
      fs.writeFileSync(path.join(pkg, 'module.js'), source('audit_log'));
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({
          dependencies: { 'henri-audit-log': '^1.0.0', lodash: '^4.0.0' },
          name: 'an-app',
        })
      );

      expect(henri.modules.fromPackages(dir)).toEqual(['audit_log']);

      await henri.modules.init();

      expect(henri.audit_log.name).toBe('audit_log');
    });

    test('a package that ships nothing is left alone', () => {
      const pkg = path.join(dir, 'node_modules', 'plain');
      const henri = new Henri({ runlevel: 6 });

      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(
        path.join(pkg, 'package.json'),
        // `henri` as a version marker, the way an application writes it
        JSON.stringify({ henri: '1.1.0', name: 'plain', version: '1.0.0' })
      );
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ dependencies: { plain: '^1.0.0' }, name: 'an-app' })
      );

      expect(henri.modules.fromPackages(dir)).toEqual([]);
    });

    test('an application without a package.json asks for nothing', () => {
      const henri = new Henri({ runlevel: 6 });

      expect(henri.modules.fromPackages(path.join(dir, 'nowhere'))).toEqual([]);
    });

    test('an outside module takes part in reload and shutdown', async () => {
      const log = [];
      const { file, henri } = write('module.exports = [];');

      // What config/modules.js would have returned
      henri.modules.add(
        new Mod({
          init: async () => 'metrics',
          name: 'metrics',
          release: async () => log.push('release'),
          reload: async () => log.push('reload'),
          reloadable: true,
          runlevel: 6,
          stop: async () => {
            log.push('stop');

            return 'metrics';
          },
        })
      );

      await henri.modules.fromFile(file);
      await henri.modules.init();
      await henri.reload();
      await henri.stop();

      expect(log).toEqual(['release', 'reload', 'stop']);
    });
  });
});
