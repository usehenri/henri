import React from 'react';
import { loadGetInitialProps } from 'next/dist/lib/utils';

import feathers from 'feathers/client';
import rest from 'feathers-rest/client';
import authentication from 'feathers-authentication-client';
import hooks from 'feathers-hooks';

require('es6-promise').polyfill();
require('isomorphic-fetch');

let henriClient = null;

module.exports = (ComposedComponent) => {
  return class WithClient extends React.Component {
    static async getInitialProps (ctx) {
      const client = initClient(ctx);
      return {
        client: client,
        serverRendered: !process.browser,
        opts: ctx && ctx.req ? ctx.req._opts : client.opts || {},
        ...await loadGetInitialProps(ComposedComponent, ctx)
      };
    }

    constructor (props) {
      super(props);
      this.client = initClient(props);
    }

    render () {
      return <ComposedComponent {...this.props} client={this.client} />;
    }
  };
};

const createClient = (ctx) => {
  const app = feathers().configure(hooks());
  app.opts = ctx.opts;

  if (app.opts.socketio) {
    const io = require('socket.io-client');
    const socketio = require('feathers-socketio/client');
    app.configure(socketio(io(app.opts.socketio)));
  }

  if (app.opts.rest) {
    app.configure(rest(app.opts.rest).fetch(fetch)); // eslint-disable-line no-undef
  }

  if (app.opts.auth) {
    app.configure(authentication({ storage: window.localStorage }));
  }

  return app;
};

const initClient = (ctx) => {
  if (!process.browser) {
    return;
  }

  if (!henriClient) {
    henriClient = createClient(ctx);
  }

  return henriClient;
};
