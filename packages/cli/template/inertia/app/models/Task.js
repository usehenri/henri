// Models are autoloaded from app/models and exposed globally (here: `Task`).
// The schema is handed to the store adapter (mongoose for disk/mongodb).

/** @type {import('@usehenri/core').ModelFile} */
module.exports = {
  options: {
    timestamps: true,
  },
  schema: {
    name: { type: 'string', required: true },
    category: {
      type: 'string',
      enum: ['urgent', 'high', 'medium', 'low'],
      default: 'low',
    },
  },
  store: 'default', // see config/default.json
};
