/**
 * Variants: a derived file is a file with a key.
 *
 * ---------------------------------------------------------------------------
 * Where the work happens, and what it costs
 * ---------------------------------------------------------------------------
 *
 * Three places were possible and only one of them is defensible:
 *
 * - **On write**, inside `store()`. Every upload then pays for every variant
 *   an application ever declared, in the request that uploaded, whether or
 *   not anybody looks at the file. A resize is hundreds of milliseconds of
 *   one CPU, and the request that pays is the one a person is watching.
 * - **On first request, in a job.** The right answer for a big library and
 *   the wrong one for the first viewer, who gets a placeholder and has to
 *   come back. An application that wants it can have it -- the record has a
 *   key, `henri.jobs` is already there, and `variant()` in a job is the
 *   whole implementation.
 * - **On demand, once, memoized by the key itself.** Which is this. The
 *   first caller pays; everyone after reads a stored object. There is no
 *   table, no column and nothing to invalidate, because the key is derived
 *   from the source key and a digest of the variant's own terms: the same
 *   name over the same file is the same key in every process and every
 *   environment, and a variant whose terms changed is simply a different
 *   key that nothing has written yet.
 *
 * The cost of the first request is bounded twice: `stat()` before anything
 * is decoded, so a variant that exists costs one `stat`; and one promise per
 * derived key per process, so a hundred concurrent misses run the work once.
 * Across processes the bound is the number of processes, deliberately -- the
 * same trade `henri.cache.fetch()` makes and for the same reason, that a
 * lock needs a lease and a lease needs a guess.
 *
 * ---------------------------------------------------------------------------
 * The dependency, and what an application without it gets
 * ---------------------------------------------------------------------------
 *
 * `sharp` is a native addon: libvips, a platform-specific binary, and a
 * build or a prebuilt download at install time. Making it a dependency of
 * `@usehenri/uploads` would put all of that in the install of every
 * application that accepts a PDF, which is exactly the install-weight
 * problem this package exists on the right side of.
 *
 * So it is an **optional peer dependency**, resolved from the application,
 * the way `@opentelemetry/api` is for telemetry and a store adapter is for a
 * database. An application that installs it gets variants; one that does not
 * gets `HENRI_UPLOAD_NO_IMAGE_LIBRARY` with the install line the first time
 * it asks for one, and pays nothing at all until then -- no require, no
 * probe at boot, no branch on the hot path. `henri doctor` reports it when
 * `uploads.variants` is configured and the package is in no `package.json`,
 * which is where a missing dependency is supposed to be found.
 *
 * ---------------------------------------------------------------------------
 * What is refused, and why
 * ---------------------------------------------------------------------------
 *
 * - **Only a declared variant.** `variant(record, 'thumb')` takes a name out
 *   of `config.uploads.variants` and nothing else. An ad-hoc `{ width }` from
 *   a request would let one visitor ask for ten thousand distinct sizes, each
 *   a decode, a resize and an object written -- a denial of service with a
 *   storage bill. A name cannot.
 * - **Only an image henri recognized.** The type comes from the bytes, as
 *   everywhere else, and `image/svg+xml` is refused outright: it is one of
 *   the two scriptable types, and rendering it means handing untrusted XML
 *   to librsvg.
 * - **Bounded pixels, one frame, no metadata.** `limitInputPixels` is
 *   explicit, an animated image is its first frame (a ten thousand frame GIF
 *   is a bomb whatever its file size), and sharp copies no metadata forward,
 *   so a thumbnail does not carry the source's GPS coordinates.
 * - **The output is sniffed like anything else.** What sharp produced is
 *   read back with `sniff()` and compared with the format that was asked
 *   for. It should always match; a run where it does not is
 *   `HENRI_UPLOAD_VARIANT_FAILED` rather than an object stored under a
 *   `.webp` key that is not one.
 */
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const debug = require('debug')('henri:uploads');

const { SAMPLE, extensionFor, sniff } = require('./sniff');
const { coded } = require('./errors');

/** How the variant's terms are named in a key: half a sha256 */
const DIGEST = 32;

