const BaseModule = require('../base/module');
const Henri = require('../henri');
const Model = require('../3.model');

let henri;

describe('models', () => {
  beforeAll(async () => {
    henri = new Henri({
      runlevel: 3,
    });
    await henri.init();
  });

  afterAll(async () => {
    await henri.stop();
  });

  test('should be defined', () => {
    expect(henri.model).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(henri.model).toBeInstanceOf(BaseModule);
  });

  test('should match snapshot', () => {
    const model = new Model();

    expect(model).toMatchSnapshot();
  });
  describe('errors()', () => {
    test('normalizes a Mongoose validation error', async () => {
      const error = await global.User.create({}).catch((thrown) => thrown);

      expect(error.name).toBe('ValidationError');
      expect(henri.model.errors(error)).toEqual({
        email: expect.stringContaining('required'),
        password: expect.stringContaining('required'),
      });
    });

    test('normalizes the MongoDB duplicate key error', () => {
      const error = Object.assign(
        new Error(
          'E11000 duplicate key error collection: henri.users index: email_1 dup key: { email: "a@b.co" }'
        ),
        {
          code: 11000,
          keyPattern: { email: 1 },
          keyValue: { email: 'a@b.co' },
          name: 'MongoServerError',
        }
      );

      expect(henri.model.errors(error)).toEqual({ email: 'must be unique' });
      delete error.keyPattern;
      delete error.keyValue;
      expect(henri.model.errors(error)).toEqual({ email: 'must be unique' });
    });

    test('normalizes the Sequelize unique constraint error', () => {
      const error = Object.assign(new Error('Validation error'), {
        errors: [{ message: 'email must be unique', path: 'email' }],
        name: 'SequelizeUniqueConstraintError',
      });

      expect(henri.model.errors(error)).toEqual({
        email: 'email must be unique',
      });
    });

    test('normalizes the Sequelize array of errors', () => {
      const error = Object.assign(new Error('Validation error'), {
        errors: [
          { message: 'name cannot be null', path: 'name', type: 'notNull' },
          { message: 'email must be unique', path: 'email' },
        ],
        name: 'SequelizeValidationError',
      });

      expect(henri.model.errors(error)).toEqual({
        email: 'email must be unique',
        name: 'name cannot be null',
      });
    });

    test('normalizes the Drizzle validation error', () => {
      const error = Object.assign(new Error('Task validation failed'), {
        errors: {
          name: {
            kind: 'required',
            message: 'is required',
            path: 'name',
            value: undefined,
          },
        },
        name: 'ValidationError',
      });

      expect(henri.model.errors(error)).toEqual({ name: 'is required' });
    });

    test('files an error without a field under base', () => {
      const error = Object.assign(new Error('nope'), {
        name: 'ValidationError',
      });

      expect(henri.model.errors(error)).toEqual({ base: 'nope' });
    });

    test('answers null for anything else', () => {
      expect(henri.model.errors(new Error('boom'))).toBeNull();
      expect(
        henri.model.errors(
          Object.assign(new Error('cast'), { name: 'CastError' })
        )
      ).toBeNull();
      expect(henri.model.errors(null)).toBeNull();
      expect(henri.model.errors('nope')).toBeNull();
    });
  });
}, 20000);
