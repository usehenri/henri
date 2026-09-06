/**
 * The object store this package's live suite runs against.
 *
 * Nothing set: the live suite is skipped and `pnpm test` stays offline, like
 * the SQL adapters (`packages/drizzle/__tests__/targets.js`) and
 * `@usehenri/redis`. With `HENRI_TEST_S3_URL` in the environment it runs
 * against that endpoint, in a bucket of its own that it creates and empties,
 * so nothing else on the server is touched.
 *
 * ```bash
 * docker run -d --name henri-minio -p 59000:9000 \
 *   -e MINIO_ROOT_USER=henri -e MINIO_ROOT_PASSWORD=henri-secret \
 *   quay.io/minio/minio:latest server /data
 * HENRI_TEST_S3_URL=http://127.0.0.1:59000 \
 *   HENRI_TEST_S3_KEY=henri HENRI_TEST_S3_SECRET=henri-secret pnpm test:s3
 * ```
 *
 * The port is not 9000 on purpose: this repository's compose file already
 * moves postgres, mysql and mongo off theirs, because a development machine
 * has something on every default port sooner or later.
 */

/** The endpoint, or null when the suite should skip */
const url = process.env.HENRI_TEST_S3_URL || null;

/** Whether a live store was named */
const live = Boolean(url);

/** The region to sign for; MinIO answers to any of them */
const region = process.env.HENRI_TEST_S3_REGION || 'us-east-1';

/** The credentials */
const credentials = {
  accessKeyId: process.env.HENRI_TEST_S3_KEY || 'henri',
  secretAccessKey: process.env.HENRI_TEST_S3_SECRET || 'henri-secret',
};

// One bucket per process, so parallel workers never read each other's objects
const RUN = `${process.pid.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A bucket name nothing else in this run uses */
const bucket = `henri-test-${RUN}`.toLowerCase();

module.exports = { bucket, credentials, live, region, url };
