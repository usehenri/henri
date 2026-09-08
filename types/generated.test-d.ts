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

// A *scope* that does not exist is deliberately not an error: a model stays
// open, because the three ORMs put their own statics there (see the note
// under "The statics henri guarantees" below)
Task.published();

// ---------------------------------------------------------------------------
// The statics henri guarantees on every adapter
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

  // The ORM's own surface stays open: three adapters answer three different
  // things to `find()`, so what henri does not own is `any` rather than an
  // error in code that runs
  await Task.findAll({ where: { status: 'draft' } });
  await Task.where({ status: 'draft' }).limit(5);
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
