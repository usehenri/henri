/**
 * Vitest setup file: boots henri before each test file and stops it after.
 *
 *   // vitest.config.js
 *   setupFiles: ['@usehenri/testing/setup-file']
 *
 * Runs inside the test worker, so `henri` and the model globals are available
 * to the test file and `request()` hits the in-process server. Each test file
 * gets its own boot (fresh database with the disk adapter); keep
 * `fileParallelism: false` so files do not fight for the same resources.
 */
import { createRequire } from 'node:module';
import { afterAll } from 'vitest';

const require = createRequire(import.meta.url);

// Bind every host-less listen() to 127.0.0.1 before anything starts a server:
// without it a request can be answered by whatever else holds that port
require('./loopback.js');

const { setup, teardown } = require('./index.js');

await setup();

afterAll(teardown);
