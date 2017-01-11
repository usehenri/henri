import React from 'react';

import feathers from 'feathers/client';
import hooks from 'feathers-hooks';
import authentication from 'feathers-authentication-client';
import rest from 'feathers-rest/client';

import 'isomorphic-fetch';

const app = feathers();
app.configure(hooks());

// eslint-disable-next-line no-undef
app.configure(rest('http://localhost:3030').fetch(fetch));

if (process.browser) {
  app.configure(authentication({
    storage: window.localStorage
  }));
}

export const defaultPage = Page => class extends React.Component {
  constructor (props) {
    super(props);
    this.logout = this.logout.bind(this);
    this.login = this.login.bind(this);
    this.register = this.register.bind(this);
    this.update = this.update.bind(this);
    this.state = { loggedIn: this.props.loggedIn, user: this.props.user };
  }

  static getInitialProps ({req, res, pathname, query, err, xhr}) {
    if (typeof Page.getInitialProps === 'function') {
      Page.getInitialProps();
    }
    return { loggedIn: req.authenticated, user: req.user };
  }

  componentDidMount () {
    this.update();
  }

  logout (ev) {
    ev.preventDefault();
    this.setState({ loggedIn: false, user: null });
    return app.logout();
  }

  login ({ email, password }) {
    // eslint-disable-next-line no-undef
    return fetch('/authentication', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: `strategy=local&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`
    }).then((response) => {
      if (response.status >= 400) {
        throw new Error('Unauthorized');
      }
      return response.json();
    }).then(body => {
      this.update(body.accessToken);
      return body.accessToken;
    });
  }

  register (opts = {}) {
    if (!opts.email || !opts.password) {
      throw new Error('Missing email or password');
    }
    return app.service('users').create(opts).then(result => {
      const { email, password } = opts;
      this.login({ email, password }).then(token => token).catch(err => err);
    }).catch(err => err);
  }

  update (token) {
    const opts = token ? { strategy: 'jwt', accessToken: token } : {};
    return app.authenticate(opts).then(result => {
      this.setState({ loggedIn: true, user: app.get('user') });
    }).catch(err => {
      if (err) {
        this.setState({ loggedIn: false, user: null });
      }
    });
  }

  render () {
    return <Page
      {...this.props}
      app={app}
      login={this.login}
      logout={this.logout}
      register={this.register}
      update={this.update}
      loggedIn={this.state.loggedIn}
      user={this.state.user}
    />;
  }
};
