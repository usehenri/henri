const path = require('path');

const { EXIT_CODES } = require('../scripts/errors');
const { cleanup, henri, tmpdir } = require('./helpers');

// The same minimal drizzle/sqlite application db.spec.js seeds: it boots
// without a database server, and carries a module of its own in app/modules
const fixture = path.join(__dirname, 'fixtures', 'seed-app');

const code = (name) => EXIT_CODES.find((entry) => entry.name === name).code;

describe('henri analyze', () => {
  describe('the boot chart', () => {
    let analysis;

    beforeAll(() => {
      const { status, stdout, stderr } = henri(['analyze', '--json'], {
        cwd: fixture,
        timeout: 120000,
      });

      if (status !== 0) {
        throw new Error(`henri analyze failed (${status}): ${stderr}`);
      }

      analysis = JSON.parse(stdout);
    }, 120000);

    test('reports the order, the timings and the level chart', () => {
      const names = analysis.modules.map((module) => module.name);

      expect(analysis.ok).toBe(true);
      expect(analysis.ceiling).toBe(6);
      expect(typeof analysis.duration).toBe('number');
      expect(names[0]).toBe('config');
      expect(names).toContain('router');
      expect(names.indexOf('model')).toBeLessThan(names.indexOf('user'));
      expect(analysis.chart[0].modules).toEqual(['config']);
      expect(analysis.chart[3].modules).toEqual([
        'cache',
        'model',
        'policies',
        'view',
      ]);
    });

    test('says what every module waited on, and why', () => {
      const user = analysis.modules.find((module) => module.name === 'user');

      expect(user.waitsOn).toEqual(
        expect.arrayContaining([
          { name: 'model', why: 'needs' },
          { name: 'server', why: 'needs' },
        ])
      );
      expect(user.blockedBy).toBeTruthy();
      expect(user.pin).toBe('name');
      expect(user.state).toBe('done');
    });

    test('the critical path ends on the module that finished last', () => {
      const path = analysis.criticalPath.map((step) => step.name);

      expect(path.length).toBeGreaterThan(1);
      expect(path[0]).toBe('config');
      expect(analysis.modules.map((module) => module.name)).toEqual(
        expect.arrayContaining(path)
      );
    });

    test('a module of the application takes part, where it said it does', () => {
      const metrics = analysis.modules.find(
        (module) => module.name === 'metrics'
      );
      const names = analysis.modules.map((module) => module.name);

      // The app/modules/metrics.js of the fixture: it needs the express app,
      // and goes before the routes are mounted
      expect(metrics.runlevel).toBe(5);
      expect(metrics.waitsOn).toEqual(
        expect.arrayContaining([{ name: 'server', why: 'needs' }])
      );
      expect(metrics.blocks).toContain('router');
      expect(names.indexOf('metrics')).toBeLessThan(names.indexOf('router'));
    });
  });

  describe('a partial boot', () => {
    test('stops at the level asked for and says what it left out', () => {
      const { status, stdout } = henri(['analyze', '--level', '3', '--json'], {
        cwd: fixture,
        timeout: 120000,
      });
      const analysis = JSON.parse(stdout);

      expect(status).toBe(0);
      expect(analysis.ceiling).toBe(3);
      expect(analysis.modules.map((module) => module.name)).not.toContain(
        'router'
      );
      expect(analysis.skipped.map((entry) => entry.name)).toEqual(
        expect.arrayContaining(['router', 'user', 'workers', 'metrics'])
      );
    }, 120000);

    test('prints one module with its neighbours', () => {
      const { status, stdout } = henri(['analyze', 'model', '--level', '3'], {
        cwd: fixture,
        timeout: 120000,
      });

      expect(status).toBe(0);
      expect(stdout).toContain('model: level 3, pinned by name');
      expect(stdout).toContain('Waited on');
      // This application has no @usehenri/graphql, so no graphql module:
      // the model runs after it when it is there and needs the configuration
      expect(stdout).toContain('config (needs)');
      expect(stdout).not.toContain('graphql');
      expect(stdout).toContain('Waiting on it');
    }, 120000);

    test('says so when the module never took part', () => {
      const { status, stdout } = henri(['analyze', 'nothing', '--level', '0'], {
        cwd: fixture,
        timeout: 120000,
      });

      expect(status).toBe(0);
      expect(stdout).toContain('No module named "nothing"');
    }, 120000);
  });

  describe('usage', () => {
    test('refuses a level that is not one', () => {
      const { status, stderr } = henri(['analyze', '--level', '9'], {
        cwd: fixture,
      });

      expect(status).toBe(code('USAGE'));
      expect(stderr).toContain('Invalid --level "9"');
    });

    test('refuses to run outside of an application', () => {
      const dir = tmpdir('henri-analyze-');

      try {
        const { status } = henri(['analyze'], { cwd: dir });

        expect(status).toBe(code('NOT_A_PROJECT'));
      } finally {
        cleanup(dir);
      }
    });
  });
});
