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
      this.fetchData = this.fetchData.bind(this);
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

    async fetchData() {
      axios
        .get(document.location)
        .then(resp => {
          this.setState({ data: resp.data });
        })
        .catch(err => {
          console.log('error fetching data', err);
        });
    }

    getChildContext() {
      return {
        // Contains the data passed down. Key should match names
        fetchData: this.fetchData,
      };
    }
    render() {
      return (
        <ComposedComponent
          fetchData={this.fetchData}
          {...this.props}
          data={this.state.data}
        />
      );
    }
  }
  WithHenri.childContextTypes = {
    fetchData: PropTypes.func,
  };
  return WithHenri;
};
