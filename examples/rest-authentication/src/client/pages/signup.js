import React from 'react';
import { Container, Row, Col, Form, FormGroup, Input, Button, Label, Alert } from 'reactstrap';

class Signup extends React.Component {
  constructor (props) {
    super(props);
    this.updateName = this.updateName.bind(this);
    this.updateEmail = this.updateEmail.bind(this);
    this.updatePassword = this.updatePassword.bind(this);
    this.signupUser = this.signupUser.bind(this);
    this.infoMessage = this.infoMessage.bind(this);
    this.onDismiss = this.onDismiss.bind(this);
    this.state = { fullname: '', email: '', password: '', message: null };
  }
  signupUser (ev) {
    ev.preventDefault();
    const { signup } = this.props;
    const data = {
      fullname: this.state.fullname,
      email: this.state.email,
      password: this.state.password
    };
    console.log(this.props, data);
    signup(data).then(token => {
      this.setState({ message: { type: 'success', content: 'User created!' } });
    }).catch(err => {
      if (err) {
        this.setState({ message: { type: 'danger', content: 'Unable to signup' } });
      }
    });
  }
  updateName (ev) {
    this.setState({ fullname: ev.target.value });
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
          <Col sm={12}><h4>Sign up</h4></Col>
        </Row>
        {this.infoMessage()}
        <Row>
          <Col sm='12'>
            <Form onSubmit={this.signupUser} >
              <FormGroup row>
                <Label for='fullname' sm={2}>Name</Label>
                <Col sm={10}>
                  <Input
                    type='text'
                    name='fullname'
                    placeholder='John Doe'
                    onChange={this.updateName}
                    value={this.state.fullname}
                  />
                </Col>
              </FormGroup>
              {' '}
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
              <Button>Register</Button>
            </Form>
            {' '}
          </Col>
        </Row>
      </Container>
    );
  }
}

export default Signup;
