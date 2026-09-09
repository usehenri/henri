/** @type {import('@usehenri/core').PolicyFile} */
module.exports = {
  scope: (user) => ({ ownerId: user.id }),
  show: (user, record) => record.ownerId === user.id,
};
