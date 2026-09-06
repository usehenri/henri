// The public list. It is paginated by `Proposal.paginate(req.pagination())`,
// which is one query for the page and the counters; the same action answers
// a HAL collection to an API client (see the API explorer).
import { Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { Badge, Empty, PageHeader, Pagination, card } from 'components/ui';

const chip =
  'rounded-full border px-3 py-1 text-xs font-medium transition border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';
const chipOn =
  'rounded-full border px-3 py-1 text-xs font-medium border-brand-600 bg-brand-600 text-white';

export default function ProposalsIndex() {
  const { data, getRoute } = useHenri();
  const { editions, filters, page, pages, proposals, total } = data;
  const base = getRoute('index_proposals_path');

  const href = (patch) => {
    const params = new URLSearchParams(
      Object.entries({ ...filters, ...patch }).filter(([, value]) => value)
    );
    const query = params.toString();

    return query ? `${base}?${query}` : base;
  };

  return (
    <Layout>
      <PageHeader
        title="Proposals"
        subtitle="Everything that has been submitted or accepted, across every edition. Drafts and rejections stay between the speaker and the committee."
      />

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          className={filters.state ? chip : chipOn}
          href={href({ state: '' })}
        >
          All states
        </Link>
        {['submitted', 'accepted'].map((state) => (
          <Link
            key={state}
            className={filters.state === state ? chipOn : chip}
            href={href({ state })}
          >
            {state}
          </Link>
        ))}

        <span className="w-full sm:hidden" />

        <Link
          className={filters.event ? chip : chipOn}
          href={href({ event: '' })}
        >
          All editions
        </Link>
        {(editions || []).map((event) => (
          <Link
            key={event.externalId}
            className={filters.event === event.externalId ? chipOn : chip}
            href={href({ event: event.externalId })}
          >
            {event.year}
          </Link>
        ))}
      </div>

      {proposals.length === 0 ? (
        <div className="mt-8">
          <Empty>Nothing matches those filters.</Empty>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4">
          {proposals.map((proposal) => (
            <li key={proposal.externalId} className={`${card} p-6`}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <Link
                  className="text-lg font-medium hover:underline"
                  href={getRoute('show_proposals_path', proposal.externalId)}
                >
                  {proposal.title}
                </Link>
                <Badge tone={proposal.state}>{proposal.state}</Badge>
              </div>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {proposal.speaker ? proposal.speaker.name : '—'}
                {proposal.speaker && proposal.speaker.company
                  ? ` · ${proposal.speaker.company}`
                  : ''}
                {proposal.track ? ` · ${proposal.track.name}` : ''}
                {proposal.event ? ` · ${proposal.event.name}` : ''}
              </p>
              <p className="mt-3 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                {proposal.abstract}
              </p>
              <p className="mt-3 text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                {proposal.format} &middot; {proposal.level}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={page}
        pages={pages}
        path={base}
        query={filters}
        total={total}
      />
    </Layout>
  );
}
