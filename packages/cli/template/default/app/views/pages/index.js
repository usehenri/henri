// withHenri injects what the controller passed to res.render(): data, user,
// paths, localUrl and the fetch/hydrate/pathFor/getRoute helpers. Nested
// components read the same values with `import { useHenri } from '@usehenri/react'`.
// Folders under app/views (components/, styles/, assets/) are importable by
// name, e.g. `import Nav from 'components/nav'`.
import Link from 'next/link';
import withHenri from '@usehenri/react';

const Home = ({ data: { tasks = [] }, getRoute, user }) => (
  <div className="main">
    <h1>welcome to henri{user ? `, ${user.email}` : ''}</h1>
    <p>
      <Link href={getRoute('index_tasks_path')}>Tasks</Link>
      {' | '}
      <Link href={getRoute('new_tasks_path')}>New task</Link>
    </p>
    {tasks.length === 0 ? (
      <p>No tasks yet.</p>
    ) : (
      <ul>
        {tasks.map((task) => (
          <li key={String(task._id ?? task.id)}>
            <Link
              href={getRoute('show_tasks_path', String(task._id ?? task.id))}
            >
              {task.name}
            </Link>
            {task.category ? ` (${task.category})` : ''}
          </li>
        ))}
      </ul>
    )}
  </div>
);

export default withHenri(Home);
