import React from 'react';
import axios from 'axios';
import PropTypes from 'prop-types';

function getDisplayName(Component) {
  return Component.displayName || Component.name || 'Unknown';
}

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
      const { query: { data, user } } = ctx;
      let composedInitialProps = {};
      if (ComposedComponent.getInitialProps) {
        composedInitialProps = await ComposedComponent.getInitialProps(ctx);
      }
      return { data, user, ...composedInitialProps };
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

    async fetch(route, method = 'get') {
      return new Promise((resolve, reject) => {
        axios({
          method,
          url: route,
        })
          .then(resp => {
            resolve(resp);
          })
          .catch(err => {
            reject(err);
          });
      });
    }

    getChildContext() {
      return {
        // Contains the data passed down. Key should match names
        hydrate: this.hydrate,
        fetch: this.fetch,
      };
    }

    render() {
      return (
        <ComposedComponent
          hydrate={this.hydrate}
          fetch={this.fetch}
          {...this.props}
          data={this.state.data}
        />
      );
    }
  }

  WithHenri.childContextTypes = {
    hydrate: PropTypes.func,
    fetch: PropTypes.func,
  };

  return WithHenri;
};
