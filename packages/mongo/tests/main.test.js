const mongo = require('../index.js');

describe('mongo database adapter', () => {
  test('exists', () => expect(mongo).toBeDefined());
  test('package name', () => expect(mongo.identity).toBe('sails-mongo'));
  test('create', () => expect(mongo.create).toBeDefined());
  test('createEach', () => expect(mongo.createEach).toBeDefined());
  test('find', () => expect(mongo.find).toBeDefined());
  test('update', () => expect(mongo.update).toBeDefined());
  test('destroy', () => expect(mongo.destroy).toBeDefined());
  test('avg', () => expect(mongo.avg).toBeDefined());
  test('sum', () => expect(mongo.sum).toBeDefined());
  test('count', () => expect(mongo.count).toBeDefined());
  test('drop', () => expect(mongo.drop).toBeDefined());
  test('teardown', () => expect(mongo.teardown).toBeDefined());
  test('datastores', () => expect(mongo.datastores).toBeDefined());
  test('mongodb', () => expect(mongo.mongodb).toBeDefined());
});
