/**
 * Reading a multipart body, within limits that exist before the first byte.
 *
 * Every bound below is handed to the parser, not checked afterwards. That is
 * the only arrangement that means anything: a size checked once the file is
 * on disk has already let the disk fill, and a count checked once the parts
 * are parsed has already paid for parsing them. busboy stops at the limit
 * and says which one it hit; henri turns that into a refusal and removes
 * what had been written so far.
 *
 * Three of the bounds are henri's own rather than busboy's:
 *
 * - the **total** size of the body. `Content-Length` is checked before the
 *   parser is even built, and then counted again as the bytes arrive, because
 *   a chunked request has no `Content-Length` to check and a request that has
 *   one is under no obligation to be honest about it.
 * - the **type** of each file, from its bytes (see `sniff.js`).
 * - the **name** of each file, which never reaches a path (see `names.js`).
 *
 * The parser runs before sessions and CSRF, because it has to: the `_csrf`
 * field of a `multipart/form-data` form is inside the body, and the CSRF
 * middleware reads `req.body`. That ordering is what makes an ordinary HTML
 * upload form work at all, and it is why the limits above matter as much as
 * they do -- they are what an unauthenticated request meets first.
 */
const busboy = require('busboy');
const { Transform } = require('node:stream');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { pipeline } = require('node:stream/promises');
const debug = require('debug')('henri:uploads');

const { UploadError } = require('./errors');
const { allowed, SAMPLE, sniff } = require('./sniff');
const { covers } = require('./config');
const { fileOf } = require('./file');
const { orInfinity } = require('./bytes');

/**
 * Keys a form field never becomes, whatever it is called.
 *
 * The same list `req.permit()` refuses in core (`base/params.js`): a body
 * ends up merged, assigned and serialized, and `__proto__` arriving as a
 * form field is the oldest way to make all three interesting.
 */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** How many header pairs one part may carry (busboy allows 2000) */
const HEADER_PAIRS = 100;

/**
 * The size limits busboy takes are "stop at", not "refuse past": it
 * truncates a part the moment it *reaches* the number, so a 5mb file under a
 * 5mb limit is reported as truncated. henri hands it one byte more and reads
 * the truncation as "larger than the limit", which is what the configuration
 * says and what an application expects.
 *
 * @param {(number|false|null)} limit the configured limit
 * @returns {number} what busboy is given
 */
const stopAt = (limit) => orInfinity(limit) + 1;

/**
 * Is this field name longer than the configuration allows?
 *
 * busboy only enforces `fieldNameSize` on urlencoded bodies -- in a
 * multipart body the name comes out of a part header, and `nameTruncated`
 * is always false there. So henri measures it.
 *
 * @param {string} name the field name
 * @param {(number|false)} limit the configured limit
 * @returns {boolean} true when it is too long
 */
const nameTooLong = (name, limit) =>
  limit !== false && Buffer.byteLength(String(name), 'utf8') > limit;

/** How long a refused request is drained before its socket is closed (ms) */
const DRAIN_TIMEOUT = 5000;

/**
 * How much more than the total limit a refused request may still send before
 * its socket is closed. A form whose file was a little too big is drained to
 * the end and reads its `413`; a deliberate flood is hung up on.
 */
const DRAIN_FACTOR = 2;

/**
 * Reads and throws away what is left of a refused request.
 *
 * A client told to stop is usually still sending, and answering while it
 * writes is what turns a `413` into a connection reset on its side -- the
 * status nobody sees is the status nobody fixes. So the rest of the body is
 * read and discarded, which costs no memory and no disk, and the wait is
 * bounded twice: `cap` bytes, and `ms` milliseconds. Past either, the socket
 * is closed and the client is left to work out what happened, which is the
 * right answer for something that was told no and kept sending.
 *
 * @param {Express.Request} req the request
 * @param {object} [options={}] `{ cap, ms }`
 * @param {(number|false)} [options.cap] how many more bytes to accept
 * @param {number} [options.ms=DRAIN_TIMEOUT] how long to wait
 * @returns {Promise<void>} resolves once the body is over, or the wait is
 */
function drain(req, { cap = false, ms = DRAIN_TIMEOUT } = {}) {
  if (req.complete || req.destroyed || req.readableEnded) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      req.destroy();
      resolve();
    }, ms);

    /**
     * Stops waiting
     *
     * @returns {void}
     */
    const done = () => {
      clearTimeout(timer);
      resolve();
    };

    let seen = 0;

    timer.unref();
    req.on('data', (chunk) => {
      seen += chunk.length;

      if (cap !== false && seen > cap) {
        debug('a refused request kept sending: closing the socket');
        req.destroy();
        done();
      }
    });
    req.on('end', done);
    req.on('close', done);
    req.on('error', done);
    req.resume();
  });
}

