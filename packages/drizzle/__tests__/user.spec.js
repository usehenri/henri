const { build, userModel } = require('./helpers');

describe('user model overload', () => {
  let adapter;
  let henri;
  let User;

  beforeAll(async () => {
    ({ adapter, henri } = build({ baseRole: 'member' }));
    User = adapter.addModel(userModel, 'user');
    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
  });

  afterEach(async () => {
    await User.destroy();
  });

  test('flags the user model on henri and logs the base role', () => {
    expect(henri._user).toBe(User);
    expect(adapter.getModels().User).toBe(User);
    expect(User.hidden).toEqual(['password']);
    expect(henri.calls).toContainEqual([
      'info',
      'drizzle',
      'basic user role',
      ['member'],
    ]);
  });

  test('requires email and password, validates and normalizes the email', async () => {
    await expect(User.create({ name: 'nobody' })).rejects.toMatchObject({
      errors: {
        email: { message: 'is required' },
        password: { message: 'is required' },
      },
    });
    await expect(
      User.create({ email: 'nope', password: 'secret-1' })
    ).rejects.toMatchObject({
      errors: { email: { message: 'is not a valid email' } },
    });

    const user = await User.create({
      email: ' Grace@UseHenri.io ',
      name: 'Grace',
      password: 'compiler-1952',
    });

    expect(user.email).toBe('grace@usehenri.io');
    expect(user.password).toBeUndefined();
    expect(user.roles).toEqual(['member']);
    expect(JSON.parse(JSON.stringify(user)).password).toBeUndefined();
  });

  test('rejects duplicate (mixed-case) emails as a validation error', async () => {
    await User.create({
      email: 'grace@usehenri.io',
      password: 'compiler-1952',
    });

    await expect(
      User.create({ email: 'GRACE@usehenri.io', password: 'other-pass' })
    ).rejects.toMatchObject({
      errors: { email: { kind: 'unique', message: 'must be unique' } },
      name: 'ValidationError',
    });
  });

  test('hashes the password on create and on every update that sets it', async () => {
    const user = await User.create({ email: 'a@b.co', password: 'first-pass' });
    const stored = () => adapter.findUserByEmail('a@b.co');

    expect((await stored()).password).toBe('hashed:first-pass');

    await user.update({ name: 'renamed' });
    expect((await stored()).password).toBe('hashed:first-pass');

    await user.update({ password: 'second-pass' });
    expect((await stored()).password).toBe('hashed:second-pass');

    await User.findByIdAndUpdate(user.id, { password: 'third-pass' });
    expect((await stored()).password).toBe('hashed:third-pass');

    await User.update({ id: user.id }, { password: 'fourth-pass' });
    expect((await stored()).password).toBe('hashed:fourth-pass');

    const loaded = await stored();

    await loaded.update({ name: 'again' });
    expect((await stored()).password).toBe('hashed:fourth-pass');
  });

  test('does not select the password by default', async () => {
    const created = await User.create({
      email: 'p@b.co',
      password: 'secret-1',
    });

    expect((await User.findById(created.id)).password).toBeUndefined();
    expect((await User.find())[0].password).toBeUndefined();
    expect(
      (await User.where({ email: 'p@b.co' }).first()).password
    ).toBeUndefined();
    expect((await User.withHidden().first()).password).toBe('hashed:secret-1');
    expect((await User.find({ withHidden: true }))[0].password).toBe(
      'hashed:secret-1'
    );
    expect(await User.pluck('password')).toEqual(['hashed:secret-1']);
  });

  test('finds users for authentication and sessions', async () => {
    const created = await User.create({
      email: 'grace@usehenri.io',
      name: 'Grace',
      password: 'compiler-1952',
    });

    const byEmail = await adapter.findUserByEmail(' GRACE@usehenri.io ');

    expect(byEmail.password).toBe('hashed:compiler-1952');
    expect(byEmail.name).toBe('Grace');
    expect(await adapter.findUserByEmail('nobody@usehenri.io')).toBeNull();
    expect(await adapter.findUserByEmail('')).toBeNull();
    expect(await adapter.findUserByEmail(null)).toBeNull();

    const byId = await adapter.findUserById(String(created.id));

    expect(byId.password).toBeUndefined();
    expect(byId.email).toBe('grace@usehenri.io');
    expect(await adapter.findUserById('not-an-id')).toBeNull();
    expect(await adapter.findUserById(424242)).toBeNull();
    expect(await adapter.findUserById(null)).toBeNull();

    // The public identifier finds the user too, and is the only one that
    // ever leaves the server
    const byExternalId = await adapter.findUserById(created.externalId);

    expect(byExternalId.email).toBe('grace@usehenri.io');
    expect(adapter.userId(byId)).toBe(String(created.id));
    expect(adapter.toPlain(byEmail)).toEqual({
      createdAt: expect.any(Date),
      email: 'grace@usehenri.io',
      externalId: created.externalId,
      name: 'Grace',
      roles: ['member'],
      updatedAt: expect.any(Date),
    });
    expect(adapter.toPlain({ email: 'x', password: 'y' })).toEqual({
      email: 'x',
    });
  });

  test('drops roles from mass-assigned creates and updates', async () => {
    const user = await User.create({
      email: 'r@b.co',
      password: 'secret-1',
      roles: ['admin'],
    });

    expect(user.roles).toEqual(['member']);

    await User.findByIdAndUpdate(user.id, { roles: ['admin'] });
    expect((await User.findById(user.id)).roles).toEqual(['member']);

    await user.update({ roles: ['admin'] });
    expect((await User.findById(user.id)).roles).toEqual(['member']);

    await User.update({ id: user.id }, { name: 'x', roles: ['admin'] });
    expect((await User.findById(user.id)).roles).toEqual(['member']);
  });

  test('changes roles through setRoles or with unsafe', async () => {
    const user = await User.create(
      { email: 'u@b.co', password: 'secret-1', roles: 'admin' },
      { unsafe: true }
    );

    expect(user.roles).toEqual(['admin']);

    await user.setRoles(['admin', 'editor']);
    expect(user.roles).toEqual(['admin', 'editor']);
    expect((await User.findById(user.id)).roles).toEqual(['admin', 'editor']);

    const updated = await User.setRoles(user.id, 'member');

    expect(updated.roles).toEqual(['member']);
    expect(await User.setRoles(999, 'member')).toBeNull();

    await User.findByIdAndUpdate(user.id, { roles: ['x'] }, { unsafe: true });
    expect((await User.findById(user.id)).roles).toEqual(['x']);
  });

  test('checks roles with hasRole', async () => {
    const user = await User.create({ email: 'h@b.co', password: 'secret-1' });

    expect(await user.hasRole('member')).toBe(true);
    expect(await user.hasRole(['member'])).toBe(true);
    expect(await user.hasRole(['member', 'admin'])).toBe(false);
    expect(await user.hasRole()).toBe(true);
  });

  test('warns and defaults the roles to an empty list without a base role', async () => {
    const { adapter: bare, henri: quiet } = build();
    const Bare = bare.addModel(userModel, 'user');

    await bare.start();

    const user = await Bare.create({ email: 'n@b.co', password: 'secret-1' });

    expect(user.roles).toEqual([]);
    expect(quiet.calls).toContainEqual([
      'warn',
      'drizzle',
      'no basic user role. are you sure?',
    ]);
    await bare.stop();
  });
});