/** The formats a variant may be written in, and what each one is */
const FORMATS = {
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** How a resize may fill the box it was given (sharp's own names) */
const FITS = new Set(['contain', 'cover', 'fill', 'inside', 'outside']);

/** The largest side a variant may be asked for */
const MAX_SIDE = 8192;

/**
 * How many pixels a source may hold before it is refused.
 *
 * Fifty megapixels is past every camera and every scan, and far below what
 * a file crafted to be a decompression bomb declares. sharp has a limit of
 * its own; this one is henri's, written down, so it does not move when the
 * library's default does.
 */
const MAX_PIXELS = 50 * 1000 * 1000;

/**
 * The types a variant may be derived from.
 *
 * Every raster image `sniff.js` recognizes, minus `image/svg+xml`. The
 * refusal is the point of the list: an SVG is text that carries script, and
 * rendering one means parsing untrusted XML with an external entity loader
 * in the process.
 */
const SOURCES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/heic',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
]);

/**
 * One variant, as the configuration declared it, with nothing missing.
 *
 * A spec henri cannot carry out never gets this far -- `base/config-schema.js`
 * refuses it at boot with everything else -- so this reads the values rather
 * than arguing with them, and falls back for an application that built its
 * settings by hand.
 *
 * @param {*} declared what the configuration holds under one name
 * @returns {?object} the spec, or null when there is nothing usable
 */
function specOf(declared) {
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
    return null;
  }

  const side = (value) =>
    Number.isInteger(value) && value > 0 && value <= MAX_SIDE ? value : null;
  const width = side(declared.width);
  const height = side(declared.height);

  if (width === null && height === null) {
    return null;
  }

  const quality = Number(declared.quality);

  return {
    fit: FITS.has(declared.fit) ? declared.fit : 'cover',
    format: FORMATS[declared.format] ? declared.format : 'webp',
    height,
    quality:
      Number.isInteger(quality) && quality >= 1 && quality <= 100
        ? quality
        : 80,
    width,
  };
}

/**
 * Every declared variant, by name
 *
 * @param {*} declared what the configuration holds under `variants`
 * @returns {?object} the specs, or null when none are declared
 */
function variantsOf(declared) {
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
    return null;
  }

  const found = {};

  for (const [name, value] of Object.entries(declared)) {
    const spec = specOf(value);

    if (spec && /^[0-9a-z][0-9a-z-]{0,31}$/u.test(name)) {
      found[name] = spec;
    }
  }

  return Object.keys(found).length > 0 ? found : null;
}

/**
 * The key a variant is stored under.
 *
 * `<the source's directories>/<the source's name>/<digest>.<extension>`: the
 * source's own random name becomes a directory, so a variant sits beside the
 * file it came from and a listing reads. The digest is of the variant's
 * terms and not of its name, so two names that mean the same thing are one
 * object, and renaming a variant costs nothing.
 *
 * It is a plain digest of a canonical string, the way a retention rule's
 * token is: no secret, so it means the same in development and in
 * production, and a variant made by one process is found by another.
 *
 * @param {string} key the source key
 * @param {object} spec the normalized spec
 * @returns {string} the derived key
 */
function keyFor(key, spec) {
  const stem = key.replace(/\.[0-9a-z]{1,8}$/u, '');
  const terms = [
    'v1',
    spec.format,
    spec.fit,
    String(spec.width || ''),
    String(spec.height || ''),
    String(spec.quality),
  ].join(':');
  const digest = crypto
    .createHash('sha256')
    .update(terms, 'utf8')
    .digest('hex')
    .slice(0, DIGEST);

  return `${stem}/${digest}.${extensionFor(FORMATS[spec.format])}`;
}

/**
 * The image library, from the application, or a refusal that says how to
 * get it (`sharp`, which henri does not ship)
 *
 * @param {object} henri the henri instance
 * @returns {function} sharp
 * @throws when the application does not depend on it
 */
