// One edition of the conference. `open` is the state the call for papers is
// in, which is what most tests need and not what the model defaults to.
module.exports = {
  attributes: {
    city: 'Testville',
    name: 'Test Conf',
    slug: ({ sequence, uid }) => `test-${uid}-${sequence}`,
    state: 'open',
    year: 2026,
  },

  traits: {
    announced: { state: 'announced' },
    closed: { state: 'closed' },
    draft: { state: 'draft' },
  },
};
