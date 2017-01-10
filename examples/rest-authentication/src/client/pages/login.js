import React from 'react';
import { Container, Row, Col, Form, FormGroup, Input, Button, Label, Alert } from 'reactstrap';

import 'isomorphic-fetch';

class Login extends React.Component {
  constructor (props) {
    super(props);
    this.updateEmail = this.updateEmail.bind(this);
    this.updatePassword = this.updatePassword.bind(this);
    this.loginUser = this.loginUser.bind(this);
    this.infoMessage = this.infoMessage.bind(this);
    this.onDismiss = this.onDismiss.bind(this);
    this.state = { email: '', password: '', message: null };
  }
  loginUser (ev) {
    ev.preventDefault();
    // eslint-disable-next-line no-undef
    fetch('/authentication', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: `strategy=local&email=${encodeURIComponent(this.state.email)}&password=${encodeURIComponent(this.state.password)}`
    }).then((response) => {
      if (response.status >= 400) {
        throw new Error('Unauthorized');
      }
      return response.json();
    }).then(body => {
      this.props.updateUser(body.accessToken);
      this.setState({ message: { type: 'success', content: 'Logged in!' } });
    }).catch(err => {
      if (err) {
        this.setState({ message: { type: 'danger', content: 'Check your username/password' } });
      }
    });
  }
  updateEmail (ev) {
    this.setState({ email: ev.target.value });
  }
  updatePassword (ev) {
    this.setState({ password: ev.target.value });
  }
  onDismiss () {
    this.setState({ message: null });
  }
  infoMessage () {
    if (this.state.message) {
      return (
        <Row>
          <Alert color={this.state.message.type} isOpen toggle={this.onDismiss}>
            {this.state.message.content}
          </Alert>
        </Row>
      );
    }
    return <Row />;
  }
  render () {
    return (
      <Container>
        <Row>
          <Col sm={12}><h4>Login</h4></Col>
        </Row>
        {this.infoMessage()}
        {' '}
        <Row>
          <Col sm='12'>
            <Form onSubmit={this.loginUser} >
              <FormGroup row>
                <Label for='email' sm={2}>Email</Label>
                <Col sm={10}>
                  <Input
                    type='email'
                    name='email'
                    placeholder='john@doe.com'
                    onChange={this.updateEmail}
                    value={this.state.email}
                  />
                </Col>
              </FormGroup>
              {' '}
              <FormGroup row>
                <Label for='password' sm={2}>Password</Label>
                <Col sm={10}>
                  <Input
                    type='password'
                    name='password'
                    placeholder='Something odd'
                    onChange={this.updatePassword}
                    value={this.state.password}
                  />
                </Col>
              </FormGroup>
              {' '}
              <Button>Log in</Button>
              {' '}
            </Form>
            {' '}
          </Col>
        </Row>
      </Container>
    );
  }
}

export default Login;
