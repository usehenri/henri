// The trash: `Proposal.onlyDeleted()`, which is what
// `options: { paranoid: true }` buys. A withdrawn proposal is invisible to
// every other query in the application, keeps its reviews, and comes back
// with `proposal.restore()`.
import { Form, Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { Empty, PageHeader, card, secondary } from 'components/ui';

/**
 * A date as a short, locale independent string
 *
 * @param {?string} value An ISO date
 * @returns {string} The date, or a dash
 */
const day = (value) => (value ? String(value).slice(0, 10) : '—');

export default function Withdrawn() {
  const { data, getRoute, pathFor } = useHenri();
  const proposals = data.proposals || [];

  return (
    <Layout>
      <Link
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        href={getRoute('index_admin/dashboard_path')}
      >
        &larr; Committee
      </Link>

      <div className="mt-3">
        <PageHeader
          title="Withdrawn"
          subtitle="Soft deleted rows. They are hidden from every query in the application until an admin restores them."
        />
      </div>

      {proposals.length === 0 ? (
        <div className="mt-8">
          <Empty>Nothing has been withdrawn.</Empty>
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
                  {proposal.speaker ? proposal.speaker.name : '—'} &middot;
                  withdrawn {day(proposal.deletedAt)}
                </p>
              </div>
              <Form
                action={pathFor('restore_admin/proposals_path', {
                  id: proposal.externalId,
                })}
              >
                {({ processing }) => (
                  <button
                    className={secondary}
                    disabled={processing}
                    type="submit"
                  >
                    Restore
                  </button>
                )}
              </Form>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  );
}
