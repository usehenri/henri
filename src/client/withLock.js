import React from 'react';
import { loadGetInitialProps } from 'next/dist/lib/utils';
import Router from 'next/router';
import Head from 'next/head';
import withAuth from './withAuth';

require('es6-promise').polyfill();
require('isomorphic-fetch');

const withLock = (ComposedComponent, Fallback) => {
  return class withLock extends React.Component {
    static async getInitialProps (ctx) {
      return {
        ...await loadGetInitialProps(ComposedComponent, ctx)
      };
    }

    render () {
      // TODO: Fix this. Accept React element and React.isValidElement() it. Remove flash or programmatically passthru
      if (!this.props.user) {
        if (/^\/\w+/.test(Fallback) && process.browser) {
          return Router.push(Fallback);
        }
        console.error('*** The second argument to withLock() should be a valid path.');
        return errorPage();
      }
      return <ComposedComponent {...this.props} />;
    }
  };
};

const errorPage = () => (
  <div className='error'>
    <Head>
      <meta name='viewport' content='width=device-width, initial-scale=1.0' />
    </Head>
    <div>
      <h1>401</h1>
      <div className='desc'>
        <h2>You are not authorized to access this page.</h2>
      </div>
    </div>
    <style jsx global>{`
        body { margin: 0 }
      `}</style>
    <style jsx>{`
        .error {
          color: #000;
          background: #fff;
          font-family: -apple-system, BlinkMacSystemFont, Roboto, "Segoe UI", "Fira Sans", Avenir, "Helvetica Neue", "Lucida Grande", sans-serif;
          height: 100vh;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }

        .desc {
          display: inline-block;
          text-align: left;
          line-height: 49px;
          height: 49px;
          vertical-align: middle;
        }

        h1 {
          display: inline-block;
          border-right: 1px solid rgba(0, 0, 0,.3);
          margin: 0;
          margin-right: 20px;
          padding: 10px 23px 10px 0;
          font-size: 24px;
          font-weight: 500;
          vertical-align: top;
        }

        h2 {
          font-size: 14px;
          font-weight: normal;
          margin: 0;
          padding: 0;
        }
      `}</style>
  </div>
);

module.exports = (Page, Action) => withAuth(withLock(Page, Action));
