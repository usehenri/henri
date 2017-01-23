import React from 'react';
import Link from 'next/link';
import {
  Navbar,
  NavbarToggler,
  Collapse,
  Nav,
  NavItem,
  NavbarBrand
} from 'reactstrap';

export default class Navigation extends React.Component {
  constructor (props) {
    super(props);
    this.toggleNavbar = this.toggleNavbar.bind(this);
    this.state = { collapsed: true };
  }
  toggleNavbar () { this.setState({ collapsed: !this.state.collapsed }); }

  render () {
    return (
      <Navbar color='faded' light>
        <NavbarBrand href='/'>henri</NavbarBrand>
        <NavbarToggler className='float-sm-right hidden-lg-up collapsed' onClick={this.toggleNavbar} />
        <Collapse className='navbar-toggleable-md' isOpen={!this.state.collapsed}>
          <Nav className='float-xs-right' navbar>
            <NavItem>
              <Link href='https://github.com/simplehub/henri'><a className='nav-link'>Github</a></Link>
            </NavItem>
            <NavItem>
              {this.props.authenticated ? (
                <a href='#' className='nav-link' onClick={this.props.logout}>Log out</a>
              ) : (
                <a href='#' className='nav-link'>You need to log in</a>
              )}
            </NavItem>
          </Nav>
        </Collapse>
      </Navbar>
    );
  }
}
