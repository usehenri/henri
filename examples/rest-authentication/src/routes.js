'use strict';

module.exports = function () {
  const app = this;

  const view = app.view;

  app.get('/', (req, res) => {
    if (req.authenticated) {
      console.log('user is authenticated');
    }
    return view.render(req, res, '/');
  });
};
