// One proposal. The same url answers a HAL resource to an API client, which
// is the third request of the API explorer.
import { Form, Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import {
  Badge,
  Fact,
  PageHeader,
  card,
  danger,
  primary,
  secondary,
} from 'components/ui';

/**
 * A date as a short, locale independent string
 *
 * @param {?string} value An ISO date
 * @returns {string} The date, or a dash
 */
const day = (value) => (value ? String(value).slice(0, 10) : '—');

export default function ProposalShow() {
  const { data, getRoute, pathFor } = useHenri();
  const { editable, proposal } = data;
  const id = String(proposal.id);

  return (
    <Layout>
      <Link
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        href={getRoute('index_proposals_path')}
      >
        &larr; Proposals
      </Link>

      <div className="mt-3">
        <PageHeader
          title={proposal.title}
          subtitle={
            proposal.speaker
              ? `${proposal.speaker.name}${
                  proposal.speaker.company
                    ? ` · ${proposal.speaker.company}`
                    : ''
                }`
              : null
          }
        >
          <Badge tone={proposal.state}>{proposal.state}</Badge>
        </PageHeader>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_16rem]">
        <article className="prose-zinc max-w-none whitespace-pre-line text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
          {proposal.abstract}
        </article>

        <aside className={`${card} grid gap-4 self-start p-6`}>
          <Fact term="Edition">
            {proposal.event ? proposal.event.name : '—'}
          </Fact>
          <Fact term="Track">{proposal.track ? proposal.track.name : '—'}</Fact>
          <Fact term="Format">{proposal.format}</Fact>
          <Fact term="Level">{proposal.level}</Fact>
          <Fact term="Submitted">{day(proposal.submittedAt)}</Fact>
          {proposal.decidedAt && (
            <Fact term="Decided">{day(proposal.decidedAt)}</Fact>
          )}
          {typeof proposal.score === 'number' && (
            <Fact term="Committee score">{proposal.score}</Fact>
          )}
        </aside>
      </div>

      {editable && (
        <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          {proposal.state === 'draft' && (
            <>
              <Link
                className={secondary}
                href={getRoute('edit_proposals_path', id)}
              >
                Edit the draft
              </Link>
              <Form action={pathFor('submit_proposals_path', { id })}>
                {({ processing }) => (
                  <button
                    className={primary}
                    disabled={processing}
                    type="submit"
                  >
                    Submit to the committee
                  </button>
                )}
              </Form>
            </>
          )}
          <Form action={pathFor('withdraw_proposals_path', { id })}>
            {({ processing }) => (
              <button className={danger} disabled={processing} type="submit">
                Withdraw
              </button>
            )}
          </Form>
          <p className="w-full text-xs text-zinc-500 dark:text-zinc-400">
            Withdrawing soft deletes the proposal: the row keeps its reviews and
            the committee can put it back.
          </p>
        </div>
      )}

      {proposal.reviews && (
        <section className="mt-12">
          <h2 className="text-xl font-semibold tracking-tight">
            Reviews ({proposal.reviews.length})
          </h2>
          <ul className="mt-4 grid gap-3">
            {proposal.reviews.map((review) => (
              <li key={review.id} className={`${card} px-5 py-4`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">
                    {review.reviewer ? review.reviewer.name : '—'}
                  </span>
                  <span className="text-sm tabular-nums">{review.score}</span>
                </div>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {review.comment}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Layout>
  );
}
