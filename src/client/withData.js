import React from 'react';
import { loadGetInitialProps } from 'next/dist/lib/utils';

require('es6-promise').polyfill();

const withData = (ComposedComponent, func) => {
  return class withData extends React.Component {
    static async getInitialProps (ctx) {
      const { client, user, query } = ctx;
      const data = ctx.req && ctx.req.data || null;
      const initialProps = await loadGetInitialProps(ComposedComponent, ctx);
      return {
        data: data || await fetcher(client, user || ctx.client.get('user') || null, query, func),
        ...initialProps
      };
    }
    constructor (props) {
      super(props);
      this.state = {
        data: props.data
      };
    }
    async componentDidMount () {
      if (!this.props.data || this.props.data.length < 1) {
        const { client, user, url: { query = null } } = this.props;
        const data = await fetcher(client, user, query, func);
        this.setState({ data: data });
      }
    }
    render () {
      return <ComposedComponent {...this.props} data={this.state.data} />;
    }
  };
};
module.exports = (Page, func) => withData(Page, func);

const fetcher = (client, user, query, func) => {
  if (!process.browser) {
    return [];
  }
  return func(client, user, query);
};
