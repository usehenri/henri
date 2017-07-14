module.exports = {
  schema: {
    name: { type: 'string' },
    age: { type: 'number' },
    dogs: { collection: 'dog' },
  },
};
