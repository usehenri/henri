// useHenri() gives what the controller passed to res.render(): data, user,
// paths, localUrl and the fetch/hydrate/pathFor/getRoute helpers. <Link>
// navigates to another page without reloading the document (Inertia).
// Folders under app/views (components/, styles/, assets/) are importable by
// name, e.g. `import Nav from 'components/nav'`.
//
// The classes are Tailwind CSS v4 (app/views/styles/index.css). `dark:`
// follows the operating system, so this page has a dark mode for free.
import { Link, useHenri } from '@usehenri/inertia';

const button =
  'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition';
const primary = `${button} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200`;
const secondary = `${button} border border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900`;
const code =
  'rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.8em] dark:bg-zinc-800';

export default function Home() {
  // `data` is what app/controllers/main.js handed to res.render()
  const { data, getRoute, user } = useHenri();
  const tasks = data.tasks || [];

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
        henri
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">
        Welcome{user ? `, ${user.email}` : ''}
      </h1>
      <p className="mt-4 max-w-xl text-zinc-600 dark:text-zinc-400">
        Models, controllers, routes and React views, server side rendered. This
        page is <code className={code}>app/views/pages/index.jsx</code> and its
        tasks come from <code className={code}>app/controllers/main.js</code>.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link className={primary} href={getRoute('new_tasks_path')}>
          New task
        </Link>
        <Link className={secondary} href={getRoute('index_tasks_path')}>
          All tasks
        </Link>
      </div>

      <section className="mt-14 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <header className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-zinc-50 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-medium">Tasks</h2>
          <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            {tasks.length}
          </span>
        </header>

        {tasks.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No tasks yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {tasks.map((task) => (
              <li
                key={task.externalId}
                className="flex items-center justify-between gap-4 px-5 py-3"
              >
                <Link
                  className="text-sm font-medium hover:underline"
                  href={getRoute('show_tasks_path', task.externalId)}
                >
                  {task.name}
                </Link>
                {task.category ? (
                  <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    {task.category}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
