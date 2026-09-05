// Forms submit through Inertia: the controller answers with a redirect (or
// renders the page again with `res.inertia.errors()`), no API to write.
import { Form, Link, useHenri } from '@usehenri/inertia';

export default function TasksIndex() {
  const { data, getRoute, pathFor } = useHenri();
  const tasks = data.tasks || [];

  return (
    <div className="main">
      <h1>tasks</h1>

      <Form action={pathFor('create_tasks_path')} resetOnSuccess>
        {({ errors, processing }) => (
          <>
            <input name="name" placeholder="what needs to be done?" />
            <select name="category" defaultValue="low">
              <option value="urgent">urgent</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
            <button type="submit" disabled={processing}>
              add
            </button>
            {errors.name && <p className="error">{errors.name}</p>}
          </>
        )}
      </Form>

      <ul>
        {tasks.map((task) => (
          <li key={String(task._id ?? task.id)}>
            {task.name} ({task.category}){' '}
            <Form
              action={pathFor(
                'destroy_tasks_path',
                String(task._id ?? task.id)
              )}
              method="delete"
            >
              <button type="submit">remove</button>
            </Form>
          </li>
        ))}
      </ul>

      <Link href={getRoute('home_main_path')}>home</Link>
    </div>
  );
}
