// The login page. henri mounts POST /login and POST /logout itself as soon as
// an application has a user model; what it does not ship is a page for them.
//
// The form posts straight to /login: a browser without a session cookie yet
// needs no CSRF token, and henri redirects to `config.user.afterLogin` on
// success and to `/login?error=invalid` on failure.
module.exports = {
  new: (req, res) => {
    if (req.user) {
      return res.redirect('/proposals/mine');
    }

    return res.render('/login', {
      data: { failed: req.query.error === 'invalid' },
    });
  },
};
