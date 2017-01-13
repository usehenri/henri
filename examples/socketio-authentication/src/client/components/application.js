import React from 'react';
import Head from 'next/head';
import Navigation from './navigation';
import Jumbo from './jumbo';
import { Container } from 'reactstrap';

export default class Application extends React.Component {
  render () {
    return (
      <div>
        <Head>
          <meta charSet='utf-8' />
          <meta name='viewport' content='width=device-width, initial-scale=1, shrink-to-fit=no' />
          <meta httpEquiv='x-ua-compatible' content='ie=edge' />
          <title>{'feathers & next.js'}</title>
          <link rel='stylesheet' href='/static/bootstrap.min.css' />
        </Head>
        <Navigation authenticated={this.props.authenticated} logout={this.props.logout} />
        <Jumbo />
        <Container>
          {this.props.children}
        </Container>
      </div>
    );
  }
}
