module.exports = {
  checkout: false,

  'legacy-editor': true,

  newBanner: {
    default: false,
    description: 'The banner nobody has approved yet',
    expose: true,
  },

  staffTools: {
    default: false,
    group: (user) => Boolean(user) && (user.roles || []).includes('admin'),
  },
};
