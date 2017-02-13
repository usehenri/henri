import React from 'react';
import { loadGetInitialProps } from 'next/dist/lib/utils';
import withClient from './withClient';

require('es6-promise').polyfill();
require('isomorphic-fetch');

const withAuth = (ComposedComponent) => {
  return class WithAuth extends React.Component {
    static async getInitialProps (ctx) {
      return {
        user: ctx && ctx.req && ctx.req.user,
        ...await loadGetInitialProps(ComposedComponent, ctx)
      };
    }

    constructor (props) {
      super(props);
      if (!props.serverRendered && !props.client.authenticate) {
        throw new Error('You are trying to use withAuth() without proper configuration. See your project config file.');
      }
      this.login = this.login.bind(this);
      this.logout = this.logout.bind(this);
      this.signup = this.signup.bind(this);
      this.update = this.update.bind(this);
      this.state = {
        user: props.user || props.client && props.client.get('user')
      };
    }

    componentDidMount () {
      this.update();
    }

    logout (ev) {
      const { client } = this.props;
      ev.preventDefault();
      this.setState({ user: null });
      client.set('user', null);
      return client.logout();
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

    signup (opts = {}) {
      const { client } = this.props;
      const { email, password } = opts;

      if (!email || !password) {
        throw new Error('Missing email or password');
      }

      return client.service('users').create(opts).then(result => {
        this.login({ email, password }).then(token => token).catch(err => err);
      }).catch(err => err);
    }

    update (token) {
      const { client } = this.props;
      if (!token && client.get('user')) {
        return;
      }
      const opts = token ? { strategy: 'jwt', accessToken: token } : {};

      if (client && client.authenticate) {
        let user = null;
        return client.authenticate(opts).then(response => {
          // A user object is supposed to be return if successful. Store it and
          // wait for the JWT to be decrypted.
          user = response.user;
          return client.passport.verifyJWT(response.accessToken);
        }).then(payload => {
          // JWT is valid, set the user.
          client.set('user', user);
          this.setState({ user: user });
        }).catch(err => {
          if (err) {
            this.setState({ user: null });
          }
        });
      }
      return null;
    }

    render () {
      return <ComposedComponent
        {...this.props}
        user={this.state.user}
        login={this.login}
        logout={this.logout}
        signup={this.signup}
      />;
    }
  };
};

module.exports = (Page) => withClient(withAuth(Page));
