import React from 'react';

import feathers from 'feathers/client';
import rest from 'feathers-rest/client';
import auth from 'feathers-authentication-client';
import { loadGetInitialProps } from 'next/dist/lib/utils';
import hooks from 'feathers-hooks';

require('es6-promise').polyfill();
require('isomorphic-fetch');

let henriClient = null;

module.exports = (ComposedComponent) => {
  return class WithClient extends React.Component {
    static async getInitialProps (ctx) {
      const client = initClient(ctx.req && ctx.req.session);

      return {
        serverRendered: !process.browser,
        session: ctx.req && ctx.req.session || ctx.session,
        ...await loadGetInitialProps(ComposedComponent, { ...ctx, client })
      };
    }

    constructor (props) {
      super(props);
      this.client = initClient(props.session);
    }

    render () {
      return <ComposedComponent {...this.props} client={this.client} />;
    }
  };
};

const createClient = (session) => {
  const { options: { endpoint, authentication } } = session;
  const app = feathers().configure(hooks());
  app.session = session;
  if (process.browser) {
    const io = require('socket.io-client');
    const socketio = require('feathers-socketio/client');
    app.configure(socketio(io(endpoint)));
  } else {
    app.configure(rest(endpoint).fetch(fetch)); // eslint-disable-line no-undef
  }

  if (authentication) {
    const storage = process.browser ? { storage: window.localStorage } : {};
    app.configure(auth(storage));
  }

  return app;
};

const initClient = (session) => {
  // Don't use global SSR.. unexpected results...
  if (!process.browser) {
    return createClient(session);
  }
  if (!henriClient) {
    henriClient = createClient(session);
  }

  return henriClient;
};
