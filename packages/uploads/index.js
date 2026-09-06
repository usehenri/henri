/**
 * `@usehenri/uploads`: bounded multipart parsing, files typed by their bytes,
 * and a storage seam.
 *
 * An application installs the package and gets the module (`henri.uploads`),
 * `req.files`, `req.file()` and `req.permitFiles()`. What is exported here is
 * for the two things an application does beyond that: writing a storage of
 * its own against `HenriStorage`, and reusing the name and type helpers in a
 * validation of its own.
 *
 * See https://usehenri.io/guides/uploads/
 */
const UploadsModule = require('./src/module');
const LocalStorage = require('./src/storage/local');

const { DEFAULTS, settings } = require('./src/config');
const { UploadError, coded } = require('./src/errors');
const { UploadedFile } = require('./src/file');
const { UrlSigner } = require('./src/signing');
const { bytes, format } = require('./src/bytes');
const { contentDisposition, isKey, keyFor, safeName } = require('./src/names');
const { createStorage } = require('./src/storage');
const { extensionFor, sniff } = require('./src/sniff');

module.exports = UploadsModule;
module.exports.DEFAULTS = DEFAULTS;
module.exports.LocalStorage = LocalStorage;
module.exports.UploadError = UploadError;
module.exports.UploadedFile = UploadedFile;
module.exports.UploadsModule = UploadsModule;
module.exports.UrlSigner = UrlSigner;
module.exports.bytes = bytes;
module.exports.coded = coded;
module.exports.contentDisposition = contentDisposition;
module.exports.createStorage = createStorage;
module.exports.extensionFor = extensionFor;
module.exports.format = format;
module.exports.isKey = isKey;
module.exports.keyFor = keyFor;
module.exports.safeName = safeName;
module.exports.settings = settings;
module.exports.sniff = sniff;
