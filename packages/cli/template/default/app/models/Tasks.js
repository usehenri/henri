module.exports = {
  identity: 'tasks',
  datastore: 'default', // see the demo configuration up there
  attributes: {
    name: { type: 'string', required: true },
    sex: { type: 'string', required: false },
    category: {
      type: 'string',
      validations: {
        isIn: ['urgent', 'high', 'medium', 'low'],
      },
      defaultsTo: 'low',
    },
  },
};
