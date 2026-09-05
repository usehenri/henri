import withHenri from '@usehenri/react';

const Home = ({ user }) => (
  <div className="main">welcome to henri{user ? `, ${user.email}` : ''}</div>
);

export default withHenri(Home);
