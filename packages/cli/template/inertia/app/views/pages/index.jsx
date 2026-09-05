// useHenri() gives what the controller passed to res.render(): data, user,
// paths, localUrl and the pathFor/getRoute/fetch/hydrate helpers. <Link>
// navigates between pages without reloading the document (Inertia).
import { Link, useHenri } from '@usehenri/inertia';

export default function Home() {
  const { user, getRoute } = useHenri();

  return (
    <div className="main">
      <p>welcome to henri{user ? `, ${user.email}` : ''}</p>
      <Link href={getRoute('index_tasks_path')}>tasks</Link>
    </div>
  );
}