function imageLibrary(henri) {
  const cwd = (henri && henri.cwd && henri.cwd()) || process.cwd();

  try {
    return require(
      henri && henri.utils && henri.utils.resolveFrom
        ? henri.utils.resolveFrom('sharp', cwd)
        : 'sharp'
    );
  } catch (error) {
    throw coded(
      'HENRI_UPLOAD_NO_IMAGE_LIBRARY',
      'variants need an image library, which henri does not ship: pnpm add sharp',
      { cause: error }
    );
  }
}

/**
 * Reads a stream into memory, refusing past a bound
 *
 * @param {stream.Readable} stream the source
 * @param {number} cap how many bytes to accept
 * @returns {Promise<Buffer>} the bytes
 * @throws when there are more of them than that
 */
async function bufferOf(stream, cap) {
  const chunks = [];
  let seen = 0;

  for await (const chunk of stream) {
    seen += chunk.length;

    if (cap !== false && seen > cap) {
      stream.destroy();
      throw coded(
        'HENRI_UPLOAD_VARIANT_FAILED',
        `this file is larger than the ${cap} bytes a variant is derived from`
      );
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * The bytes of one variant
 *
 * @param {function} sharp the image library
 * @param {Buffer} source the source image
 * @param {object} spec the normalized spec
 * @returns {Promise<Buffer>} the derived image
 * @throws when the source cannot be read, or the result is not what was asked
 */
async function derive(sharp, source, spec) {
  const wanted = FORMATS[spec.format];
  let data;

  try {
    data = await sharp(source, {
      // One frame: an animated image is its first, whatever its file size
      animated: false,
      limitInputPixels: MAX_PIXELS,
      sequentialRead: true,
    })
      // The EXIF orientation, applied and then dropped with the rest of the
      // metadata: a thumbnail carries no GPS coordinates
      .rotate()
      .resize({
        fit: spec.fit,
        height: spec.height || undefined,
        width: spec.width || undefined,
        withoutEnlargement: true,
      })
      .toFormat(spec.format, { quality: spec.quality })
      .toBuffer();
  } catch (error) {
    throw coded(
      'HENRI_UPLOAD_VARIANT_FAILED',
      `this file could not be resized: ${error.message}`,
      { cause: error }
    );
  }

  const found = sniff(data.subarray(0, SAMPLE), data.length <= SAMPLE);

  if (found.type !== wanted) {
    throw coded(
      'HENRI_UPLOAD_VARIANT_FAILED',
      `the resize produced ${found.type} rather than the ${wanted} it was asked for`
    );
  }

  return data;
}

/**
 * Derives one variant and stores it under its key
 *
 * @param {object} options everything the work needs
 * @param {object} options.henri the henri instance
 * @param {object} options.storage the storage
 * @param {object} options.record the source record
 * @param {object} options.spec the normalized spec
 * @param {string} options.key the derived key
 * @param {(number|false)} options.maxFileSize the bound on the source
 * @returns {Promise<object>} the variant record
 */
async function produce({ henri, key, maxFileSize, record, spec, storage }) {
  const sharp = imageLibrary(henri);
  const source = await bufferOf(await storage.get(record.key), maxFileSize);
  const data = await derive(sharp, source, spec);
  const type = FORMATS[spec.format];
  const temp = await storage.temp();

  try {
    await fsp.writeFile(temp.path, data, { mode: 0o600 });
    await storage.put(temp.path, key, {
      checksum: crypto.createHash('sha256').update(data).digest('hex'),
      name: record.name,
      size: data.length,
      type,
    });
  } finally {
    await fsp.unlink(temp.path).catch(() => {});
  }

  debug('derived %s from %s (%d bytes)', key, record.key, data.length);

  return {
    key,
    name: record.name,
    of: record.key,
    size: data.length,
    storage: storage.name,
    type,
    uploadedAt: new Date().toISOString(),
  };
}

module.exports = {
  DIGEST,
  FITS,
  FORMATS,
  MAX_PIXELS,
  MAX_SIDE,
  SOURCES,
  bufferOf,
  derive,
  imageLibrary,
  keyFor,
  produce,
  specOf,
  variantsOf,
};
