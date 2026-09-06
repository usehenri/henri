// Registration through Inertia's <Form>: the controller answers with a
// redirect on success, or renders this page again after
// `res.inertia.errors()`, and the messages arrive in the render prop.
//
// The <Form> of @usehenri/inertia adds the hidden `_csrf` field for you.
import { Form, Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { card, field, label, primary } from 'components/ui';

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
  const { data, getRoute, pathFor } = useHenri();
  const values = data.values || {};

  return (
    <Layout>
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight">
          Create an account
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Speakers write proposals; the committee reviews them. New accounts get
          the <code className="font-mono">speaker</code> role, which is what{' '}
          <code className="font-mono">config.baseRole</code> says.
        </p>

        <Form
          action={pathFor('create_accounts_path')}
          className={`${card} mt-6 grid gap-4 p-6`}
        >
          {({ errors, processing }) => (
            <>
              <Field
                autoComplete="name"
                defaultValue={values.name || ''}
                errors={errors}
                name="name"
                required
                title="Name"
              />
              <Field
                autoComplete="email"
                defaultValue={values.email || ''}
                errors={errors}
                name="email"
                required
                title="Email"
                type="email"
              />
              <Field
                autoComplete="new-password"
                errors={errors}
                name="password"
                required
                title="Password (six characters or more)"
                type="password"
              />
              <Field
                defaultValue={values.company || ''}
                errors={errors}
                name="company"
                title="Company (optional)"
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
