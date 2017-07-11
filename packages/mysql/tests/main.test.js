const mysql = require('../index.js');

describe('mysql database adapter', () => {
  test('exists', () => expect(mysql).toBeDefined());
  test('package name', () => expect(mysql.identity).toBe('sails-mysql'));
  test('create', () => expect(mysql.create).toBeDefined());
  test('createEach', () => expect(mysql.createEach).toBeDefined());
  test('find', () => expect(mysql.find).toBeDefined());
  test('update', () => expect(mysql.update).toBeDefined());
  test('destroy', () => expect(mysql.destroy).toBeDefined());
  test('avg', () => expect(mysql.avg).toBeDefined());
  test('sum', () => expect(mysql.sum).toBeDefined());
  test('count', () => expect(mysql.count).toBeDefined());
  test('drop', () => expect(mysql.drop).toBeDefined());
  test('join', () => expect(mysql.join).toBeDefined());
  test('createSchema', () => expect(mysql.createSchema).toBeDefined());
  test('teardown', () => expect(mysql.teardown).toBeDefined());
  test('datastores', () => expect(mysql.datastores).toBeDefined());
  test('defaults', () =>
    expect(mysql.defaults).toEqual({
      host: 'localhost',
      port: 3306,
      schema: true,
    }));
});
