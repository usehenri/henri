// Registration. The form posts to `POST /signup`, which henri mounts because
// config.user.signup says so: nothing in this application creates the user,
// hashes the password or opens the session.
//
// A refused signup redirects back here with the messages per field in
// `errors` and what was typed in `flash.values`, so the page fills itself in
// again. The <Form> of @usehenri/inertia adds the hidden `_csrf` field.
import { Form, Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { card, field, label, primary } from 'components/ui';

/** The label of a field the configuration permits */
const TITLES = { bio: 'Bio', company: 'Company (optional)', name: 'Name' };

/**
 * One labelled input, with the server's error under it
 *
 * @param {object} props The props
 * @param {string} props.name The field name
 * @param {string} props.title The label
 * @param {object} props.errors The errors of the render prop
 * @param {object} [props.rest] Anything the input accepts
 * @returns {React.ReactElement} The field
 */
function Field({ name, title, errors, ...rest }) {
  return (
    <div>
      <label className={label} htmlFor={name}>
        {title}
      </label>
      <input className={`${field} mt-1`} id={name} name={name} {...rest} />
      {errors[name] && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">
          {errors[name]}
        </p>
      )}
    </div>
  );
}

export default function Signup() {
  const { data, errors, flash, getRoute } = useHenri();
  const values = (flash.values && flash.values[0]) || {};
  const sent = errors || {};

  return (
    <Layout>
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight">
          Create an account
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Speakers write proposals; the committee reviews them. New accounts get
          the <code className="font-mono">speaker</code> role, which is what{' '}
          <code className="font-mono">config.baseRole</code> says, and a form
          can never ask for another one.
        </p>

        <Form action="/signup" className={`${card} mt-6 grid gap-4 p-6`}>
          {({ processing }) => (
            <>
              {(data.fields || []).map((name) => (
                <Field
                  defaultValue={values[name] || ''}
                  errors={sent}
                  key={name}
                  name={name}
                  required={name === 'name'}
                  title={TITLES[name] || name}
                />
              ))}
              <Field
                autoComplete="email"
                defaultValue={values.email || ''}
                errors={sent}
                name="email"
                required
                title="Email"
                type="email"
              />
              <Field
                autoComplete="new-password"
                errors={sent}
                minLength={data.minLength}
                name="password"
                required
                title={`Password (${data.minLength} characters or more)`}
                type="password"
              />

              <button className={primary} disabled={processing} type="submit">
                Sign up
              </button>
            </>
          )}
        </Form>

        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          Already have one?{' '}
          <Link className="underline" href={getRoute('new_sessions_path')}>
            Sign in
          </Link>
          .
        </p>
      </div>
    </Layout>
  );
}
