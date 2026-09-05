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

const { setup, teardown } = createRequire(import.meta.url)('./index.js');

await setup();

afterAll(teardown);
