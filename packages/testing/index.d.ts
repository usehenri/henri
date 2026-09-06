// Type definitions for @usehenri/testing
//
// Hand-written; see packages/core/index.d.ts for the rest of the API.

import type Supertest from 'supertest';
import type { Henri } from '@usehenri/core';

/** Options of `setup()`. */
export interface SetupOptions {
  /** Start the application's workers too (`false`). */
  workers?: boolean;
}

/**
 * Boots the application under `NODE_ENV=test` and resolves with the instance,
 * setting `global.henri` and the model globals. Idempotent: a second call
 * while one boot is in flight resolves with the same instance.
 *
 *     beforeAll(() => setup());
 *     afterAll(() => teardown());
 */
export function setup(options?: SetupOptions): Promise<Henri>;

/** Stops the instance. Resolves `false` when there was nothing running. */
export function teardown(): Promise<boolean>;

/**
 * A supertest agent bound to the running server, one request at a time.
 *
 *     await request().get('/tasks').expect(200);
 */
export function request(instance?: Henri): Supertest.Agent;

/** The same, keeping the cookies between requests (a logged-in session). */
export function agent(instance?: Henri): Supertest.Agent;

/** The supertest module, so a test needs no dependency of its own. */
export const supertest: typeof Supertest;

/**
 * The running instance: the one `setup()` booted, or `global.henri`.
 * `undefined` before the first boot.
 */
export const henri: Henri | undefined;
