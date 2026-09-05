// withHenri injects what the controller passed to res.render(): data, user,
// paths, localUrl and the fetch/hydrate/pathFor helpers. Nested components
// can read the same values with `import { useHenri } from '@usehenri/react'`.
// Folders under app/views (components/, styles/, helpers/, assets/) are
// importable by name, e.g. `import Nav from 'components/nav'`.
import withHenri from '@usehenri/react';

const Home = ({ user }) => (
  <div className="main">welcome to henri{user ? `, ${user.email}` : ''}</div>
);

export default withHenri(Home);
