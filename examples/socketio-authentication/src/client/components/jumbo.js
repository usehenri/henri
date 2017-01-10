import React from 'react';

import {
  Jumbotron,
  Button
} from 'reactstrap';

export default class Jumbo extends React.Component {
  render () {
    return (
      <Jumbotron>
        <h1 className='display-3'>Socket.io signup and login</h1>
        <p className='lead'>Henri signup/login example over Socket.io</p>
        <p className='lead'>
          <Button color='outline'><a href='https://github.com/simplehub/henri/examples/socketio-authentication'>Learn More</a></Button>
        </p>
      </Jumbotron>
    );
  }
}
