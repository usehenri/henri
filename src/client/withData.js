import React from 'react';

require('es6-promise').polyfill();

const withData = (ComposedComponent, func) => {
  return class withData extends React.Component {
    static async getInitialProps (ctx) {
      const data = ctx.req && ctx.req.data || null;
      return { data: data || await fetcher(ctx, func) };
    }
    constructor (props) {
      super(props);
      this.state = {
        data: props.data
      };
    }
    async componentDidMount () {
      if (!this.props.data || this.props.data.length < 1) {
        const data = await fetcher(this.props, func);
        this.setState({ data: data });
      }
    }
    render () {
      return <ComposedComponent {...this.props} data={this.state.data} />;
    }
  };
};
module.exports = (Page, func) => withData(Page, func);

const fetcher = (props, func) => {
  if (!process.browser) {
    return [];
  }
  return func(props);
};
