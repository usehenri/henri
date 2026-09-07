const fs = require('fs');
const path = require('path');

const {
  KEYS,
  MASS_WRITE,
  UNCHECKED,
  massWrite,
  problemsOf,
  uncheckedWrite,
  validationsOf,
  wantsRecord,
} = require('../base/validations');

/** A model file, in the shape core hands the adapters */
const model = (schema, validates) => ({
  globalId: 'Thing',
  identity: 'thing',
  schema,
  validates,
});

/** The rules of a model file, compiled */
const rulesOf = (schema, validates) => validationsOf(model(schema, validates));

describe('model validations', () => {
  describe('the copies in the adapters', () => {
    // Each adapter holds its own, the way `exact.js` and `external-id.js`
    // are held: an adapter depends on no part of core at runtime. Nothing
    // but this test keeps them the same file.
    const root = path.join(__dirname, '..', '..', '..');
    const source = fs.readFileSync(
      path.join(root, 'core', 'src', 'base', 'validations.js'),
      'utf8'
    );

    for (const adapter of ['drizzle', 'mongoose', 'sequelize']) {
      test(`@usehenri/${adapter} carries the same file, byte for byte`, () => {
        const copy = fs.readFileSync(
          path.join(root, adapter, 'validations.js'),
          'utf8'
        );

        expect(copy).toBe(source);
      });

      test(`@usehenri/${adapter} publishes it`, () => {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(root, adapter, 'package.json'), 'utf8')
        );

        expect(manifest.files).toContain('validations.js');
      });
    }

    test('it reaches for nothing but its neighbour', () => {
      // A copy sits at the root of an adapter, next to that adapter's own
      // `exact.js`, so the one require it makes has to resolve there too
      expect(source.match(/require\('[^']+'\)/gu)).toEqual([
        "require('./exact')",
      ]);
    });
  });

  describe('the vocabulary', () => {
    test('is the one a params block already uses', () => {
      expect(KEYS).toEqual([
        'enum',
        'max',
        'maxLength',
        'min',
        'minLength',
        'pattern',
        'required',
        'validate',
      ]);
    });

    test('a model that declares nothing has no rules', () => {
      expect(rulesOf({ name: 'string' })).toBeNull();
      expect(validationsOf({})).toBeNull();
    });

    test("the schema's own required and enum are rules", () => {
      const rules = rulesOf({
        name: { required: true, type: 'string' },
        note: 'text',
        status: { enum: ['draft', 'live'], type: 'string' },
      });

      expect(Object.keys(rules)).toEqual(['name', 'status']);
      expect(rules.name).toEqual({ required: true, type: 'string' });
      expect(rules.status).toEqual({
        enum: ['draft', 'live'],
        type: 'string',
      });
    });

    test('and so is the Sequelize spelling both adapters accept', () => {
      const rules = rulesOf({ name: { allowNull: false, type: 'string' } });

      expect(rules.name).toEqual({ required: true, type: 'string' });
    });

    test('a validates entry is merged over them', () => {
      const rules = rulesOf(
        { name: { required: true, type: 'string' } },
        { name: { maxLength: 10, required: false } }
      );

      expect(rules.name).toEqual({
        maxLength: 10,
        required: false,
        type: 'string',
      });
    });
  });

  describe('what fails the boot', () => {
    const refused = (schema, validates) => {
      try {
        rulesOf(schema, validates);
      } catch (error) {
        return error;
      }

      return null;
    };

    test('a rule for a field the schema has no column for', () => {
      const error = refused({ name: 'string' }, { nmae: { maxLength: 2 } });

      expect(error.code).toBe('HENRI_MODEL_VALIDATION_INVALID');
      expect(error.message).toMatch(/which its schema has no field for: name/u);
    });

    test('an unknown key', () => {
      const error = refused({ name: 'string' }, { name: { lenght: 2 } });

      expect(error.code).toBe('HENRI_MODEL_VALIDATION_INVALID');
      expect(error.message).toMatch(/the unknown key "lenght"/u);
    });

    test('a constraint the type does not take', () => {
      expect(refused({ name: 'string' }, { name: { min: 2 } }).message).toMatch(
        /"min", which a string does not take: min is for bigint, decimal/u
      );
      expect(
        refused({ age: 'integer' }, { age: { maxLength: 2 } }).message
      ).toMatch(/"maxLength", which an integer does not take/u);
    });

    test('a bound on a type henri did not bring', () => {
      const error = refused(
        { author: { ref: 'User', type: 'ObjectId' } },
        { author: { maxLength: 2 } }
      );

      expect(error.message).toMatch(/which needs a type henri knows/u);
    });

    test('but presence and inclusion need no type at all', () => {
      const rules = rulesOf(
        { author: { ref: 'User', type: 'ObjectId' } },
        { author: { required: true } }
      );

      expect(rules.author).toEqual({ required: true, type: null });
    });

    test('a bound, a pattern or a validate of the wrong shape', () => {
      expect(
        refused({ age: 'integer' }, { age: { min: '2' } }).message
      ).toMatch(/a "min" that is not a number/u);
      expect(
        refused({ name: 'string' }, { name: { pattern: 'a' } }).message
      ).toMatch(/a "pattern" that is not a regular expression/u);
      expect(
        refused({ name: 'string' }, { name: { validate: 'yes' } }).message
      ).toMatch(/a "validate" that is not a function/u);
      expect(
        refused({ name: 'string' }, { name: { required: 'yes' } }).message
      ).toMatch(/a "required" that is not true or false/u);
      expect(
        refused({ name: 'string' }, { name: { enum: [] } }).message
      ).toMatch(/an "enum" that is not a list of values/u);
      expect(refused({ name: 'string' }, { name: 'string' }).message).toMatch(
        /a rule is an object of enum, max/u
      );
    });

    test('a validates block that is not an object', () => {
      expect(() =>
        validationsOf({ globalId: 'Thing', schema: {}, validates: 4 })
      ).toThrow(/declares `validates` as number/u);
    });

    test('an exact bound may be written out, the way its values are', () => {
      const rules = rulesOf(
        { price: { precision: 12, scale: 2, type: 'decimal' } },
        { price: { max: '99999999.99', min: '0.01' } }
      );

      expect(rules.price.min).toBe('0.01');
    });
  });

  describe('running the rules', () => {
    const rules = rulesOf(
      {
        age: 'integer',
        name: { required: true, type: 'string' },
        price: { precision: 12, scale: 2, type: 'decimal' },
        slug: 'string',
        status: { enum: ['draft', 'live'], type: 'string' },
      },
      {
        age: { max: 120, min: 18 },
        price: { max: '100.00' },
        slug: { maxLength: 5, minLength: 2, pattern: /^[a-z-]+$/u },
      }
    );

    test('nothing wrong is null', () => {
      expect(problemsOf(rules, { age: 20, name: 'a', slug: 'ok' })).toBeNull();
      expect(problemsOf(null, { name: null })).toBeNull();
    });

    test('presence is Rails’ presence', () => {
      expect(problemsOf(rules, {})).toEqual({ name: 'is required' });
      expect(problemsOf(rules, { name: null })).toEqual({
        name: 'is required',
      });
      expect(problemsOf(rules, { name: '   ' })).toEqual({
        name: 'is required',
      });
      expect(problemsOf(rules, { name: '' })).toEqual({ name: 'is required' });
    });

    test('an update leaves a field it does not name alone', () => {
      expect(problemsOf(rules, { age: 20 }, { partial: true })).toBeNull();
      expect(problemsOf(rules, { name: null }, { partial: true })).toEqual({
        name: 'is required',
      });
    });

    test('the bounds, the length, the shape and the list', () => {
      expect(problemsOf(rules, { age: 2, name: 'a' })).toEqual({
        age: 'must be at least 18',
      });
      expect(problemsOf(rules, { age: 900, name: 'a' })).toEqual({
        age: 'must be at most 120',
      });
      expect(problemsOf(rules, { name: 'a', slug: 'a' })).toEqual({
        slug: 'must be at least 2 characters',
      });
      expect(problemsOf(rules, { name: 'a', slug: 'abcdefg' })).toEqual({
        slug: 'must be at most 5 characters',
      });
      expect(problemsOf(rules, { name: 'a', slug: 'AB' })).toEqual({
        slug: 'is not in the expected format',
      });
      expect(problemsOf(rules, { name: 'a', status: 'nope' })).toEqual({
        status: 'must be one of draft, live',
      });
    });

    test('an exact bound is compared digit by digit, not through a double', () => {
      expect(problemsOf(rules, { name: 'a', price: '99.99' })).toBeNull();
      expect(problemsOf(rules, { name: 'a', price: '100.01' })).toEqual({
        price: 'must be at most 100.00',
      });
      // The comparison a string would get letter by letter, and does not
      expect(problemsOf(rules, { name: 'a', price: '9.99' })).toBeNull();
    });

    test('a null value is checked by required and by nothing else', () => {
      expect(problemsOf(rules, { age: null, name: 'a' })).toBeNull();
      expect(problemsOf(rules, { name: 'a', status: null })).toBeNull();
    });

    test('every field is reported, not the first', () => {
      expect(problemsOf(rules, { age: 1, slug: 'AB', status: 'x' })).toEqual({
        age: 'must be at least 18',
        name: 'is required',
        slug: 'is not in the expected format',
        status: 'must be one of draft, live',
      });
    });
  });

  describe('a validator of one’s own', () => {
    test('false is a failure, a string is the message, true is a pass', () => {
      const rules = rulesOf(
        { name: 'string' },
        { name: { validate: (value) => value !== 'no' } }
      );

      expect(problemsOf(rules, { name: 'yes' })).toBeNull();
      expect(problemsOf(rules, { name: 'no' })).toEqual({ name: 'is invalid' });

      const said = rulesOf(
        { name: 'string' },
        { name: { validate: (value) => value === 'ok' || 'must say ok' } }
      );

      expect(problemsOf(said, { name: 'no' })).toEqual({
        name: 'must say ok',
      });
    });

    test('a throw is the message, so a validator never becomes a 500', () => {
      const rules = rulesOf(
        { name: 'string' },
        {
          name: {
            validate: () => {
              throw new Error('exploded');
            },
          },
        }
      );

      expect(problemsOf(rules, { name: 'x' })).toEqual({ name: 'exploded' });
    });

    test('it is never asked about a value that is not there', () => {
      const asked = [];
      const rules = rulesOf(
        { name: 'string' },
        {
          name: {
            validate: (value) => {
              asked.push(value);

              return true;
            },
          },
        }
      );

      problemsOf(rules, { name: null });
      problemsOf(rules, {});
      expect(asked).toEqual([]);
    });

    test('a second parameter is a request for the record', () => {
      const rules = rulesOf(
        { body: 'text', status: { enum: ['draft', 'live'], type: 'string' } },
        {
          status: {
            validate: (value, record) =>
              value !== 'live' || Boolean(record.body) || 'needs a body first',
          },
        }
      );

      expect(wantsRecord(rules)).toEqual(['status']);
      expect(wantsRecord(rules, { body: 'x' })).toEqual([]);
      expect(
        problemsOf(rules, { status: 'live' }, { record: { body: '' } })
      ).toEqual({ status: 'needs a body first' });
      expect(
        problemsOf(rules, { status: 'live' }, { record: { body: 'here' } })
      ).toBeNull();
    });

    test('a validator that only reads the value never refuses a mass write', () => {
      const rules = rulesOf(
        { name: 'string' },
        { name: { validate: (value) => value !== 'no' } }
      );

      expect(wantsRecord(rules)).toEqual([]);
    });
  });

  describe('the refusals', () => {
    test('a mass write names the model, the fields and the loop', () => {
      const error = massWrite('Post', 'update', 'update(attrs)', ['status']);

      expect(error.code).toBe(MASS_WRITE);
      expect(error.message).toMatch(/status of Post is validated by a rule/u);
      expect(error.message).toMatch(
        /for \(const record of await Post\.find\(where\)\) await record\.update\(attrs\)/u
      );
    });

    test('an unreachable write names the call and what to do instead', () => {
      const error = uncheckedWrite('Post', 'bulkWrite', 'Use create().');

      expect(error.code).toBe(UNCHECKED);
      expect(error.message).toMatch(/Post\.bulkWrite\(\) writes without/u);
      expect(error.message).toMatch(/Use create\(\)\./u);
    });
  });
});
