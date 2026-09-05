import React from 'react';
import axios from 'axios';
import PropTypes from 'prop-types';
import { withRouter } from 'next/router';
import { getRoute as findRoute, pathFor as findPath } from './paths';

/**
 * Context injected by withHenri: data, paths and helpers coming from the
 * controller (through res.render) and henri's router.
 */
export const HenriContext = React.createContext({
  csrf: null,
  data: {},
  fetch: null,
  getRoute: () => 'route-not-found',
  hydrate: null,
  localUrl: '',
  pathFor: () => undefined,
  paths: {},
  user: null,
});

/**
 * Hook giving access to the henri context
 *
 * @returns {object} the henri context value
 */
export const useHenri = () => React.useContext(HenriContext);

/**
 * Get a component display name
 *
 * @param {React.Component} Component the component
 * @returns {string} its name
 */
function getDisplayName(Component) {
  return Component.displayName || Component.name || 'Unknown';
}

/**
 * Wraps a page so it receives the controller data (and helpers) as props
 *
 * @param {React.Component} ComposedComponent the page
 * @returns {React.Component} the wrapped page
 */
export default (ComposedComponent) => {
  class WithHenri extends React.Component {
    static displayName = `withHenri(${getDisplayName(ComposedComponent)})`;

    static propTypes = {
      csrf: PropTypes.string,
      data: PropTypes.any,
      localUrl: PropTypes.string,
      paths: PropTypes.object,
      user: PropTypes.object,
    };

    static async getInitialProps(ctx) {
      let props = Object.assign({}, ctx);

      if (!props.paths && !props.req) {
        const result = await axios.get(ctx.pathname);

        props.query = result.data;
      }

      // Server side: henri's router and view engine attach the view options
      // (data, paths, user, ...) to the request. They win over url params.
      if (props.req && props.req._henri) {
        props.query = Object.assign({}, props.query, props.req._henri);
      }

      const {
        query: { csrf = null, data, user = null, paths, localUrl } = {},
      } = props;

      let composedInitialProps = {};

      if (ComposedComponent.getInitialProps) {
        composedInitialProps = await ComposedComponent.getInitialProps(ctx);
      }

      return { csrf, data, localUrl, paths, user, ...composedInitialProps };
    }

    constructor(props) {
      super(props);

      this.state = {
        data: props.data || {},
      };
    }

    // Double-submit CSRF token (henri sets it as `req._henri.csrf`); henri
    // requires it on POST/PUT/PATCH/DELETE requests carrying a session cookie
    headers = () =>
      this.props.csrf ? { 'X-CSRF-Token': this.props.csrf } : {};

    hydrate = async () => {
      return axios({
        headers: this.headers(),
        method: 'get',
        url: document.location.href,
      })
        .then((resp) => {
          this.setState({ data: resp.data && resp.data.data });
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.log('error fetching data', err);
        });
    };

    fetch = async ({ route = '/', method = 'get' }, data = {}) => {
      return axios({
        data,
        headers: this.headers(),
        method,
        url: route,
      });
    };

    pathFor = (path = null, params = null) =>
      findPath(this.props.paths, path, params);

    getRoute = (route = null, id = null) =>
      findRoute(this.props.paths, route, id);

    render() {
      const value = {
        csrf: this.props.csrf,
        data: this.state.data,
        fetch: this.fetch,
        getRoute: this.getRoute,
        hydrate: this.hydrate,
        localUrl: this.props.localUrl,
        pathFor: this.pathFor,
        paths: this.props.paths,
        user: this.props.user,
      };

      return (
        <HenriContext.Provider value={value}>
          <ComposedComponent
            hydrate={this.hydrate}
            fetch={this.fetch}
            pathFor={this.pathFor}
            getRoute={this.getRoute}
            {...this.props}
            data={this.state.data}
          />
        </HenriContext.Provider>
      );
    }
  }

  return withRouter(WithHenri);
};
