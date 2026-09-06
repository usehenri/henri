// The page of a nested resource: `resources tracks` lives inside
// `resources events`, so this list is always the list of one edition.
import { Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { Empty, PageHeader, card, mono } from 'components/ui';

export default function TracksIndex() {
  const { data, getRoute } = useHenri();
  const { event, tracks } = data;

  return (
    <Layout>
      <Link
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        href={getRoute('show_events_path', String(event.id))}
      >
        &larr; {event.name}
      </Link>

      <div className="mt-3">
        <PageHeader
          title="Tracks"
          subtitle={`GET /events/${event.id}/tracks — a resource nested under one edition.`}
        />
      </div>

      {tracks.length === 0 ? (
        <div className="mt-8">
          <Empty>This edition has no track.</Empty>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {tracks.map((track) => (
            <li key={track.id} className={`${card} p-6`}>
              <h2 className="font-medium">{track.name}</h2>
              <p className={`${mono} mt-1 text-zinc-500 dark:text-zinc-400`}>
                {track.slug}
              </p>
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                {track.blurb}
              </p>
              <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                {track.accepted} accepted
              </p>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  );
}
