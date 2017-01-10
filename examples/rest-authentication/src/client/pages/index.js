import React from 'react';
import Application from '../components/application';
import Login from './login';
import Signup from './signup';
import { Row, Col } from 'reactstrap';

class IndexPage extends React.Component {
  render () {
    return (
      <div>
        <div className='container'>
          <Row>
            <Col sm={6}><Signup {...this.props} /></Col>
            <Col sm={6}><Login {...this.props} /></Col>
          </Row>
        </div>
      </div>
    );
  }
}

export default Application(IndexPage, { title: 'Home page' });
