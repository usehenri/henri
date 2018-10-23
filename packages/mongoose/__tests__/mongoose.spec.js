const types = require('../types');
const Mongoose = require('../index');

describe('mongoose', () => {
  test('should match class snapshot', () => {
    const mongoose = new Mongoose('conn', { url: 'mongodb://' }, {});

    expect(mongoose).toMatchSnapshot();
  });
  test('should match types snapshot', () => {
    expect(types).toMatchSnapshot();
  });
});
