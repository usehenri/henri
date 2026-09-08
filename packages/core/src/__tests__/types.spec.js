const fs = require('fs');
const path = require('path');

const {
  APIS,
  FILE,
  FORMAT,
  build,
  describe: describeApp,
  markerOf,
  render,
  stampOf,
} = require('../base/types');
const Henri = require('../henri');
const { columnsOf, settingsOf } = require('../base/openapi');
const { expand } = require('../base/routes');
const { loadModules } = require('../utils');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FIXTURE = path.join(
  ROOT,
  'packages',
  'cli',
  '__tests__',
  'fixtures',
  'types-app'
);

/** The configuration of the fixture application */
const config = () =>
  JSON.parse(
    fs.readFileSync(path.join(FIXTURE, 'config', 'default.json'), 'utf8')
  );

/** The fixture application, described the way `henri types` describes it */
const fixture = () =>
  build({
    config: config(),
    models: Object.values(loadModules(path.join(FIXTURE, 'app', 'models'))),
    routes: expand(require(path.join(FIXTURE, 'config', 'routes.js'))),
  });

/**
 * One model of a description, by name
 *
 * @param {object} description what `describe()` read
 * @param {string} name the model name
 * @returns {object} the model
 */
const modelOf = (description, name) =>
  description.models.find((model) => model.name === name);

/**
 * One column of a model, by name
 *
 * @param {object} model a described model
 * @param {string} name the column name
 * @returns {object} the column
 */
const columnOf = (model, name) =>
  model.columns.find((column) => column.name === name);

