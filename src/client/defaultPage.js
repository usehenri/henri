/* global fetch */

import React from 'react';

import feathers from 'feathers/client';
import hooks from 'feathers-hooks';
import authentication from 'feathers-authentication-client';
import rest from 'feathers-rest/client';

require('es6-promise').polyfill();
require('isomorphic-fetch');

module.exports = (Page) => {
  return class extends React.Component {
    constructor (props) {
      super(props);
      this.logout = this.logout.bind(this);
      this.login = this.login.bind(this);
      this.signup = this.signup.bind(this);
      this.update = this.update.bind(this);

      this.app = feathers().configure(hooks());
      const { _opts = {} } = props;
      this.app._opts = _opts;

      if (_opts.socketio && !this.app.defaultService) {
        const io = require('socket.io-client');
        const socketio = require('feathers-socketio/client');
        const socket = io(_opts.socketio);
        this.app.configure(socketio(socket));
      }

      if (_opts.rest && !this.app.defaultService) {
        this.app.configure(rest(_opts.rest).fetch(fetch));
      }

      if (process.browser && _opts.auth) {
        this.app.configure(authentication({
          storage: window.localStorage
        }));
      }

      this.state = {
        authenticated: this.props.authenticated,
        user: this.props.user,
        connected: false
      };
    }

    static getInitialProps ({req, res, pathname, query, err, xhr}) {
      if (typeof Page.getInitialProps === 'function') {
        Page.getInitialProps();
      }
      return { authenticated: req.authenticated, user: req.user, _opts: req._opts };
    }

    componentDidMount () {
      console.log('opts', this.app._opts);
      this.update();
    }

    logout (ev) {
      ev.preventDefault();
      this.setState({ authenticated: false, user: null });
      return this.app.logout();
    }

    login ({ email, password }) {
      // eslint-disable-next-line no-undef
      console.log('this.app.defaultService');
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

    signup (opts = {}) {
      if (!opts.email || !opts.password) {
        throw new Error('Missing email or password');
      }
      return this.app.service('users').create(opts).then(result => {
        const { email, password } = opts;
        this.login({ email, password }).then(token => token).catch(err => err);
      }).catch(err => err);
    }

    update (token) {
      const opts = token ? { strategy: 'jwt', accessToken: token } : {};
      return this.app.authenticate(opts).then(result => {
        this.setState({ authenticated: true, user: this.app.get('user') });
      }).catch(err => {
        if (err) {
          this.setState({ authenticated: false, user: null });
        }
      });
    }

    render () {
      return <Page
        {...this.props}
        app={this.app}
        login={this.login}
        logout={this.logout}
        signup={this.signup}
        update={this.update}
        authenticated={this.state.authenticated}
        user={this.state.user}
        token={this.state.token}
      />;
    }
  };
};
