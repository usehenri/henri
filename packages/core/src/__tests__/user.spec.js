const BaseModule = require('../base/module');
const Henri = require('../henri');
const User = require('../4.user');

let henri;

const email = 'testing@usehenri.io';
const password = 'delectorskaya';

describe('user', () => {
  describe('basic', () => {
    beforeAll(async () => {
      henri = new Henri({ runlevel: 4 });
      await henri.init();
    }, 60000);

    afterAll(async () => {
      await henri.stop();
    }, 60000);

    test('should be defined', () => {
      expect(henri.user).toBeDefined();
    }, 15000);

    test('should extend BaseModule', () => {
      expect(henri.user).toBeInstanceOf(BaseModule);
    }, 15000);

    test('should match snapshot', () => {
      const controllers = new User();

      expect(controllers).toMatchSnapshot();
    }, 15000);

    test('encryption', async () => {
      const { encrypt } = henri.user;
      let hash = await encrypt(password);

      expect(hash).not.toBe(password);
      await expect(encrypt()).rejects.toBeDefined();
      await expect(encrypt('lydia')).rejects.toBeDefined();
      await expect(encrypt(password)).resolves.toBeDefined();
    }, 15000);

    test('a password below the policy is a validation failure', async () => {
      const error = await henri.user.encrypt('lydia').catch((thrown) => thrown);

      // The shape every adapter rejects an invalid write with, so a
      // controller answers 422 next to the field instead of 500
      expect(error.name).toBe('ValidationError');
      expect(error.codes).toEqual(['too_short']);
      expect(henri.model.errors(error)).toEqual({
        password: expect.stringContaining('at least'),
      });

      const missing = await henri.user.encrypt().catch((thrown) => thrown);

      expect(missing.codes).toEqual(['missing']);
      expect(henri.model.errors(missing)).toEqual({
        password: 'a password is required',
      });
    }, 15000);

    test('compare', async () => {
      const { encrypt, compare } = henri.user;
      let hash = await encrypt(password);

      expect(hash).not.toBe(password);
      await expect(compare(password, hash)).resolves.toBe(true);
      await expect(compare('lydia', hash)).rejects.toBeDefined();
    });

    test('a wrong password and no account at all are the same answer', async () => {
      const user = await henri._user.create({
        email: `compare-${process.pid}@usehenri.io`,
        password,
      });
      const account = await henri.user.findByEmail(user.email);

      const wrong = await henri.user
        .compare('not-the-password', account)
        .catch((thrown) => thrown);
      const nobody = await henri.user
        .compare(password, null)
        .catch((thrown) => thrown);

      // Same words, same code: a caller handing either to a client says
      // exactly what it said before, and nothing about who has an account
      expect(wrong.message).toBe('Invalid credentials');
      expect(nobody.message).toBe(wrong.message);
      expect(nobody.code).toBe('HENRI_USER_PASSWORD_MISMATCH');
      expect(wrong.code).toBe(nobody.code);

      // ... and undefined goes with null, because that is what a lookup of
      // an application's own comes back as
      const missing = await henri.user
        .compare(password)
        .catch((thrown) => thrown);

      expect(missing.code).toBe(nobody.code);
    }, 20000);

    test('a record with no hash on it says so, rather than "wrong password"', async () => {
      const user = await henri._user.create({
        email: `hashless-${process.pid}@usehenri.io`,
        password,
      });
      // What findById(), req.user and a deserialized session all carry: the
      // password column is deselected, so the right password used to answer
      // "Invalid credentials" for ever
      const byId = await henri.user.findById(henri.user.adapter().userId(user));

      expect(byId).not.toBeNull();

      const error = await henri.user
        .compare(password, byId)
        .catch((thrown) => thrown);

      expect(error.code).toBe('HENRI_USER_PASSWORD_UNVERIFIABLE');
      expect(error.message).toContain('findByEmail');
    }, 20000);

    test('a second argument that is not a user is a wrong call', async () => {
      const error = await henri.user
        .compare(password, 42)
        .catch((thrown) => thrown);

      expect(error.code).toBe('HENRI_ARGUMENT_INVALID');
      expect(error.message).toContain('user.compare(user)');
    });

    test('an account nobody has costs what an account somebody has costs', async () => {
      const user = await henri._user.create({
        email: `timing-${process.pid}@usehenri.io`,
        password,
      });
      const account = await henri.user.findByEmail(user.email);

      /**
       * How long one refused comparison takes, in milliseconds
       *
       * @param {*} target the second argument
       * @returns {Promise<number>} the milliseconds
       */
      const time = async (target) => {
        const started = process.hrtime.bigint();

        await henri.user.compare('not-the-password', target).catch(() => null);

        return Number(process.hrtime.bigint() - started) / 1e6;
      };

      // Warm up, then interleave so a slow moment lands on both
      await time(account);
      await time(null);

      const known = [];
      const nobody = [];

      for (let round = 0; round < 9; round += 1) {
        known.push(await time(account));
        nobody.push(await time(null));
      }

      const middle = (values) =>
        [...values].sort((one, two) => one - two)[
          Math.floor(values.length / 2)
        ];

      // Both hash: the absent account is checked against `dummyHash`, bound
      // to a uuid no row has, so an application's own sign-in cannot be
      // timed to find out which addresses are registered
      expect(middle(nobody)).toBeGreaterThan(0.5);
      expect(Math.abs(middle(known) - middle(nobody))).toBeLessThan(25);
    }, 30000);

    test('a misspelled option is refused rather than silently unbound', async () => {
      const user = await henri._user.create({
        email: `binding-${process.pid}@usehenri.io`,
        password,
      });

      // It used to hash happily and write a hash bound to nothing, which is
      // the whole of config.user.password.binding gone with nothing said
      const error = await henri.user
        .encrypt(password, { identiy: user })
        .catch((thrown) => thrown);

      expect(error.code).toBe('HENRI_ARGUMENT_INVALID');
      expect(error.message).toContain('options.identity');

      expect(henri.user.bindsPasswords()).toBe(true);
      expect(await henri.user.encrypt(password, { identity: user })).toContain(
        '$henri-bound$'
      );
    }, 20000);

    test('publicUser answers nobody for nobody and refuses what is not a record', () => {
      expect(henri.user.publicUser(null)).toBeNull();
      expect(henri.user.publicUser()).toBeNull();

      // It used to answer { id: 'undefined', roles: [] }, and that object
      // goes to a view and to a JSON body
      let error;

      try {
        henri.user.publicUser(42);
      } catch (thrown) {
        error = thrown;
      }

      expect(error.code).toBe('HENRI_ARGUMENT_INVALID');
    });
  }, 30000);

  describe.skip('with user object', () => {
    beforeAll(async () => {
      henri = new Henri();
      await henri.init();
    });

    afterAll(async () => {
      await henri._user.destroy({});
      await henri.stop();
    });

    test('should have login', async () => {
      expect(henri.passport).toBeDefined();

      let res = await fetch(`${henri.server.url}login`, {
        method: 'POST',
      }).then((res) => res);

      expect(res.status).toEqual(400);
    });

    test.skip('should login', async () => {
      await henri._user.destroy({ email });

      let res = await fetch(`${henri.server.url}register`, {
        body: JSON.stringify({ email, password }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }).then((res) => res.json());

      expect(res).toEqual({ status: 'ok' });
    });
  });
}, 16000);
