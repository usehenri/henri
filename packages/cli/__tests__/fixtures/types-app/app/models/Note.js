// No public identifier and no timestamps: what a model looks like once it
// has opted out of both.
/** @type {import('@usehenri/core').ModelFile} */
module.exports = {
  options: { externalId: false, timestamps: false },
  schema: { body: { type: 'text' } },
};
