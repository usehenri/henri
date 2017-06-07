import { Component } from 'react';

import fetch from 'isomorphic-fetch';

export default ComposedComponent => {
  return class WithClient extends Component {
    static async getInitialProps(ctx) {
      let initialProps = {};
      let data = ctx.query.data;
      if (ComposedComponent.getInitialProps) {
        initialProps = await ComposedComponent.getInitialProps(ctx);
      }
      if (ComposedComponent.url && process.browser) {
        const response = await fetch(`/_data${ComposedComponent.url}`);
        data = await response.json();
      }
      console.log('============= init data =============');
      console.dir(data);
      console.log('+++++++++++++ init data +++++++++++++');
      return {
        ...data,
        ...initialProps,
      };
    }
    constructor(props) {
      super(props);
      console.log('============= constructor props =============');
      console.dir(props);
      console.log('+++++++++++++ constructor props +++++++++++++');
    }
    render() {
      return <ComposedComponent {...this.props} />;
    }
  };
};
