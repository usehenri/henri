// The declaration of a drizzle model, kept honest against the class.
//
// `henri types` writes `interface TaskModel extends
// HenriDrizzleModelStatics<TaskRecord>` for every model of a drizzle store,
// and `DrizzleModelStatics` in `packages/core/index.d.ts` is **closed**: it
// has no index signature, so `Task.fnid()` is a compile error rather than an
// `any` that answers `undefined`.
//
// Closing it is only honest while it lists what the class actually has. This
// file is what makes that true: it builds a model, reads the statics off it,
// and compares them with the names the interface declares. A static added to
// `model.js` without a line in `index.d.ts` fails here, and so does a line in
// `index.d.ts` for a static the class does not have.
//
// The two adapters whose model surface belongs to an ORM -- Mongoose and
// Sequelize -- keep their index signature and have no equivalent of this
// file, deliberately: their names are not henri's to enumerate.
const fs = require('fs');
const path = require('path');

const { build, taskModel, userModel } = require('./helpers');

/** Where the hand-written declarations live */
const DECLARATIONS = path.join(
  path.dirname(require.resolve('@usehenri/core/package.json')),
  'index.d.ts'
);

/** What a class carries, its prototype chain included */
const surfaceOf = (target) => {
  const found = new Set();
  let current = target;

  while (
    current &&
    current !== Object.prototype &&
    current !== Function.prototype
  ) {
    for (const key of Object.getOwnPropertyNames(current)) {
      found.add(key);
    }

    current = Object.getPrototypeOf(current);
  }

  // What every class and every object has, which no interface declares
  for (const key of ['constructor', 'length', 'name', 'prototype']) {
    found.delete(key);
  }

  return found;
};

/**
 * The members one interface of `index.d.ts` declares.
 *
 * A four space indent is a member; a continuation of a signature broken over
 * several lines is indented deeper or starts with a bracket, and a comment
 * starts with a slash -- none of which begin with an identifier.
 *
 * @param {string} source the file
 * @param {string} name the interface
 * @returns {Set<string>} the member names
 */
const membersOf = (source, name) => {
  const opening = new RegExp(`^  interface ${name}<[^\\n]*\\{$`, 'mu');
  const at = source.search(opening);

  expect(at).toBeGreaterThan(-1);

  const body = source.slice(at).split('\n').slice(1);
  const members = new Set();

  for (const line of body) {
    if (line === '  }') {
      return members;
    }

    const member = /^ {4}(?:readonly )?([A-Za-z_$][\w$]*)\s*[(?:<]/u.exec(line);

    member && members.add(member[1]);
  }

  throw new Error(`interface ${name} does not end`);
};

describe('the declarations of a drizzle model', () => {
  const source = fs.readFileSync(DECLARATIONS, 'utf8');
  let Task;
  let User;

  beforeAll(async () => {
    const { adapter } = build();

    adapter.addModel(taskModel);
    adapter.addModel(userModel, 'user');
    await adapter.start();
    ({ Task, User } = adapter.getModels());
  });

  test('DrizzleModelStatics declares every static the class has', () => {
    const declared = new Set([
      ...membersOf(source, 'ModelGuarantees'),
      ...membersOf(source, 'DrizzleModelStatics'),
    ]);
    const missing = [...surfaceOf(Task)].filter((name) => !declared.has(name));

    // A static the class has and the interface does not is a call that runs
    // and does not compile: the reason an open interface was the safe answer
    // before this one was closed
    expect(missing.sort()).toEqual([]);
  });

  test('and declares nothing the class does not have', () => {
    const surface = surfaceOf(Task);
    const invented = [...membersOf(source, 'DrizzleModelStatics')].filter(
      (name) => !surface.has(name)
    );

    expect(invented.sort()).toEqual([]);
  });

  test('the statics are the same whatever the model declares', () => {
    // What makes one interface enough for every model: the class carries the
    // same statics whether or not a model is paranoid, slugged, versioned or
    // the user model. `setRoles` is the one exception, and `henri types`
    // writes it into the model interface of the user model alone
    expect([...surfaceOf(User)].filter((name) => name !== 'setRoles').sort()) //
      .toEqual([...surfaceOf(Task)].sort());
    expect(surfaceOf(Task).has('setRoles')).toBe(false);
  });

  test('DrizzleRelation declares every method of the chain', () => {
    const relation = Task.where({});
    // `then` comes from PromiseLike, which the interface extends
    const declared = new Set([...membersOf(source, 'DrizzleRelation'), 'then']);
    const surface = new Set([
      ...surfaceOf(Object.getPrototypeOf(relation)),
      ...Object.getOwnPropertyNames(relation),
    ]);
    const missing = [...surface].filter((name) => !declared.has(name));
    const invented = [...declared].filter(
      (name) => name !== 'then' && !surface.has(name)
    );

    expect(missing.sort()).toEqual([]);
    expect(invented.sort()).toEqual([]);
  });
});
