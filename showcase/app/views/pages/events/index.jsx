import { Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { Badge, Empty, PageHeader, card } from 'components/ui';

const TONES = {
  announced: 'accepted',
  closed: 'neutral',
  draft: 'draft',
  open: 'submitted',
};

export default function EventsIndex() {
  const { data, getRoute } = useHenri();
  const events = data.events || [];

  return (
    <Layout>
      <PageHeader
        title="Editions"
        subtitle="Every edition of the conference, with its tracks and the proposals it received."
      />

      {events.length === 0 ? (
        <div className="mt-8">
          <Empty>No edition yet.</Empty>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4">
          {events.map((event) => (
            <li key={event.id} className={`${card} p-6`}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <Link
                  className="text-lg font-medium hover:underline"
                  href={getRoute('show_events_path', String(event.id))}
                >
                  {event.name}
                </Link>
                <Badge tone={TONES[event.state]}>{event.state}</Badge>
              </div>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {event.city} &middot; {event.proposals} proposals
              </p>
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                {event.summary}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  );
}
