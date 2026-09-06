/**
 * What the bytes say a file is.
 *
 * A multipart part carries a `Content-Type` and a filename, both written by
 * whoever is uploading. Neither is evidence: `avatar.png` with
 * `Content-Type: image/png` is one HTTP header and one string away from
 * being a PHP script, and every framework that stored the declared type and
 * served it back has learned that the hard way.
 *
 * So henri reads the first bytes instead. A signature it recognizes is the
 * type; the declared one is kept beside it as `declaredType`, for the record
 * and for nothing else. What henri recognizes is the table below plus one
 * inference -- a sample that decodes as UTF-8 with no control characters is
 * text -- and everything else is `application/octet-stream`. That last line
 * is the honest part: henri never guesses a type from an extension, so a
 * format with no signature stays unrecognized rather than being described by
 * its name.
 *
 * Two entries exist only to be refused: `text/html` and `image/svg+xml` are
 * text formats that carry script. They are named so that an `allow` list can
 * exclude them, so that a descriptor never claims a scriptable file is
 * `text/plain`, and so that `extensionFor()` can store them under a name no
 * web server would render.
 */

/** How many bytes of a file are enough to recognize it */
const SAMPLE = 4096;

/**
 * The signatures henri recognizes, longest and most specific first.
 *
 * `at` is where the bytes sit, `hex` is what they are, and `also` is a second
 * run of bytes the container format needs (RIFF and ISO base media both put
 * the interesting part after a length).
 */
const SIGNATURES = [
  // Executables, first: whatever else they look like, this is what they are
  { hex: '7f454c46', type: 'application/x-elf' },
  { hex: '4d5a', type: 'application/x-msdownload' },
  { hex: 'cffaedfe', type: 'application/x-mach-binary' },
  { hex: 'cefaedfe', type: 'application/x-mach-binary' },
  { hex: 'feedface', type: 'application/x-mach-binary' },
  { hex: 'feedfacf', type: 'application/x-mach-binary' },
  { hex: 'cafebabe', type: 'application/x-mach-binary' },
  { hex: '23212f', type: 'text/x-shellscript' },

  // Images
  { hex: '89504e470d0a1a0a', type: 'image/png' },
  { hex: 'ffd8ff', type: 'image/jpeg' },
  { hex: '474946383761', type: 'image/gif' },
  { hex: '474946383961', type: 'image/gif' },
  { also: { at: 8, hex: '57454250' }, hex: '52494646', type: 'image/webp' },
  { hex: '424d', type: 'image/bmp' },
  { hex: '49492a00', type: 'image/tiff' },
  { hex: '4d4d002a', type: 'image/tiff' },
  {
    also: { at: 8, hex: '61766966' },
    at: 4,
    hex: '66747970',
    type: 'image/avif',
  },
  {
    also: { at: 8, hex: '68656963' },
    at: 4,
    hex: '66747970',
    type: 'image/heic',
  },

  // Documents and archives
  { hex: '255044462d', type: 'application/pdf' },
  { hex: '504b0304', type: 'application/zip' },
  { hex: '504b0506', type: 'application/zip' },
  { hex: '504b0708', type: 'application/zip' },
  { hex: '1f8b', type: 'application/gzip' },
  { hex: '377abcaf271c', type: 'application/x-7z-compressed' },
  { hex: '526172211a07', type: 'application/vnd.rar' },
  { hex: '425a68', type: 'application/x-bzip2' },
  { hex: 'd0cf11e0a1b11ae1', type: 'application/x-cfb' },

  // Audio and video
  { also: { at: 8, hex: '57415645' }, hex: '52494646', type: 'audio/wav' },
  { hex: '494433', type: 'audio/mpeg' },
  { hex: 'fffb', type: 'audio/mpeg' },
  { hex: '4f676753', type: 'audio/ogg' },
  { hex: '664c6143', type: 'audio/flac' },
  { hex: '1a45dfa3', type: 'video/webm' },
  { at: 4, hex: '66747970', type: 'video/mp4' },
];

/**
 * The extension a stored object is given, by type.
 *
 * The name on disk is generated, so this is cosmetic -- except for the two
 * scriptable types, which are stored as `.bin` on purpose. Uploads are never
 * served from a directory the application serves, and this is the second
 * lock on that door: a web server accidentally pointed at the storage
 * directory still has nothing there it would render or execute.
 */
