// The review queue, paginated with Model.paginate(req.pagination()).
import { Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { Badge, Empty, PageHeader, Pagination, card } from 'components/ui';

const STATES = ['submitted', 'accepted', 'rejected', 'draft'];

const chip =
  'rounded-full border px-3 py-1 text-xs font-medium transition border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';
const chipOn =
  'rounded-full border px-3 py-1 text-xs font-medium border-brand-600 bg-brand-600 text-white';

export default function AdminProposals() {
  const { data, getRoute } = useHenri();
  const { page, pages, proposals, state, total } = data;
  const base = getRoute('index_admin/proposals_path');

  return (
    <Layout>
      <PageHeader
        title="Review queue"
        subtitle="Sorted by the day they were submitted. The score is the average of the committee's reviews."
      />

      <div className="mt-6 flex flex-wrap gap-2">
        {STATES.map((value) => (
          <Link
            key={value}
            className={state === value ? chipOn : chip}
            href={`${base}?state=${value}`}
          >
            {value}
          </Link>
        ))}
      </div>

      {proposals.length === 0 ? (
        <div className="mt-8">
          <Empty>Nothing in this state.</Empty>
        </div>
      ) : (
        <ul className="mt-8 grid gap-3">
          {proposals.map((proposal) => (
            <li
              key={proposal.externalId}
              className={`${card} flex flex-wrap items-center justify-between gap-4 px-5 py-4`}
            >
              <div className="min-w-0">
                <Link
                  className="font-medium hover:underline"
                  href={getRoute(
                    'show_admin/proposals_path',
                    proposal.externalId
                  )}
                >
                  {proposal.title}
                </Link>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {proposal.speaker ? proposal.speaker.name : '—'}
                  {proposal.track
                    ? ` · ${proposal.track.name}`
                    : ''} &middot; {proposal.event ? proposal.event.name : '—'}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {proposal.reviews} review{proposal.reviews === 1 ? '' : 's'}
                </span>
                <span className="w-8 text-right text-sm font-medium tabular-nums">
                  {proposal.score === null ? '—' : proposal.score}
                </span>
                <Badge tone={proposal.state}>{proposal.state}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={page}
        pages={pages}
        path={base}
        query={{ state }}
        total={total}
      />
    </Layout>
  );
}
