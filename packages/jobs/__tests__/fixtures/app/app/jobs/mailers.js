// A job with a queue and a priority of its own
module.exports = {
  priority: -5,
  queue: 'mailers',

  perform: async (args) => args,
};
