const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const UploadsModule = require('../src/module');

/**
 * A throwaway application directory
 *
 * @returns {string} the directory
 */
const workspace = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'henri-uploads-'));

/**
 * Everything the uploads module reads off a henri instance
 *
 * @param {string} cwd the application directory
 * @param {object} [config={}] the configuration
 * @returns {object} a henri-shaped object
 */
const fakeHenri = (cwd, config = {}) => {
  const values = Object.assign({ bodyLimit: '1mb' }, config);
  const lines = [];

  return {
    config: {
      get: (key) => values[key],
      has: (key) => Object.prototype.hasOwnProperty.call(values, key),
    },
    cwd: () => cwd,
    lines,
    pen: {
      error: (...args) => lines.push(['error', ...args]),
      fatal: (...args) => new Error(args.join(' ')),
      info: (...args) => lines.push(['info', ...args]),
      warn: (...args) => lines.push(['warn', ...args]),
    },
    server: { app: null },
    utils: {
      resolveFrom: (request, dir) =>
        require.resolve(request, { paths: [path.resolve(dir)] }),
    },
  };
};

/**
 * An express application with the uploads middleware mounted the way the
 * module mounts it, and one route that answers what arrived
 *
 * @param {object} [config={}] the `uploads` configuration
 * @param {object} [options={}] `{ handler }` to answer differently
 * @returns {Promise<object>} `{ app, cwd, henri, uploads }`
 */
const application = async (config = {}, options = {}) => {
  const cwd = workspace();
  const app = express();
  const henri = fakeHenri(cwd, { uploads: config });
  const uploads = new UploadsModule(henri);

  henri.server.app = app;
  henri.uploads = uploads;

  await uploads.init();

  app.post(
    '/upload',
    options.handler ||
      (async (req, res) => {
        const files = req.permitFiles('scan', 'scans');
        const stored = [];

        for (const list of Object.values(files)) {
          for (const file of list) {
            stored.push(await file.store());
          }
        }

        res.status(201).json({ body: req.body, stored });
      })
  );

  // The same shape core's error handler answers with
  app.use((error, req, res, next) => {
    res.status(error.status || 500).json({
      code: error.code,
      data: error.data,
      message: error.message,
    });
  });

  return { app, cwd, henri, uploads };
};

/**
 * Every file left in the storage's temporary directory
 *
 * @param {object} uploads the uploads module
 * @returns {Array<string>} the file names
 */
const temporaries = (uploads) => {
  try {
    return fs.readdirSync(uploads.storage.tmp);
  } catch (error) {
    return [];
  }
};

/**
 * Every stored object, as paths relative to the root
 *
 * @param {object} uploads the uploads module
 * @returns {Array<string>} the paths
 */
const objects = (uploads) => {
  const root = uploads.storage.root;
  const found = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.tmp' || entry.name === '.gitignore') {
        continue;
      }

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full, `${prefix}${entry.name}/`);
      } else {
        found.push(`${prefix}${entry.name}`);
      }
    }
  };

  walk(root, '');

  return found.sort();
};

/** A one pixel png, as bytes */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** A PDF, as bytes */
const PDF = Buffer.from('%PDF-1.4\n%âãÏÓ\n', 'latin1');

/** An ELF executable header */
const ELF = Buffer.concat([
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  Buffer.alloc(60),
]);

module.exports = {
  ELF,
  PDF,
  PNG,
  application,
  fakeHenri,
  objects,
  temporaries,
  workspace,
};
