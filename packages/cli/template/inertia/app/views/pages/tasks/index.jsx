// Forms submit through Inertia: the controller answers with a redirect (or
// renders the page again with `res.inertia.errors()`), no API to write.
//
// The classes are Tailwind CSS v4 (app/views/styles/index.css). The strings
// below are named so the markup stays readable.
import { Form, Link, useHenri } from '@usehenri/inertia';

const field =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10';
const button =
  'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50';
const primary = `${button} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200`;

export default function TasksIndex() {
  const { data, getRoute, pathFor } = useHenri();
  const tasks = data.tasks || [];

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <Link
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        href={getRoute('home_main_path')}
      >
        &larr; Home
      </Link>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Tasks</h1>

      <Form
        action={pathFor('create_tasks_path')}
        className="mt-8 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
        resetOnSuccess
      >
        {({ errors, processing }) => (
          <>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                className={field}
                name="name"
                placeholder="What needs to be done?"
              />
              <select
                className={`${field} sm:w-40`}
                defaultValue="low"
                name="category"
              >
                <option value="urgent">urgent</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
              <button className={primary} disabled={processing} type="submit">
                Add
              </button>
            </div>
            {errors.name && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">
                {errors.name}
              </p>
            )}
          </>
        )}
      </Form>

      <ul className="mt-8 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        {tasks.length === 0 && (
          <li className="px-5 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Nothing to do yet.
          </li>
        )}
        {tasks.map((task) => (
          <li
            key={String(task._id ?? task.id)}
            className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-3 last:border-0 dark:border-zinc-800"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {task.name}
            </span>
            <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              {task.category}
            </span>
            <Form
              action={pathFor(
                'destroy_tasks_path',
                String(task._id ?? task.id)
              )}
              method="delete"
            >
              <button
                className="text-sm text-zinc-500 transition hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400"
                type="submit"
              >
                Remove
              </button>
            </Form>
          </li>
        ))}
      </ul>
    </main>
  );
}
