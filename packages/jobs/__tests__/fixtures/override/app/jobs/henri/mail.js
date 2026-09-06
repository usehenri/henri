// An application that wants its own delivery writes this file: it wins over
// the one @usehenri/jobs ships.
module.exports = {
  queue: 'own-mailers',

  perform: async () => 'the application sent it',
};
