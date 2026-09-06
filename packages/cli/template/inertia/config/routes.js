/** @type {import('@usehenri/core').RoutesFile} */
module.exports = {
  'get /': 'main#home',
  'get /tasks': 'tasks#index',
  'post /tasks': 'tasks#create',
  'delete /tasks/:id': 'tasks#destroy',
};