/**
 * Is this a body a multipart parser should read?
 *
 * @param {Express.Request} req the request
 * @returns {boolean} true when the content type is multipart
 */
const isMultipart = (req) =>
  /^multipart\//iu.test(String(req.headers['content-type'] || ''));

/**
 * A stream that counts what goes through it and stops past a limit
 *
 * @param {(number|false)} limit the number of bytes allowed, or false
 * @returns {Transform} the stream
 */
function meter(limit) {
  let seen = 0;

  return new Transform({
    transform(chunk, encoding, done) {
      seen += chunk.length;

      if (limit !== false && seen > limit) {
        return done(
          new UploadError(
            'TOTAL_TOO_LARGE',
            `the request body is larger than the ${limit} bytes this application accepts`,
            { limit }
          )
        );
      }

      return done(null, chunk);
    },
  });
}

/**
 * A stream that hashes, measures and samples what goes through it
 *
 * @param {object} state where to record what it saw
 * @returns {Transform} the stream
 */
function inspector(state) {
  const hash = crypto.createHash('sha256');
  const head = [];
  let sampled = 0;

  return new Transform({
    flush(done) {
      state.checksum = hash.digest('hex');
      state.sample = Buffer.concat(head);
      done();
    },
    transform(chunk, encoding, done) {
      hash.update(chunk);
      state.size += chunk.length;

      if (sampled < SAMPLE) {
        const wanted = chunk.subarray(0, SAMPLE - sampled);

        head.push(wanted);
        sampled += wanted.length;
      }

      done(null, chunk);
    },
  });
}

/**
 * Adds a value to a body, the way a repeated form field becomes a list
 *
 * @param {object} body the body being built
 * @param {string} name the field name
 * @param {string} value the value
 * @returns {void}
 */
function addField(body, name, value) {
  if (FORBIDDEN.has(name)) {
    debug('dropping the field %s', name);

    return;
  }

  if (!Object.prototype.hasOwnProperty.call(body, name)) {
    body[name] = value;

    return;
  }

  body[name] = Array.isArray(body[name])
    ? [...body[name], value]
    : [body[name], value];
}

/**
 * Reads one file part into the storage's temporary area
 *
 * @param {object} options the options
 * @param {string} options.field the form field
 * @param {stream.Readable} options.stream the part
 * @param {object} options.info what busboy read from the part headers
 * @param {number} options.order which part of the body it was
 * @param {object} options.settings the normalized settings
 * @param {object} options.storage the storage
 * @returns {Promise<UploadedFile>} the file, on disk and typed
 * @throws {UploadError} when the file is too large or of a refused type
 */
