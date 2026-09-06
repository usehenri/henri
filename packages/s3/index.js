/**
 * `@usehenri/s3`: uploads on an object store.
 *
 * ```json
 * {
 *   "uploads": {
 *     "storage": {
 *       "adapter": "s3",
 *       "bucket": "henri-uploads",
 *       "region": "us-east-1"
 *     }
 *   }
 * }
 * ```
 *
 * `@usehenri/uploads` resolves this package from the application the way
 * core resolves `@usehenri/redis` for `config.shared`, and constructs the
 * default export with the block. One backend speaks to S3, R2, Spaces,
 * MinIO and GCS's interoperability mode: what tells them apart is the
 * endpoint and the region.
 *
 * See https://usehenri.io/guides/uploads/
 */
const S3Storage = require('./src/storage');

const { S3Client } = require('./src/client');
const { StorageError, coded } = require('./src/errors');
const { presign, sign } = require('./src/signature');

module.exports = S3Storage;
module.exports.S3Client = S3Client;
module.exports.S3Storage = S3Storage;
module.exports.StorageError = StorageError;
module.exports.coded = coded;
module.exports.presign = presign;
module.exports.sign = sign;
