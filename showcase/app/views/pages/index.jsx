// The home page. useHenri() gives what the controller passed to res.render():
// data, user, paths, flash, csrf and the pathFor/getRoute/fetch helpers.
import { Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import {
  Badge,
  Empty,
  PageHeader,
  card,
  primary,
  secondary,
} from 'components/ui';

const STATE_LABELS = {
  announced: 'programme announced',
  closed: 'call for papers closed',
  draft: 'not announced yet',
  open: 'call for papers open',
};

/**
 * Whole days between now and a date, never negative
 *
 * @param {?string} date An ISO date
 * @returns {?number} The number of days, or null
 */
const daysLeft = (date) => {
  if (!date) {
    return null;
  }

  const left = Math.ceil((new Date(date) - Date.now()) / 86400000);

  return left > 0 ? left : 0;
};

export default function Home() {
  const { data, getRoute, user } = useHenri();
  const { counts, event, highlight, lineup } = data;

  if (!event) {
    return (
      <Layout>
        <PageHeader
          title="Lineup"
          subtitle="No edition has been created yet."
        />
        <div className="mt-8">
          <Empty>Run `henri db:seed` to fill the database.</Empty>
        </div>
      </Layout>
    );
  }

  const left = event.state === 'open' ? daysLeft(event.closesAt) : null;

  return (
    <Layout>
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={event.state === 'open' ? 'submitted' : 'neutral'}>
            {STATE_LABELS[event.state]}
          </Badge>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {event.city} &middot; {event.year}
          </span>
        </div>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          {event.name}
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
          {event.summary}
        </p>
        {left !== null && (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            {left === 0
              ? 'The call for papers closes today.'
              : `${left} days left to submit.`}
          </p>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            className={primary}
            href={
              user
                ? getRoute('new_proposals_path')
                : getRoute('new_accounts_path')
            }
          >
            {user ? 'Write a proposal' : 'Create an account to submit'}
          </Link>
          <Link className={secondary} href={getRoute('index_proposals_path')}>
            Read the proposals
          </Link>
        </div>
      </section>

      <dl className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ['Submitted', counts.submitted],
          ['Accepted', counts.accepted],
          ['Speakers', counts.speakers],
          ['Tracks', counts.tracks],
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
      </dl>

      <section className="mt-14">
        <h2 className="text-xl font-semibold tracking-tight">
          {highlight === 'accepted' ? 'On the programme' : 'Just submitted'}
        </h2>
        {lineup.length === 0 ? (
          <div className="mt-4">
            <Empty>Nothing here yet.</Empty>
          </div>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {lineup.map((proposal) => (
              <li key={proposal.id} className={`${card} p-5`}>
                <Link
                  className="font-medium hover:underline"
                  href={getRoute('show_proposals_path', String(proposal.id))}
                >
                  {proposal.title}
                </Link>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {proposal.speaker ? proposal.speaker.name : 'Unknown speaker'}
                  {proposal.track ? ` · ${proposal.track.name}` : ''}
                </p>
                <p className="mt-3 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                  {proposal.abstract}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Layout>
  );
}