const EXTENSIONS = {
  'application/gzip': 'gz',
  'application/pdf': 'pdf',
  'application/vnd.rar': 'rar',
  'application/x-7z-compressed': '7z',
  'application/x-bzip2': 'bz2',
  'application/x-cfb': 'bin',
  'application/x-elf': 'bin',
  'application/x-mach-binary': 'bin',
  'application/x-msdownload': 'bin',
  'application/zip': 'zip',
  'audio/flac': 'flac',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'bin',
  'image/tiff': 'tiff',
  'image/webp': 'webp',
  'text/html': 'bin',
  'text/plain': 'txt',
  'text/x-shellscript': 'bin',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** What a file henri recognizes nothing about is called */
const UNKNOWN = 'application/octet-stream';

/** The extension of everything else */
const UNKNOWN_EXTENSION = 'bin';

/** Control characters a text file may hold: tab, newline, carriage return */
const TEXT_CONTROLS = new Set([9, 10, 13]);

/**
 * Does the sample start with these bytes at this offset?
 *
 * @param {Buffer} sample the first bytes of the file
 * @param {number} at the offset
 * @param {string} hex the bytes, as hex
 * @returns {boolean} true when they match
 */
function matches(sample, at, hex) {
  const wanted = Buffer.from(hex, 'hex');

  return (
    sample.length >= at + wanted.length &&
    sample.compare(wanted, 0, wanted.length, at, at + wanted.length) === 0
  );
}

/**
 * Is this sample text? (valid UTF-8, no control characters but tab and the
 * two newline ones)
 *
 * The sample is a prefix of the file, so it may end in the middle of a
 * multi-byte character; the last three bytes are dropped before decoding
 * rather than being read as a broken encoding.
 *
 * @param {Buffer} sample the first bytes of the file
 * @param {boolean} complete whether the sample is the whole file
 * @returns {boolean} true when every byte is printable text
 */
function isText(sample, complete) {
  if (sample.length === 0) {
    return true;
  }

  const usable = complete ? sample : sample.subarray(0, sample.length - 3);

  for (const byte of usable) {
    if (byte < 32 && !TEXT_CONTROLS.has(byte)) {
      return false;
    }
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(usable);
  } catch (error) {
    return false;
  }

  return true;
}

/**
 * The type of a text sample: the two scriptable ones, or plain text
 *
 * @param {Buffer} sample the first bytes of the file
 * @returns {string} a media type
 */
function textType(sample) {
  const head = sample.subarray(0, 1024).toString('utf8').trimStart();
  const lower = head.toLowerCase();

  if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) {
    return 'text/html';
  }

  if (
    lower.startsWith('<svg') ||
    (lower.startsWith('<?xml') && lower.includes('<svg'))
  ) {
    return 'image/svg+xml';
  }

  return 'text/plain';
}

/**
 * What the bytes say this file is
 *
 * @param {Buffer} sample the first bytes of the file (up to `SAMPLE`)
 * @param {boolean} [complete=false] whether the sample is the whole file
 * @returns {{type: string, sniffed: boolean}} the type, and whether henri
 *   recognized it rather than giving up
 */
function sniff(sample, complete = false) {
  const buffer = Buffer.isBuffer(sample) ? sample : Buffer.alloc(0);

  for (const entry of SIGNATURES) {
    if (
      matches(buffer, entry.at || 0, entry.hex) &&
      (!entry.also || matches(buffer, entry.also.at, entry.also.hex))
    ) {
      return { sniffed: true, type: entry.type };
    }
  }

  if (isText(buffer, complete)) {
    return { sniffed: true, type: textType(buffer) };
  }

  return { sniffed: false, type: UNKNOWN };
}

/**
 * The extension a stored object gets for a type
 *
 * @param {string} type a media type
 * @returns {string} an extension, without its dot
 */
const extensionFor = (type) => EXTENSIONS[type] || UNKNOWN_EXTENSION;

/**
 * Does a type match one entry of an `allow` list?
 *
 * An entry is a media type (`image/png`), a wildcard subtype (`image/*`) or
 * `*` for everything. Nothing else: a pattern language is a place for a
 * mistake to hide.
 *
 * @param {string} type the type of the file
 * @param {string} pattern one entry of the list
 * @returns {boolean} true when it matches
 */
function accepts(type, pattern) {
  const wanted = String(pattern).trim().toLowerCase();

  if (wanted === '*' || wanted === '*/*') {
    return true;
  }

  return wanted.endsWith('/*')
    ? type.startsWith(`${wanted.slice(0, -1)}`)
    : type === wanted;
}

/**
 * Is this type allowed?
 *
 * @param {string} type the type of the file
 * @param {?Array<string>} allow the allow list, or null for every type
 * @returns {boolean} true when the file may be kept
 */
const allowed = (type, allow) =>
  !Array.isArray(allow) || allow.some((pattern) => accepts(type, pattern));

module.exports = {
  EXTENSIONS,
  SAMPLE,
  SIGNATURES,
  UNKNOWN,
  accepts,
  allowed,
  extensionFor,
  isText,
  sniff,
};