async function readFile({ field, info, order, settings, storage, stream }) {
  const state = { checksum: '', sample: Buffer.alloc(0), size: 0 };
  const temp = await storage.temp();
  const target = fs.createWriteStream(temp.path, { flags: 'wx', mode: 0o600 });
  let truncated = false;

  stream.on('limit', () => {
    truncated = true;
  });

  try {
    await pipeline(stream, inspector(state), target);
  } catch (error) {
    await fsp.unlink(temp.path).catch(() => {});
    throw error;
  }

  if (truncated) {
    await fsp.unlink(temp.path).catch(() => {});
    throw new UploadError(
      'FILE_TOO_LARGE',
      `"${field}" is larger than the ${settings.maxFileSize} bytes this application accepts`,
      { field, limit: settings.maxFileSize }
    );
  }

  const declaredType = String(info.mimeType || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  const found = settings.sniff
    ? sniff(state.sample, state.size <= SAMPLE)
    : { sniffed: false, type: declaredType || 'application/octet-stream' };

  if (!allowed(found.type, settings.allow)) {
    await fsp.unlink(temp.path).catch(() => {});
    throw new UploadError(
      'TYPE_NOT_ALLOWED',
      `"${field}" is ${found.type}, which this application does not accept`,
      { allow: settings.allow, field, type: found.type }
    );
  }

  return fileOf({
    checksum: state.checksum,
    declaredType: declaredType || null,
    field,
    maxFilenameLength: settings.maxFilenameLength,
    name: info.filename,
    order,
    path: temp.path,
    size: state.size,
    sniffed: found.sniffed,
    storage,
    type: found.type,
  });
}

/**
 * Reads a whole multipart body
 *
 * @param {Express.Request} req the request
 * @param {object} options `{ collected, settings, storage }`
 * @returns {Promise<object>} the fields, once every file is on disk
 * @throws {UploadError} on any of the limits, or on a malformed body
 */
function collect(req, { collected, settings, storage }) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const pending = [];
    let failure = null;
    let done = false;
    let parts = 0;

    /**
     * The first refusal wins; the rest of the body is drained so the client
     * can read the answer instead of seeing its socket reset
     *
     * @param {Error} error what went wrong
     * @returns {void}
     */
    const fail = (error) => {
      if (failure) {
        return;
      }

      failure = error;
      req.unpipe(counter);
      counter.unpipe(bus);
      // Destroying the parser makes it emit `close`, which is the ordinary
      // way this ends: it has to stop meaning "answer now", or the refusal
      // goes out while the client is still writing and it reads a connection
      // reset instead of the status
      bus.off('close', finish);
      bus.destroy();
      drain(req, { cap: settings.maxTotalSize }).then(finish, finish);
    };

    /**
     * Answers once every file has been written (or removed)
     *
     * @returns {void}
     */
    const finish = () => {
      if (done) {
        return;
      }

      done = true;
      Promise.allSettled(pending).then(() =>
        failure ? reject(failure) : resolve(fields)
      );
    };

    let bus;

    try {
      bus = busboy({
        defParamCharset: 'utf8',
        headers: req.headers,
        limits: {
          fieldNameSize: stopAt(settings.maxFieldNameSize),
          fieldSize: stopAt(settings.maxFieldSize),
          fields: orInfinity(settings.maxFields),
          fileSize: stopAt(settings.maxFileSize),
          files: orInfinity(settings.maxFiles),
          headerPairs: HEADER_PAIRS,
          parts: orInfinity(
            settings.maxFiles === false || settings.maxFields === false
              ? false
              : settings.maxFiles + settings.maxFields
          ),
        },
      });
    } catch (error) {
      return reject(
        new UploadError('MALFORMED_MULTIPART', error.message, {
          cause: error.message,
        })
      );
    }

    const counter = meter(settings.maxTotalSize);

    bus.on('field', (name, value, info) => {
      if (info.nameTruncated || nameTooLong(name, settings.maxFieldNameSize)) {
        return fail(
          new UploadError(
            'FIELD_NAME_TOO_LONG',
            `a field name is longer than the ${settings.maxFieldNameSize} bytes this application accepts`,
            { limit: settings.maxFieldNameSize }
          )
        );
      }

      if (info.valueTruncated) {
        return fail(
          new UploadError(
            'VALUE_TOO_LARGE',
            `"${name}" is larger than the ${settings.maxFieldSize} bytes this application accepts`,
            { field: name, limit: settings.maxFieldSize }
          )
        );
      }

      return addField(fields, name, value);
    });

    bus.on('file', (name, stream, info) => {
      if (failure || FORBIDDEN.has(name)) {
        return stream.resume();
      }

      if (nameTooLong(name, settings.maxFieldNameSize)) {
        stream.resume();

        return fail(
          new UploadError(
            'FIELD_NAME_TOO_LONG',
            `a field name is longer than the ${settings.maxFieldNameSize} bytes this application accepts`,
            { limit: settings.maxFieldNameSize }
          )
        );
      }

      const order = parts++;

      return pending.push(
        readFile({ field: name, info, order, settings, storage, stream }).then(
          (file) => collected.push(file),
          (error) => {
            stream.resume();
            fail(error);
          }
        )
      );
    });

    bus.on('fieldsLimit', () =>
      fail(
        new UploadError(
          'TOO_MANY_FIELDS',
          `this application accepts ${settings.maxFields} fields in a form`,
          { limit: settings.maxFields }
        )
      )
    );

    bus.on('filesLimit', () =>
      fail(
        new UploadError(
          'TOO_MANY_FILES',
          `this application accepts ${settings.maxFiles} files in a request`,
          { limit: settings.maxFiles }
        )
      )
    );

    bus.on('partsLimit', () =>
      fail(
        new UploadError(
          'TOO_MANY_FIELDS',
          'this application accepts fewer parts in a request',
          { limit: settings.maxFields }
        )
      )
    );

    bus.on('error', (error) =>
      fail(
        error instanceof UploadError
          ? error
          : new UploadError(
              'MALFORMED_MULTIPART',
              'the multipart body could not be read',
              {
                cause: error.message,
              }
            )
      )
    );

    bus.on('close', finish);

    counter.on('error', fail);

    // A client that goes away half-way: the socket closes before the body is
    // complete. `close` fires at the end of every request too, which is why
    // `complete` is what is asked about rather than the event.
    req.on('close', () => {
      if (!req.complete) {
        fail(
          new UploadError('MALFORMED_MULTIPART', 'the request was abandoned', {
            aborted: true,
          })
        );
      }
    });

    return req.pipe(counter).pipe(bus);
  });
}

