const fs = require('fs');
const os = require('os');
const path = require('path');

const utils = require('../utils');
const Henri = require('../henri');

describe('utils', () => {
  describe('packages', () => {
    let dir;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-pm-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { force: true, recursive: true });
    });

    test('detects the package manager from lockfiles and packageManager', () => {
      fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
      expect(utils.detectPackageManager(dir)).toBe('npm');

      fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
      expect(utils.detectPackageManager(dir)).toBe('yarn');

      fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
      expect(utils.detectPackageManager(dir)).toBe('pnpm');

      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ packageManager: 'yarn@4.0.0' })
      );
      expect(utils.detectPackageManager(dir)).toBe('yarn');

      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ packageManager: 'pnpm@11.0.0' })
      );
      expect(utils.detectPackageManager(dir)).toBe('pnpm');
    });

    test('looks at the parent directories (workspaces)', () => {
      const app = path.join(dir, 'apps', 'site');

      fs.mkdirSync(app, { recursive: true });
      fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');

      expect(utils.detectPackageManager(app)).toBe('pnpm');
      expect(utils.installCommand(['next', 'react'], app)).toBe(
        'pnpm add next react'
      );
    });

    test('builds the install command for each package manager', () => {
      fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
      expect(utils.installCommand(['nuxt'], dir)).toBe('yarn add nuxt');

      fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
      fs.unlinkSync(path.join(dir, 'yarn.lock'));
      expect(utils.installCommand(['nuxt'], dir)).toBe(
        'npm install --save nuxt'
      );
    });

    test('checkPackages resolves when everything is installed', async () => {
      await expect(utils.checkPackages(['express', 'glob'])).resolves.toBe(
        true
      );
      await expect(utils.checkPackages()).resolves.toBe(true);
    });

    test('checkPackages never installs: it prints the command and throws', async () => {
      const logs = [];
      const inst = { pen: { error: (...args) => logs.push(args) } };

      await expect(
        utils.checkPackages(
          ['express', 'henri-package-that-does-not-exist'],
          inst
        )
      ).rejects.toThrow(/pnpm add henri-package-that-does-not-exist/);

      expect(logs).toEqual([
        ['packages', 'missing: henri-package-that-does-not-exist'],
        ['packages', 'run: pnpm add henri-package-that-does-not-exist'],
      ]);
    });

    test('checkPackages reports a version that is too old', async () => {
      await expect(utils.checkPackages(['express@5.0.0'])).resolves.toBe(true);
      await expect(utils.checkPackages(['express@99.0.0'])).rejects.toThrow(
        /express@99\.0\.0/
      );
      expect(utils.checkMissing(['express@99.0.0', 'glob'])).toEqual([
        'express@99.0.0',
      ]);
    });

    test('compareVersions', () => {
      expect(utils.compareVersions('1.2.3', '1.2.3')).toBe(0);
      expect(utils.compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
      expect(utils.compareVersions('1.2', '1.2.1')).toBeLessThan(0);
      expect(utils.compareVersions('v2.0.0-beta.1', '1.99.99')).toBeGreaterThan(
        0
      );
      expect(utils.compareVersions('15.0.0', '15')).toBe(0);
    });
  });

  describe('loadModules', () => {
    const demo = path.resolve(__dirname, '../../../demo/app');

    test('loads a directory with identity and globalId', () => {
      const models = utils.loadModules(path.join(demo, 'models'));

      expect(Object.keys(models).sort()).toEqual(['artwork', 'user']);
      expect(models.artwork.identity).toBe('artwork');
      expect(models.artwork.globalId).toBe('Artwork');
      expect(models.user.globalId).toBe('User');
      expect(models.artwork.schema).toBeDefined();
    });

    test('keeps the directory path for controllers', () => {
      const controllers = utils.loadModules(path.join(demo, 'controllers'), {
        keepDirectoryPath: true,
      });

      expect(Object.keys(controllers).sort()).toEqual([
        'artwork',
        'main',
        'user',
      ]);
      expect(typeof controllers.artwork.index).toBe('function');
    });

    test('nested directories, duplicates and missing directories', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-load-'));

      try {
        fs.mkdirSync(path.join(dir, 'admin'));
        fs.writeFileSync(
          path.join(dir, 'Users.js'),
          'module.exports = { a: 1 };'
        );
        fs.writeFileSync(
          path.join(dir, 'admin', 'Users.js'),
          'module.exports = { identity: "Staff", b: 2 };'
        );

        const flat = utils.loadModules(dir);

        expect(Object.keys(flat).sort()).toEqual(['staff', 'users']);
        expect(flat.staff.globalId).toBe('Staff');

        const nested = utils.loadModules(dir, { keepDirectoryPath: true });

        expect(Object.keys(nested).sort()).toEqual(['staff', 'users']);

        fs.writeFileSync(
          path.join(dir, 'admin', 'Other.js'),
          'module.exports = { identity: "users" };'
        );
        expect(() => utils.loadModules(dir)).toThrow(
          /Duplicate module 'users'/
        );

        expect(utils.loadModules(path.join(dir, 'missing'))).toEqual({});
      } finally {
        fs.rmSync(dir, { force: true, recursive: true });
      }
    });
  });

  describe('stack', () => {
    test('returns frames with the caller first', () => {
      /**
       * @returns {Array} the frames
       */
      function caller() {
        return utils.stack();
      }

      const frames = caller();

      expect(frames.length).toBeGreaterThan(1);
      expect(frames[0].getFileName()).toBe(__filename);
      expect(frames[0].getFunctionName()).toBe('caller');
      expect(typeof frames[0].getLineNumber()).toBe('number');
      expect(frames[1].getFileName()).toBe(__filename);
    });
  });

  describe('isLoopback', () => {
    test.each([
      ['127.0.0.1', true],
      ['127.255.0.9', true],
      ['::1', true],
      ['::ffff:127.0.0.1', true],
      ['::FFFF:127.0.0.1', true],
      ['10.0.0.1', false],
      ['::ffff:10.0.0.1', false],
      ['128.0.0.1', false],
      ['', false],
      [undefined, false],
      [null, false],
    ])('%s -> %s', (address, expected) => {
      expect(utils.isLoopback(address)).toBe(expected);
    });
  });

  test('should getColor', () => {
    expect(utils.getColor()).toEqual('red');
    expect(utils.getColor('filly')).toEqual('red');

    expect(utils.getColor('error')).toEqual('red');
    expect(utils.getColor('warn')).toEqual('yellow');
    expect(utils.getColor('info')).toEqual('green');
    expect(utils.getColor('verbose')).toEqual('white');
    expect(utils.getColor('debug')).toEqual('blue');
    expect(utils.getColor('silly')).toEqual('magenta');
  });

  test('should clearConsole?', () => {
    expect(utils.clearConsole()).toBeTruthy();
    process.stdout.isTTY = false;
    expect(utils.clearConsole()).toBeTruthy();
    process.stdout.isTTY = true;
  });

  test('should check syntax', async () => {
    const inst = new Henri({ runlevel: 0 });

    await inst.init();

    expect(
      await utils.syntax('./packages/core/src/utils.djs', null, inst)
    ).toEqual(expect.stringContaining('unable to check the syntax'));
    expect(
      await utils.syntax(path.resolve(__dirname, '../utils.js'), null, inst)
    ).toBe(true);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-syntax-'));
    const broken = path.join(dir, 'broken.js');

    fs.writeFileSync(broken, 'module.exports = {');
     
    const log = console.log;

     
    console.log = () => {};
    try {
      // The error comes from Node's vm realm: check the name, not the class
      expect(await utils.syntax(broken, null, inst)).toMatchObject({
        name: 'SyntaxError',
      });
    } finally {
       
      console.log = log;
      fs.rmSync(dir, { force: true, recursive: true });
    }

    await expect(utils.syntax(broken, null, null)).rejects.toThrow(
      /henri is not defined/
    );

    await inst.stop();
  });
});
