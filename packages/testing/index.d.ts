// Type definitions for @usehenri/testing
//
// Hand-written; see packages/core/index.d.ts for the rest of the API.

import type Supertest from 'supertest';
import type { Henri, Job, JobFilter } from '@usehenri/core';

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

/** One message the application was asked to send, as `inbox()` hands it out. */
export interface Mail {
  /** The mailer action that rendered it (`confirm`), when one did. */
  action: string | null;
  bcc: string[];
  cc: string[];
  /** True when it went through `deliverLater()` rather than `deliver()`. */
  deferred: boolean;
  from: string | null;
  html: string | null;
  /** The mailer that rendered it (`welcome`), when one did. */
  mailer: string | null;
  /** The nodemailer payload itself: attachments, headers, everything. */
  message: Record<string, any>;
  /** What `deliverLater()` was called with (`wait`, `at`, `queue`). */
  options: Record<string, any>;
  subject: string | null;
  text: string | null;
  to: string[];
}

/**
 * What `inbox()` keeps. A string is compared (an address without its case),
 * a regular expression is tested, and anything a filter cannot say is a
 * predicate: `inbox((mail) => mail.text.includes('reset'))`.
 */
export interface MailFilter {
  action?: string | RegExp;
  deferred?: boolean;
  mailer?: string | RegExp;
  subject?: string | RegExp;
  to?: string | RegExp;
}

/**
 * The mail the application was asked to send, oldest first: both what
 * `deliver()` handed to the transport and what `deliverLater()` handed to
 * the queue.
 *
 *     expect(inbox()).toHaveLength(1);
 *     expect(inbox({ to: user.email })[0].subject).toBe('Confirm your address');
 */
export function inbox(filter?: MailFilter | ((mail: Mail) => boolean)): Mail[];

/**
 * Empty the inbox. `@usehenri/testing/setup-file` calls it before every
 * test; `false` means there was no running application to empty.
 */
export function clearInbox(): boolean;

/** What `enqueued()` and `clearJobs()` filter on, which is what the queue takes. */
export interface EnqueuedFilter extends Omit<JobFilter, 'state'> {
  /** `null` asks for every state. `enqueued()` defaults to `'pending'`. */
  state?: JobFilter['state'] | null;
}

/**
 * The jobs the queue is holding: `pending` ones by default, which is what
 * "enqueued" means. Needs `@usehenri/jobs`, and says so when the
 * application has no queue (`HENRI_JOB_QUEUE_UNAVAILABLE`).
 *
 *     const [job] = await enqueued('report');
 *
 *     expect(job.args).toEqual({ month: '2026-08' });
 */
export function enqueued(filter?: string | EnqueuedFilter): Promise<Job[]>;

/** Forget the jobs the queue is holding, whatever their state. */
export function clearJobs(filter?: string | EnqueuedFilter): Promise<number>;

/** What a factory's value function is given. */
export interface FactoryContext {
  /**
   * The attributes resolved so far. A field the definition declares and
   * nothing has read yet answers a promise of it, so `await attrs.eventId`
   * reads the same either way.
   */
  attrs: Record<string, any>;
  /** A nested `build()`, counted against the nesting limit. */
  build(name: string, ...args: FactoryArgument[]): Promise<FactoryAttributes>;
  /** A nested `create()`, counted against the nesting limit. */
  create(name: string, ...args: FactoryArgument[]): Promise<any>;
  /** How many records this factory has made in this process, from 1. */
  sequence: number;
  /** The traits this record is being made with. */
  traits: string[];
  /** Four characters of this process's own, for a unique column. */
  uid: string;
}

/** A field of a factory: a value, or what answers one. */
export type FactoryValue =
  unknown | ((context: FactoryContext) => unknown | Promise<unknown>);

/** The fields a factory fills in. */
export type FactoryAttributes = Record<string, FactoryValue>;

/** `test/factories/<name>.js` exports one of these. */
export interface FactoryDefinition {
  /** Runs once the record is saved; what it returns replaces it. */
  after?(record: any, context: FactoryContext): unknown | Promise<unknown>;
  /** The fields, each a value or a function of the build context. */
  attributes: FactoryAttributes;
  /** The model to write to (the factory's own name by default). */
  model?: string;
  /** Named override groups: `create('proposal', 'accepted')`. */
  traits?: Record<string, FactoryAttributes>;
}

/** A trait name, or an object of overrides. */
export type FactoryArgument = string | Record<string, unknown>;

/**
 * The attributes a valid record would have, without saving one. The
 * associations are still made unless the caller gives the field.
 *
 *     await request().post('/proposals').send(await build('proposal'));
 */
export function build(
  name: string,
  ...args: FactoryArgument[]
): Promise<FactoryAttributes>;

/**
 * A saved record, with the fields the test does not care about filled in.
 *
 *     const proposal = await create('proposal', 'accepted', { title: 'A talk' });
 */
export function create(name: string, ...args: FactoryArgument[]): Promise<any>;

/** `count` saved records, one after the other. */
export function createList(
  name: string,
  count: number,
  ...args: FactoryArgument[]
): Promise<any[]>;

/**
 * Declares a factory without a file. It wins over
 * `test/factories/<name>.js`, whatever order they arrive in.
 */
export function defineFactory(
  name: string,
  definition: FactoryDefinition
): FactoryDefinition;

/** Forgets every definition and every sequence. */
export function resetFactories(): void;
