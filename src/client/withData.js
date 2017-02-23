import React from 'react';
import { loadGetInitialProps } from 'next/dist/lib/utils';
import warning from 'warning';
import invariant from 'invariant';

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
  invariant(typeof func === 'function', `withData() second argument should be a function, not: ${typeof func}. See https://github.com/simplehub/henri#withdata`);
  if (!process.browser) {
    // func.name might not be supported by lower version of Node...
    warning(typeof func === 'function' && func.name === 'fetchData', `If you want server-side data injection, rename ${func.name} to fetchData. See https://github.com/simplehub/henri#withdata`);
    return null;
  }
  return func(client, user, query);
};
