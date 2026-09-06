// GET /admin — the page of the `root` route of the admin namespace.
// The action returns an object without answering, so henri renders this page
// with it (implicit rendering: /admin/dashboard -> admin/dashboard/index.jsx).
import { Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { Badge, Empty, PageHeader, card, secondary } from 'components/ui';

export default function Dashboard() {
  const { data, getRoute } = useHenri();
  const { counts, events, queue, reviews, speakers, unreviewed, withdrawn } =
    data;
  const proposalsPath = getRoute('index_admin/proposals_path');

  return (
    <Layout>
      <PageHeader
        title="Committee"
        subtitle="Everything on this page is behind roles: ['admin']. A speaker asking for it in a browser lands on the login page; an API client gets a 403."
      >
        <Link className={secondary} href={getRoute('index_admin/users_path')}>
          People
        </Link>
        <Link className={secondary} href={proposalsPath}>
          Review queue
        </Link>
      </PageHeader>

      <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ['Submitted', counts.submitted],
          ['Accepted', counts.accepted],
          ['Rejected', counts.rejected],
          ['Drafts', counts.draft],
          ['Speakers', speakers],
          ['Withdrawn', withdrawn],
          ['Waiting for a first review', unreviewed],
        ].map(([term, value]) => (
          <div key={term} className={`${card} px-5 py-4`}>
            <dt className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {term}
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {value}
            </dd>
          </div>
        ))}
        <Link
          className={`${card} flex flex-col justify-center px-5 py-4 hover:border-brand-500`}
          href={getRoute('withdrawn_admin/proposals_path')}
        >
          <span className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Trash
          </span>
          <span className="mt-1 text-sm">Withdrawn proposals &rarr;</span>
        </Link>
      </dl>

      <div className="mt-12 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-xl font-semibold tracking-tight">
            Best rated, still undecided
          </h2>
          {queue.length === 0 ? (
            <div className="mt-4">
              <Empty>Nothing is waiting for a decision.</Empty>
            </div>
          ) : (
            <ul className="mt-4 grid gap-3">
              {queue.map((entry) => (
                <li
                  key={entry.id}
                  className={`${card} flex items-center justify-between gap-4 px-5 py-3`}
                >
                  <div className="min-w-0">
                    <Link
                      className="font-medium hover:underline"
                      href={getRoute(
                        'show_admin/proposals_path',
                        String(entry.id)
                      )}
                    >
                      {entry.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {entry.speaker}
                      {entry.track ? ` · ${entry.track}` : ''} &middot;{' '}
                      {entry.reviews} review{entry.reviews === 1 ? '' : 's'}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums">
                    {entry.score === null ? '—' : entry.score}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-xl font-semibold tracking-tight">
            Latest reviews
          </h2>
          {reviews.length === 0 ? (
            <div className="mt-4">
              <Empty>No review yet.</Empty>
            </div>
          ) : (
            <ul className="mt-4 grid gap-3">
              {reviews.map((review) => (
                <li key={review.id} className={`${card} px-5 py-3`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">
                      {review.reviewer}
                    </span>
                    <span className="text-sm tabular-nums">{review.score}</span>
                  </div>
                  {review.proposal && (
                    <Link
                      className="mt-0.5 block text-xs text-zinc-500 hover:underline dark:text-zinc-400"
                      href={getRoute(
                        'show_admin/proposals_path',
                        String(review.proposal.id)
                      )}
                    >
                      {review.proposal.title}
                    </Link>
                  )}
                  <p className="mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {review.comment}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">Editions</h2>
        <ul className="mt-4 flex flex-wrap gap-3">
          {events.map((event) => (
            <li key={event.id} className={`${card} px-5 py-3`}>
              <span className="text-sm font-medium">{event.name}</span>{' '}
              <Badge tone={event.state === 'open' ? 'submitted' : 'neutral'}>
                {event.state}
              </Badge>
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  );
}
