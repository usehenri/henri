// One proposal, seen by the committee: the reviews, the form to add one
// (POST /proposals/:proposal_id/reviews, a nested resource) and the decision
// (POST /admin/proposals/:id/decide, a member route).
import { Form, Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import {
  Badge,
  Fact,
  PageHeader,
  card,
  field,
  label,
  primary,
  secondary,
} from 'components/ui';

const SCORES = [
  [2, '+2 strong yes'],
  [1, '+1 yes'],
  [0, '0 neutral'],
  [-1, '−1 no'],
  [-2, '−2 strong no'],
];

/**
 * A date as a short, locale independent string
 *
 * @param {?string} value An ISO date
 * @returns {string} The date, or a dash
 */
const day = (value) => (value ? String(value).slice(0, 10) : '—');

export default function AdminProposalShow() {
  const { data, getRoute, pathFor } = useHenri();
  const { mine, proposal } = data;
  const id = String(proposal.id);

  return (
    <Layout>
      <Link
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        href={getRoute('index_admin/proposals_path')}
      >
        &larr; Review queue
      </Link>

      <div className="mt-3">
        <PageHeader
          title={proposal.title}
          subtitle={proposal.speaker ? proposal.speaker.name : null}
        >
          <Badge tone={proposal.state}>{proposal.state}</Badge>
        </PageHeader>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_16rem]">
        <div>
          <article className="whitespace-pre-line text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
            {proposal.abstract}
          </article>

          {proposal.state === 'submitted' && (
            <div className="mt-8 flex flex-wrap gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
              <Form action={pathFor('decide_admin/proposals_path', { id })}>
                {({ processing }) => (
                  <>
                    <input name="state" type="hidden" value="accepted" />
                    <button
                      className={primary}
                      disabled={processing}
                      type="submit"
                    >
                      Accept
                    </button>
                  </>
                )}
              </Form>
              <Form action={pathFor('decide_admin/proposals_path', { id })}>
                {({ processing }) => (
                  <>
                    <input name="state" type="hidden" value="rejected" />
                    <button
                      className={secondary}
                      disabled={processing}
                      type="submit"
                    >
                      Reject
                    </button>
                  </>
                )}
              </Form>
            </div>
          )}

          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight">
              Reviews ({proposal.reviews.length})
            </h2>

            {proposal.reviews.length === 0 && (
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                Nobody has reviewed this one yet.
              </p>
            )}

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

            {mine ? (
              <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
                You have already reviewed this proposal. A second one would
                answer 409.
              </p>
            ) : (
              <Form
                action={pathFor('create_reviews_path', { proposal_id: id })}
                className={`${card} mt-6 grid gap-4 p-6`}
              >
                {({ errors, processing }) => (
                  <>
                    <div>
                      <label className={label} htmlFor="score">
                        Score
                      </label>
                      <select
                        className={`${field} mt-1`}
                        defaultValue="1"
                        id="score"
                        name="score"
                      >
                        {SCORES.map(([value, text]) => (
                          <option key={value} value={value}>
                            {text}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={label} htmlFor="comment">
                        Comment
                      </label>
                      <textarea
                        className={`${field} mt-1`}
                        id="comment"
                        name="comment"
                        placeholder="Ten characters or more, and something the speaker could read."
                        rows={4}
                      />
                      {errors.comment && (
                        <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                          {errors.comment}
                        </p>
                      )}
                    </div>

                    <div>
                      <button
                        className={primary}
                        disabled={processing}
                        type="submit"
                      >
                        Record the review
                      </button>
                    </div>
                  </>
                )}
              </Form>
            )}
          </section>
        </div>

        <aside className={`${card} grid gap-4 self-start p-6`}>
          <Fact term="Edition">
            {proposal.event ? proposal.event.name : '—'}
          </Fact>
          <Fact term="Track">{proposal.track ? proposal.track.name : '—'}</Fact>
          <Fact term="Format">{proposal.format}</Fact>
          <Fact term="Level">{proposal.level}</Fact>
          <Fact term="Submitted">{day(proposal.submittedAt)}</Fact>
          <Fact term="Decided">{day(proposal.decidedAt)}</Fact>
          <Fact term="Score">
            {proposal.score === null ? '—' : proposal.score}
          </Fact>
          {proposal.deletedAt && (
            <Fact term="Withdrawn">{day(proposal.deletedAt)}</Fact>
          )}
        </aside>
      </div>
    </Layout>
  );
}
