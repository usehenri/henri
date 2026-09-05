// useHenri() gives what the controller passed to res.render(): data, user,
// paths, localUrl and the pathFor/getRoute/fetch/hydrate helpers. <Link>
// navigates between pages without reloading the document (Inertia).
//
// The classes are Tailwind CSS v4 (app/views/styles/index.css). `dark:`
// follows the operating system, so this page has a dark mode for free.
import { Link, useHenri } from '@usehenri/inertia';

const code =
  'rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.8em] dark:bg-zinc-800';

const steps = [
  ['app/controllers/main.js', 'renders this page'],
  ['app/views/pages/index.jsx', 'is this page'],
  ['config/routes.js', 'maps the URLs to the controllers'],
  ['app/models/Task.js', 'is the sample model'],
];

export default function Home() {
  const { user, getRoute } = useHenri();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
        henri
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">
        Welcome{user ? `, ${user.email}` : ''}
      </h1>
      <p className="mt-4 max-w-xl text-zinc-600 dark:text-zinc-400">
        Models, controllers, routes and Inertia pages, server side rendered.
        Edit <code className={code}>app/views/pages/index.jsx</code> and the
        page reloads itself.
      </p>

      <div className="mt-8">
        <Link
          className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          href={getRoute('index_tasks_path')}
        >
          Open the tasks
        </Link>
      </div>

      <dl className="mt-14 overflow-hidden rounded-xl border border-zinc-200 text-sm dark:border-zinc-800">
        {steps.map(([file, what]) => (
          <div
            key={file}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-zinc-200 px-5 py-3 last:border-0 dark:border-zinc-800"
          >
            <dt className="font-mono text-xs">{file}</dt>
            <dd className="text-zinc-500 dark:text-zinc-400">{what}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
