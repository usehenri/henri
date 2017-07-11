const pgsql = require('../index.js');

describe('postgresql database adapter', () => {
  test('exists', () => expect(pgsql).toBeDefined());
  test('package name', () => expect(pgsql.identity).toBe('sails-postgresql'));
  test('create', () => expect(pgsql.create).toBeDefined());
  test('createEach', () => expect(pgsql.createEach).toBeDefined());
  test('find', () => expect(pgsql.find).toBeDefined());
  test('update', () => expect(pgsql.update).toBeDefined());
  test('destroy', () => expect(pgsql.destroy).toBeDefined());
  test('avg', () => expect(pgsql.avg).toBeDefined());
  test('sum', () => expect(pgsql.sum).toBeDefined());
  test('count', () => expect(pgsql.count).toBeDefined());
  test('drop', () => expect(pgsql.drop).toBeDefined());
  test('join', () => expect(pgsql.join).toBeDefined());
  test('createSchema', () => expect(pgsql.createSchema).toBeDefined());
  test('teardown', () => expect(pgsql.teardown).toBeDefined());
  test('datastores', () => expect(pgsql.datastores).toBeDefined());
});
