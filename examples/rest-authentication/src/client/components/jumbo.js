import React from 'react';

import {
  Jumbotron,
  Button
} from 'reactstrap';

export default class Jumbo extends React.Component {
  render () {
    return (
      <Jumbotron>
        <h1 className='display-3'>Henri REST authentication example</h1>
        <p className='lead'>Henri signup/login example over REST</p>
        <p className='lead'>
          <Button color='outline'><a href='https://github.com/simplehub/henri'>Learn More</a></Button>
        </p>
      </Jumbotron>
    );
  }
}
