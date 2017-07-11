const disk = require('../index.js');

describe('disk database adapter', () => {
  test('exists', () => expect(disk).toBeDefined());
  test('package name', () => expect(disk.identity).toBe('sails-disk'));
  test('create', () => expect(disk.create).toBeDefined());
  test('createEach', () => expect(disk.createEach).toBeDefined());
  test('find', () => expect(disk.find).toBeDefined());
  test('update', () => expect(disk.update).toBeDefined());
  test('destroy', () => expect(disk.destroy).toBeDefined());
  test('avg', () => expect(disk.avg).toBeDefined());
  test('sum', () => expect(disk.sum).toBeDefined());
  test('count', () => expect(disk.count).toBeDefined());
  test('drop', () => expect(disk.drop).toBeDefined());
  test('teardown', () => expect(disk.teardown).toBeDefined());
  test('datastores', () => expect(disk.datastores).toBeDefined());
  test('defaults', () => expect(disk.defaults.dir).toBe('.tmp/localDiskDb'));
});