/**
 * `req.files`, `req.file()` and `req.permitFiles()`, on every request.
 *
 * They exist whether or not anything was uploaded, so a controller reads
 * them without asking first -- the same reason `req.permit()` exists on a
 * `GET`.
 *
 * @param {Express.Request} req the request
 * @returns {Array<UploadedFile>} the list the sweep reads
 */
function decorate(req) {
  const collected = [];

  req.files = {};
  req._uploads = collected;

  /**
   * The first file of a field, or null
   *
   * @param {string} field the form field
   * @returns {?UploadedFile} the file
   */
  req.file = (field) => (req.files[field] || [])[0] || null;

  /**
   * The listed file fields, as `req.permit()` does for the body: what was
   * not asked for is not returned, and -- unlike a body field, which only
   * costs memory until the request ends -- it is removed from the disk on
   * the spot.
   *
   * @param {...(string|Array<string>)} fields the file fields to accept
   * @returns {object} `{ [field]: Array<UploadedFile> }`, only the listed ones
   */
  req.permitFiles = (...fields) => {
    const wanted = new Set(
      fields
        .flat(Infinity)
        .filter((field) => typeof field === 'string' && !FORBIDDEN.has(field))
    );
    const kept = {};

    for (const [field, list] of Object.entries(req.files)) {
      if (wanted.has(field)) {
        kept[field] = list;
        continue;
      }

      for (const file of list) {
        file
          .discard()
          .catch((error) => debug('unable to discard: %s', error.message));
      }
    }

    req.files = kept;

    return kept;
  };

  return collected;
}

/**
 * Removes, when the response closes, every file the request did not keep.
 *
 * `close` fires on an answered request, on a refused one, on one the
 * timeout answered `503` and on one whose client went away, which is the
 * whole list of ways a request ends. A file `store()` moved into the
 * storage is already released and is not touched.
 *
 * @param {Express.Response} res the response
 * @param {Array<UploadedFile>} collected the files of this request
 * @returns {void}
 */
function sweepOnClose(res, collected) {
  res.on('close', () => {
    for (const file of collected) {
      if (!file.released) {
        file
          .discard()
          .catch((error) => debug('unable to sweep: %s', error.message));
      }
    }
  });
}

/**
 * The middleware the module mounts.
 *
 * It reads the settings and the storage off the module on every request
 * rather than closing over them, because an express app has no way to
 * remove a middleware: a reload changes what this one does, never where it
 * sits in the chain -- and where it sits, before sessions and CSRF, is the
 * part that cannot move.
 *
 * @param {object} module the uploads module (`henri.uploads`)
 * @returns {function} express middleware
 */
function middleware(module) {
  return function uploads(req, res, next) {
    const collected = decorate(req);
    const { pen } = module.henri || {};
    const { settings, storage } = module;

    if (!module.enabled || !settings || !storage) {
      return next();
    }

    if (!isMultipart(req) || !covers(req, settings.paths)) {
      return next();
    }

    const declared = Number(req.headers['content-length']);

    if (
      settings.maxTotalSize !== false &&
      Number.isFinite(declared) &&
      declared > settings.maxTotalSize
    ) {
      const refusal = new UploadError(
        'TOTAL_TOO_LARGE',
        `the request body is larger than the ${settings.maxTotalSize} bytes this application accepts`,
        { limit: settings.maxTotalSize }
      );

      // Nothing has been read, so the whole budget is still there: a body a
      // little over the limit is drained and the client reads its 413
      return drain(req, {
        cap: settings.maxTotalSize * DRAIN_FACTOR,
      }).then(() => next(refusal));
    }

    sweepOnClose(res, collected);

    return collect(req, { collected, settings, storage })
      .then((fields) => {
        req.body = Object.assign({}, req.body, fields);
        // The reads finish in whatever order the disk answers in; the body
        // had an order, and that is the one an application sees
        collected.sort((one, two) => one.order - two.order);

        for (const file of collected) {
          req.files[file.field] = req.files[file.field] || [];
          req.files[file.field].push(file);
        }

        next();
      })
      .catch(async (error) => {
        // A refusal frees the disk now, rather than waiting for the sweep:
        // what was already read is what a flood would have left lying around
        await Promise.all(collected.map((file) => file.discard()));

        pen &&
          pen.warn(
            'uploads',
            `${req.method} ${req.path}`,
            error.code || 'refused',
            error.message
          );
        next(error);
      });
  };
}

module.exports = {
  DRAIN_FACTOR,
  DRAIN_TIMEOUT,
  FORBIDDEN,
  HEADER_PAIRS,
  collect,
  covers,
  decorate,
  drain,
  isMultipart,
  meter,
  middleware,
  readFile,
  sweepOnClose,
};
