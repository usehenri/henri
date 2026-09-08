// The *generated* declarations, checked.
//
// `generated.d.ts` next to this file is the real output of
// `@usehenri/core`'s `base/types.js` over the application in
// `packages/cli/__tests__/fixtures/types-app`, written by `henri types` and
// kept byte identical by `packages/cli/__tests__/types.spec.js`. So the
// lines below are not a description of what the generator ought to write:
// they compile against what it does write.
//
// A line marked `@ts-expect-error` must fail to compile. tsc reports the
// comment itself when the code under it turns out to be valid, so a
// generator that stopped catching a mistake fails this run.

/** Asserts that a value has the expected type. */
declare function expectGenerated<Expected>(value: Expected): void;

// ---------------------------------------------------------------------------
// The columns of a model are the columns of its model file
// ---------------------------------------------------------------------------

declare const task: TaskRecord;

expectGenerated<string>(task.title);
expectGenerated<string | null>(task.body);
expectGenerated<string>(task.externalId);
expectGenerated<string>(task.slug);
expectGenerated<Date>(task.createdAt);
expectGenerated<Date | null>(task.deletedAt);
expectGenerated<number | null>(task.points);
expectGenerated<boolean>(task.urgent);

// A `decimal` and a `bigint` cross into JavaScript as strings, and the
// declarations say so rather than promising a number that cannot hold them
expectGenerated<string | null>(task.estimate);
expectGenerated<string | null>(task.reference);

// A column marked `personal: { expose: false }` is kept out of every answer
// henri builds and is on the record all the same
expectGenerated<string | null>(task.secret);

// A declared foreign key holds the target's key; what leaves is its externalId
expectGenerated<string | null>(task.ownerId);

// @ts-expect-error a column this model does not have
task.titel;

// @ts-expect-error a column of another model
task.email;

// ---------------------------------------------------------------------------
// An enum column is the union of its values
// ---------------------------------------------------------------------------

expectGenerated<'draft' | 'in_review' | 'live'>(task.status);
expectGenerated<boolean>(task.isDraft());
expectGenerated<boolean>(task.isInReview());
expectGenerated<Record<string, any>>(Task.live());
expectGenerated<readonly ('draft' | 'in_review' | 'live')[]>(Task.enums.status);

// @ts-expect-error `published` is not one of the three values
task.status = 'published';

// @ts-expect-error the predicate of a value this column does not have
task.isPublished();

// @ts-expect-error a scope of a value this column does not have. The fixture
// is on a drizzle store, whose model class is henri's own: the statics of
// such a model are closed, so a name nothing put there is an error
Task.published();

// ---------------------------------------------------------------------------
// The statics: what henri guarantees everywhere, and what this adapter adds
// ---------------------------------------------------------------------------

const found = async () => {
  const one = await Task.findById('018f...');

  // Strict null checks: `findById()` answers null for an unknown id
  // @ts-expect-error `one` may be null
  one.title;

  if (one) {
    expectGenerated<string>(one.title);
    // @ts-expect-error still not a column of Task
    one.titel;
  }

  const page = await Task.paginate({ page: 1, perPage: 20 });

  expectGenerated<number>(page.total);
  expectGenerated<TaskRecord[]>(page.records);
  expectGenerated<string>(page.records[0].title);

  const named = await Task.findBySlug('ship-it');

  named && expectGenerated<string>(named.slug);

  // What the *adapter* of this store adds. The fixture is on drizzle, whose
  // model class is henri's own rather than an ORM's, so it is described
  // exactly: `find()` resolves, `where()` chains and the chain resolves
  expectGenerated<TaskRecord[]>(await Task.find({ status: 'draft' }));
  expectGenerated<TaskRecord[]>(await Task.findAll({ status: 'draft' }));
  expectGenerated<TaskRecord[]>(await Task.where({ status: 'draft' }).limit(5));
  expectGenerated<TaskRecord | null>(
    await Task.where({ urgent: true }).first()
  );
  expectGenerated<number>(await Task.count({ urgent: true }));
  expectGenerated<TaskRecord[]>(
    await Task.query().where({ urgent: true }).order('title').limit(5)
  );
  expectGenerated<number>(
    (await Task.where({ urgent: true }).paginate()).total
  );

  // @ts-expect-error a drizzle `find()` is a promise, not a chain: `where()`
  // is the chain, and this is a TypeError at runtime
  Task.find().sort({ title: 1 });

  // @ts-expect-error the chain does not carry it either
  Task.where({ urgent: true }).sort();

  // @ts-expect-error a static this model does not have -- the typo the
  // index signature used to swallow
  Task.fnid('018f...');

  // @ts-expect-error Mongoose's, and this store is not on Mongoose
  await Task.aggregate([]);

  // @ts-expect-error Sequelize's
  await Task.findAndCountAll();
};

void found;

// ---------------------------------------------------------------------------
// The user model, and the columns the adapters add to it
// ---------------------------------------------------------------------------

declare const person: UserRecord;

expectGenerated<string>(person.email);
expectGenerated<Date | null>(person.confirmedAt);
expectGenerated<string | null>(person.name);
// Not selected by default: a record read the usual way does not carry it
expectGenerated<string | undefined>(person.password);
expectGenerated<Promise<boolean>>(person.hasRole('admin'));

// A model that opted out of both keeps neither
declare const note: NoteRecord;

expectGenerated<string | null>(note.body);

// @ts-expect-error `options: { externalId: false }`
note.externalId;

// @ts-expect-error `options: { timestamps: false }`
note.createdAt;

// ---------------------------------------------------------------------------
// The path helpers
// ---------------------------------------------------------------------------

import type { HenriView } from '@usehenri/react';
import { pathFor } from '@usehenri/inertia';

declare const view: HenriView;

view.pathFor('index_tasks_path');
view.pathFor('archive_tasks_path', '1');
view.getRoute('show_tasks_path');
pathFor({}, 'create_tasks_path');
// A namespaced route carries its namespace, slash and all
view.pathFor('index_admin/tasks_path');

// @ts-expect-error a helper this application does not have
view.pathFor('taks_path');

// @ts-expect-error `notes` is `only: ['index', 'show']`
view.pathFor('destroy_notes_path');

// @ts-expect-error the same union guards getRoute()
view.getRoute('index_task_path');

// @ts-expect-error and the curried form of the Inertia package
pathFor({}, 'create_task_path');
