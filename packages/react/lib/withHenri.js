import React from 'react';
import axios from 'axios';
import PropTypes from 'prop-types';
import ws from 'socket.io-client';

function getDisplayName(Component) {
  return Component.displayName || Component.name || 'Unknown';
}

const socket = typeof window === 'undefined' ? {} : ws();

export default ComposedComponent => {
  class WithHenri extends React.Component {
    constructor(props) {
      super(props);
      this.state = {
        data: props.data || {},
      };
      this.hydrate = this.hydrate.bind(this);
      this.fetch = this.fetch.bind(this);
    }

    static displayName = `withHenri(${getDisplayName(ComposedComponent)})`;

    static async getInitialProps(ctx) {
      const { query: { data, user, paths, localUrl } } = ctx;
      let composedInitialProps = {};
      if (ComposedComponent.getInitialProps) {
        composedInitialProps = await ComposedComponent.getInitialProps(ctx);
      }
      return { data, user, paths, localUrl, ...composedInitialProps };
    }

    async hydrate(data = {}) {
      axios({
        method: 'get',
        url: document.location,
        data,
      })
        .then(resp => {
          this.setState({ data: resp.data });
        })
        .catch(err => {
          console.log('error fetching data', err);
        });
    }

    fetch = async ({ route = '/', method = 'get' }, data = {}) => {
      return new Promise((resolve, reject) => {
        axios({
          method,
          url: route,
          data,
        })
          .then(resp => {
            resolve(resp);
          })
          .catch(err => {
            reject(err);
          });
      });
    };

    pathFor = (path = null, params = null, plain = true) => {
      const { paths } = this.props;
      let response = {
        route: '',
        method: 'get',
        // We want to return an object for funcs, and string as a helper
        __proto__: {
          toString() {
            return this.route;
          },
        },
      };

      if (path && paths[path]) {
        // this will render the default route with method
        if (params === null) {
          return paths[path];
        }
        // If a string is provide, defaults to id (client side for mongo ids)
        if (typeof params === 'string') {
          response.route = paths[path].route.replace(':id', params);
          response.method = paths[path].method;
          return response;
        }
        // If we use only typeof (string), on node, it is parsed as a
        // ObjectID object, therefor missing the last if. This is for SSR or _ids
        if (params.id && params.toString()) {
          response.route = paths[path].route.replace(':id', params.toString());
          response.method = paths[path].method;
          return response;
        }
        // We might have a bunch of params, iterating...
        if (params.length > 0) {
          let route = path;
          Object.keys(params).map(
            v => (route = route.replace(`:${v}`, params[v]))
          );
          response.route = route;
          response.method = paths[path].method;
          return response;
        }
      }
      console.warn(`unable to match filler for route ${path} in pathFor`);
    };

    getRoute = (route = null) => {
      const { paths } = this.props;
      if (
        route &&
        typeof paths[route] !== 'undefined' &&
        typeof paths[route].route !== 'undefined'
      ) {
        return paths[route].route;
      }
      return 'route-not-found';
    };

    getChildContext() {
      return {
        // Contains the data passed down. Key should match names
        hydrate: this.hydrate,
        fetch: this.fetch,
        pathFor: this.pathFor,
        getRoute: this.getRoute,
        socket: socket,
      };
    }

    render() {
      return (
        <ComposedComponent
          hydrate={this.hydrate}
          fetch={this.fetch}
          pathFor={this.pathFor}
          getRoute={this.getRoute}
          socket={socket}
          {...this.props}
          data={this.state.data}
        />
      );
    }
  }

  WithHenri.childContextTypes = {
    hydrate: PropTypes.func,
    fetch: PropTypes.func,
    socket: PropTypes.func,
    pathFor: PropTypes.func,
    getRoute: PropTypes.func,
  };

  return WithHenri;
};
