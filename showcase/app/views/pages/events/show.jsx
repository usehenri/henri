import { Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { Badge, Empty, Fact, PageHeader, card } from 'components/ui';

/**
 * A date as a short, locale independent string
 *
 * @param {?string} value An ISO date
 * @returns {string} The date, or a dash
 */
const day = (value) => (value ? String(value).slice(0, 10) : '—');

export default function EventShow() {
  const { data, getRoute, pathFor } = useHenri();
  const { event, lineup, tracks } = data;

  return (
    <Layout>
      <Link
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        href={getRoute('index_events_path')}
      >
        &larr; Editions
      </Link>

      <div className="mt-3">
        <PageHeader title={event.name} subtitle={event.summary}>
          <Badge>{event.state}</Badge>
        </PageHeader>
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Fact term="City">{event.city}</Fact>
        <Fact term="Opens">{day(event.opensAt)}</Fact>
        <Fact term="Closes">{day(event.closesAt)}</Fact>
        <Fact term="Tracks">
          <Link
            className="underline"
            href={String(
              pathFor('index_tracks_path', { event_id: event.externalId })
            )}
          >
            {tracks.length} tracks
          </Link>
        </Fact>
      </dl>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">
          {event.state === 'announced' ? 'Programme' : 'Accepted so far'}
        </h2>
        {lineup.length === 0 ? (
          <div className="mt-4">
            <Empty>No talk has been accepted yet.</Empty>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3">
            {lineup.map((proposal) => (
              <li
                key={proposal.externalId}
                className={`${card} flex flex-wrap items-baseline justify-between gap-3 px-5 py-4`}
              >
                <Link
                  className="font-medium hover:underline"
                  href={getRoute('show_proposals_path', proposal.externalId)}
                >
                  {proposal.title}
                </Link>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {proposal.speaker ? proposal.speaker.name : '—'}
                  {proposal.track ? ` · ${proposal.track.name}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Layout>
  );
}
