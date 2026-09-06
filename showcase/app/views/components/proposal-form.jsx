// The form behind /proposals/new and /proposals/:id/edit.
//
// It posts through Inertia's <Form>, so the controller answers with a
// redirect when the record is written and renders the page again after
// `res.inertia.errors()` when it is not: the messages below come from the
// model's own validations, normalized by `henri.model.errors()`.
import { Form } from '@usehenri/inertia';
import { card, field, label, primary } from 'components/ui';

const FORMATS = ['talk', 'workshop', 'lightning'];
const LEVELS = ['beginner', 'intermediate', 'advanced'];

/**
 * The error of one field, when the server sent one
 *
 * @param {object} props The props
 * @param {object} props.errors The errors of the render prop
 * @param {string} props.name The field name
 * @returns {?React.ReactElement} The message
 */
function FieldError({ errors, name }) {
  if (!errors[name]) {
    return null;
  }

  return (
    <p className="mt-1 text-sm text-red-600 dark:text-red-400">
      {errors[name]}
    </p>
  );
}

/**
 * The proposal form
 *
 * @param {object} props The props
 * @param {object} props.action The pathFor() result to post to
 * @param {string} [props.method] The http method (`post` by default)
 * @param {object} props.proposal The values to start from
 * @param {Array<object>} props.events The editions taking submissions
 * @param {Array<object>} props.tracks The tracks of those editions
 * @param {string} props.submit The label of the submit button
 * @returns {React.ReactElement} The form
 */
export default function ProposalForm({
  action,
  method,
  proposal,
  events,
  tracks,
  submit,
}) {
  return (
    <Form
      action={action}
      className={`${card} mt-8 grid gap-5 p-6`}
      method={method}
    >
      {({ errors, processing }) => (
        <>
          <div>
            <label className={label} htmlFor="title">
              Title
            </label>
            <input
              className={`${field} mt-1`}
              defaultValue={proposal.title || ''}
              id="title"
              maxLength={120}
              name="title"
              placeholder="Eight characters or more"
            />
            <FieldError errors={errors} name="title" />
          </div>

          <div>
            <label className={label} htmlFor="abstract">
              Abstract
            </label>
            <textarea
              className={`${field} mt-1`}
              defaultValue={proposal.abstract || ''}
              id="abstract"
              name="abstract"
              placeholder="What the talk is about, and who it is for. Sixty characters or more."
              rows={8}
            />
            <FieldError errors={errors} name="abstract" />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="eventId">
                Edition
              </label>
              <select
                className={`${field} mt-1`}
                defaultValue={proposal.eventId || ''}
                id="eventId"
                name="eventId"
              >
                <option value="">Choose an edition</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
              <FieldError errors={errors} name="eventId" />
            </div>

            <div>
              <label className={label} htmlFor="trackId">
                Track
              </label>
              <select
                className={`${field} mt-1`}
                defaultValue={proposal.trackId || ''}
                id="trackId"
                name="trackId"
              >
                <option value="">Undecided</option>
                {tracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
              <FieldError errors={errors} name="trackId" />
            </div>

            <div>
              <label className={label} htmlFor="format">
                Format
              </label>
              <select
                className={`${field} mt-1`}
                defaultValue={proposal.format || 'talk'}
                id="format"
                name="format"
              >
                {FORMATS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={label} htmlFor="level">
                Level
              </label>
              <select
                className={`${field} mt-1`}
                defaultValue={proposal.level || 'intermediate'}
                id="level"
                name="level"
              >
                {LEVELS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <button className={primary} disabled={processing} type="submit">
              {submit}
            </button>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Saved as a draft. Nobody but you and the committee sees it until
              you submit it.
            </p>
          </div>
        </>
      )}
    </Form>
  );
}
