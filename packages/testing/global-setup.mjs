/**
 * Vitest global setup: boots henri once for the whole run, in the main
 * process, and stops it at the end.
 *
 *   // vitest.config.js
 *   globalSetup: ['@usehenri/testing/global-setup']
 *
 * Tests run in workers, so they cannot see `henri` or the model globals with
 * this recipe: only HTTP through `request()`, which targets the server url
 * exported as HENRI_TEST_URL. Prefer `@usehenri/testing/setup-file` unless
 * one shared server for every file is what you want.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { setup, teardown } = require('./index.js');
const { serverUrl } = require('./url.js');

/**
 * Global setup entry
 *
 * @returns {Promise<Function>} the teardown
 */
export default async function globalSetup() {
  const henri = await setup();

  // The address the listener was actually given, not the `localhost` line
  // the terminal prints: the server binds 127.0.0.1 under NODE_ENV=test and
  // `localhost` resolves to ::1 first on most machines (see ./url.js)
  process.env.HENRI_TEST_URL = serverUrl(henri);

  return teardown;
}
