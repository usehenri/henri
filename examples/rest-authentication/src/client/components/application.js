import React from 'react';
import Head from 'next/head';
import feathers from 'feathers/client';
import rest from 'feathers-rest/client';
import hooks from 'feathers-hooks';
import authentication from 'feathers-authentication-client';
import Navigation from './navigation';
import Jumbo from './jumbo';
import { Container } from 'reactstrap';

import 'isomorphic-fetch';

const app = feathers()
// eslint-disable-next-line no-undef
  .configure(rest('http://localhost:3030').fetch(fetch))
  .configure(hooks());

if (process.browser) {
  app.configure(authentication({
    storage: window.localStorage
  }));
}

export default (Page, { title = '' }) => class Application extends React.Component {
  constructor (props) {
    super(props);
    this.logout = this.logout.bind(this);
    this.updatedUserState = this.updatedUserState.bind(this);
    this.state = { loggedIn: false, user: null };
  }
  static getInitialProps (ctx) {
    if (typeof Page.getInitialProps === 'function') {
      return Page.getInitialProps(ctx, app);
    }
  }
  componentDidMount () {
    this.updatedUserState();
  }
  logout (ev) {
    ev.preventDefault();
    app.logout();
    this.updatedUserState();
  }
  updatedUserState (token) {
    const opts = token ? { strategy: 'jwt', accessToken: token } : {};
    app.authenticate(opts).then(result => {
      this.setState({ loggedIn: true, user: app.get('user') });
// eslint-disable-next-line handle-callback-err
    }).catch(err => {
      this.setState({ loggedIn: false, user: null });
    });
  }
  render () {
    return (
      <div>
        <Head>
          <meta charSet='utf-8' />
          <meta name='viewport' content='width=device-width, initial-scale=1, shrink-to-fit=no' />
          <meta httpEquiv='x-ua-compatible' content='ie=edge' />
          <title>{title || 'feathers & next.js'}</title>
          <link rel='stylesheet' href='/static/bootstrap.min.css' />
        </Head>
        <Navigation app={app} loggedIn={this.state.loggedIn} logout={this.logout} />
        <Jumbo />
        <Container>
          <Page {...this.props} app={app} updateUser={this.updatedUserState} />
        </Container>
      </div>
    );
  }
};
