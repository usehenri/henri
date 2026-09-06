// A collection route: GET /proposals/mine, registered before /proposals/:id
// so `mine` is never taken for an id.
import { Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { Badge, Empty, PageHeader, card, primary } from 'components/ui';

export default function MyProposals() {
  const { data, getRoute } = useHenri();
  const proposals = data.proposals || [];

  return (
    <Layout>
      <PageHeader
        title="My proposals"
        subtitle="Drafts are only visible to you and the committee. Withdrawn ones are gone from this list, but the committee can restore them."
      >
        <Link className={primary} href={getRoute('new_proposals_path')}>
          New proposal
        </Link>
      </PageHeader>

      {proposals.length === 0 ? (
        <div className="mt-8">
          <Empty>You have not written a proposal yet.</Empty>
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
                  href={getRoute('show_proposals_path', proposal.externalId)}
                >
                  {proposal.title}
                </Link>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {proposal.event ? proposal.event.name : '—'}
                  {proposal.track ? ` · ${proposal.track.name}` : ''}
                </p>
              </div>
              <Badge tone={proposal.state}>{proposal.state}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  );
}
