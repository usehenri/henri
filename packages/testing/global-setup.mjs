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

const { setup, teardown } = createRequire(import.meta.url)('./index.js');

/**
 * Global setup entry
 *
 * @returns {Promise<Function>} the teardown
 */
export default async function globalSetup() {
  const henri = await setup();

  process.env.HENRI_TEST_URL = henri.server.url;

  return teardown;
}
