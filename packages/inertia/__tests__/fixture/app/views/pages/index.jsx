import { Head, Link, useHenri } from '@usehenri/inertia';

export default function Home() {
  const { data, user, getRoute } = useHenri();

  return (
    <main>
      <Head title="fixture home" />
      <h1>hello from the fixture</h1>
      <p className="greeting">{data.greeting}</p>
      <p className="user">{user ? user.email : 'guest'}</p>
      <Link href={getRoute('index_tasks_path')}>tasks</Link>
    </main>
  );
}
