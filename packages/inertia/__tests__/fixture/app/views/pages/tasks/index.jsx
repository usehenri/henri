import { useHenri } from '@usehenri/inertia';

export default function Tasks() {
  const { data } = useHenri();

  return (
    <ul>
      {(data.tasks || []).map((task) => (
        <li key={task.name}>{task.name}</li>
      ))}
    </ul>
  );
}