describe('base/types', () => {
  describe('the columns', () => {
    const { description } = fixture();
    const task = modelOf(description, 'Task');

    test('a required column is not nullable, and the rest are', () => {
      expect(columnOf(task, 'title').type).toBe('string');
      expect(columnOf(task, 'body').type).toBe('string | null');
    });

    test('a column with a default is never null', () => {
      expect(columnOf(task, 'urgent').type).toBe('boolean');
    });

    test('the two exact types cross as strings, like base/exact.js says', () => {
      expect(columnOf(task, 'estimate').type).toBe('string | null');
      expect(columnOf(task, 'reference').type).toBe('string | null');
    });

    test('a json column is `any`, and `any | null` is not written', () => {
      expect(columnOf(task, 'payload').type).toBe('any');
    });

    test('the columns the adapters add are there', () => {
      expect(columnOf(task, 'externalId').type).toBe('string');
      expect(columnOf(task, 'createdAt').type).toBe('Date');
      expect(columnOf(task, 'deletedAt').type).toBe('Date | null');
      expect(columnOf(task, 'slug').type).toBe('string');
    });

    test('a model that opted out of both carries neither', () => {
      const note = modelOf(description, 'Note');

      expect(columnOf(note, 'externalId')).toBeUndefined();
      expect(columnOf(note, 'createdAt')).toBeUndefined();
    });

    test('a field marked personal: { expose: false } is on the record', () => {
      // The mark is about the answers henri builds, not about storage
      expect(columnOf(task, 'secret').type).toBe('string | null');
      expect(columnOf(task, 'secret').documentation).toContain(
        'never in an answer'
      );
    });

    test('a declared foreign key says what it points at', () => {
      expect(columnOf(task, 'ownerId').documentation).toContain(
        'A declared reference to User'
      );
    });

    test('the user model gets what the adapters add to it', () => {
      const user = modelOf(description, 'User');

      expect(columnOf(user, 'email').type).toBe('string');
      expect(columnOf(user, 'confirmedAt').type).toBe('Date | null');
      // Not selected by default, so a record read the usual way lacks it
      expect(columnOf(user, 'password').optional).toBe(true);
      expect(user.user).toBe(true);
    });

    test('it reads a model the way base/openapi.js does', () => {
      // One traversal, borrowed rather than written twice
      const models = Object.values(
        loadModules(path.join(FIXTURE, 'app', 'models'))
      );
      const settings = settingsOf(config());

      for (const model of models) {
        const described = modelOf(description, model.globalId);
        const columns = Object.keys(columnsOf(model, settings)).sort();

        expect(described.columns.map(({ name }) => name)).toEqual(columns);
      }
    });
  });

  describe('the enums', () => {
    const { description, source } = fixture();
    const task = modelOf(description, 'Task');

    test('the column is the union of its values', () => {
      expect(columnOf(task, 'status').type).toBe(
        "'draft' | 'in_review' | 'live'"
      );
    });

    test('the predicates and the scopes are the ones base/enums.js makes', () => {
      expect(task.enums[0].methods.map(({ predicate }) => predicate)).toEqual([
        'isDraft',
        'isInReview',
        'isLive',
      ]);
      expect(source).toContain('  isInReview(): boolean;');
      expect(source).toContain(
        '  inReview(where?: Record<string, any>): Record<string, any>;'
      );
    });

    test('the list of values is typed', () => {
      expect(source).toContain(
        "    status: readonly ('draft' | 'in_review' | 'live')[];"
      );
    });
  });

  describe('the path helpers', () => {
    const { description, source } = fixture();

    test('every helper the routes expand to is a key', () => {
      const names = description.paths.map(({ name }) => name);

      expect(names).toContain('index_tasks_path');
      expect(names).toContain('archive_tasks_path');
      expect(names).toContain('home_main_path');
    });

    test('a namespaced helper is quoted, slash and all', () => {
      expect(source).toContain("  'index_admin/tasks_path': true;");
    });

    test('a helper is named once, whatever the verbs', () => {
      const names = description.paths.map(({ name }) => name);

      expect(new Set(names).size).toBe(names.length);
    });

    test('no route, no registry: pathFor() takes any string again', () => {
      const { source: empty } = build({ config: config(), models: [] });

      expect(empty).not.toContain('interface HenriPaths');
    });
  });

  describe('what it refuses to write', () => {
    test('a model whose name is not an identifier is skipped, not guessed', () => {
      const { description, source } = build({
        config: {},
        models: [{ globalId: 'my model', identity: 'my model', schema: {} }],
      });

      expect(description.models).toEqual([]);
      expect(description.skipped[0]).toEqual({
        name: 'my model',
        why: 'its name is not a TypeScript identifier',
      });
      expect(source).not.toContain('my model');
    });

    test('a model file that is not a model is skipped', () => {
      const { description } = build({ config: {}, models: [null, 42] });

      expect(description.skipped).toHaveLength(2);
    });

    test('a model with no schema is skipped', () => {
      const { description } = build({
        config: {},
        models: [{ globalId: 'Ghost', identity: 'ghost' }],
      });

      expect(description.skipped[0].why).toBe('it declares no schema');
    });

    test('a column name that cannot be a property is left out', () => {
      const { description } = build({
        config: {},
        models: [
          {
            globalId: 'Odd',
            identity: 'odd',
            options: { externalId: false, timestamps: false },
            schema: { "quo'te": { type: 'string' }, 'with space': 'string' },
          },
        ],
      });

      expect(
        modelOf(description, 'Odd').columns.map(({ name }) => name)
      ).toEqual(["'with space'"]);
      expect(description.skipped).toEqual([
        { name: "Odd.quo'te", why: 'its name cannot be written as a property' },
      ]);
    });

    test('an enum henri cannot write as a union is the plain type', () => {
      const { description } = build({
        config: {},
        models: [
          {
            globalId: 'Odd',
            identity: 'odd',
            options: { externalId: false, timestamps: false },
            schema: { kind: { enum: ['ok', { a: 1 }], type: 'string' } },
          },
        ],
      });

      // A partial union would refuse a value the column accepts
      expect(columnOf(modelOf(description, 'Odd'), 'kind').type).toBe(
        'string | null'
      );
    });

    test('what the caller could not read is part of the description', () => {
      // ... so a file written while a model was broken stops matching once
      // it is fixed
      const one = describeApp({ config: {}, models: [], skipped: [] });
      const two = describeApp({
        config: {},
        models: [],
        skipped: [{ name: 'app/models', why: 'boom' }],
      });

      expect(stampOf(one)).not.toBe(stampOf(two));
    });
  });

  describe('the file', () => {
    const { description, source } = fixture();

    test('it declares a global per model', () => {
      expect(source).toContain('declare const Task: TaskModel;');
      expect(source).toContain('declare const User: UserModel;');
    });

    test('a record extends the base of its store adapter', () => {
      expect(modelOf(description, 'Task').api).toBe('drizzle');
      expect(source).toContain(
        'interface TaskRecord extends HenriDrizzleRecord'
      );
    });

    test('a store henri does not know gets what the three have in common', () => {
      const { source: other } = build({
        config: { stores: { default: { adapter: 'unheard-of' } } },
        models: [
          {
            globalId: 'Thing',
            identity: 'thing',
            options: { externalId: false, timestamps: false },
            schema: { name: { type: 'string' } },
          },
        ],
      });

      expect(other).toContain('interface ThingRecord extends HenriRecordBase');
    });

    test('an interface extends a name, never an import type', () => {
      // `interface X extends import('...').Y` is not something TypeScript
      // accepts, which is what the aliases at the top are for
      expect(source).not.toMatch(/extends\s+import\(/u);
    });

    test('the marker carries the format and a digest of the description', () => {
      expect(markerOf(source)).toEqual({
        app: stampOf(description),
        format: FORMAT,
      });
    });

    test('the same description renders the same bytes', () => {
      expect(render(description)).toBe(source);
    });

    test('a description that changed changes the digest', () => {
      const { description: other } = build({ config: config(), models: [] });

      expect(stampOf(other)).not.toBe(stampOf(description));
    });

    test('it goes into .henri/, next to the globals the linter reads', () => {
      expect(FILE).toBe('.henri/types.d.ts');
    });
  });

  describe('against the running application', () => {
    const skipWorkers = process.env.SKIP_WORKERS;
    let henri;
    let live;

    beforeAll(async () => {
      process.env.SKIP_WORKERS = '1';
      henri = new Henri();
      await henri.init();
      global.henri = henri;
      live = henri.router.types();
    }, 60000);

    afterAll(async () => {
      await henri.stop();
      delete global.henri;

      if (typeof skipWorkers === 'undefined') {
        delete process.env.SKIP_WORKERS;
      } else {
        process.env.SKIP_WORKERS = skipWorkers;
      }
    }, 60000);

    test('the booted router describes the models it loaded', () => {
      const names = live.description.models.map(({ name }) => name);

      expect(names).toContain('Article');
      expect(names).toContain('Memo');
      expect(live.source).toContain('declare const Memo: MemoModel;');
      // The demo application is on the disk adapter, which is mongoose
      expect(modelOf(live.description, 'Memo').api).toBe('mongoose');
      expect(live.source).toContain(
        'interface MemoRecord extends HenriMongooseRecord'
      );
    });

    test('and the path helpers it registered', () => {
      const names = live.description.paths.map(({ name }) => name);

      expect(names).toContain('home_main_path');
      expect(names).toContain('index_artwork_path');
    });

    test('both ways of building it read the same declarations', () => {
      // `henri types` reads the files and the router reads what it booted;
      // the same model files and the same expanded routes go in, so the
      // same bytes have to come out
      const { source } = build({
        config: henri.config,
        models: henri.model.models,
        routes: Object.values(henri.router.routes),
      });

      expect(source).toBe(live.source);
    });

    test('nothing is written in a test process', () => {
      // The demo application is what core's own suite boots, and a suite
      // that wrote into it would race every other file
      expect(henri.router.writeTypes()).toBe(false);
      expect(fs.existsSync(path.join(henri.cwd(), FILE))).toBe(false);
    });
  });

  test('the adapters it knows are the ones the generators know', () => {
    // `packages/cli/scripts/adapters.js` maps an adapter to a model API for
    // the generators; this file maps it to a record base. An adapter added
    // to one has to be added to the other
    const cli = require(
      path.join(ROOT, 'packages', 'cli', 'scripts', 'adapters.js')
    );

    expect(APIS).toEqual(cli.APIS);
  });
});
