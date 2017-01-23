import React from 'react';
import Application from '../components/application';
import { defaultPage } from 'henri/client';
import Login from './login';
import Signup from './signup';
import { Row, Col } from 'reactstrap';

class IndexPage extends React.Component {
  render () {
    return (
      <Application {...this.props}>
        <div>
          <div className='container'>
            <Row>
              <Col sm={6}><Signup {...this.props} /></Col>
              <Col sm={6}><Login {...this.props} /></Col>
            </Row>
          </div>
        </div>
      </Application >
    );
  }
}

export default defaultPage(IndexPage);
