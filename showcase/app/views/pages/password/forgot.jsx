// "I forgot my password". The form posts to `POST /password/forgot`, which
// henri mounts because config.user.passwordReset says so.
//
// The answer is the same sentence whether or not the address has an account,
// and henri writes it before it looks anything up, so the time this page
// waits says nothing either. That is the point of the flow living in the
// framework: an application cannot get it subtly wrong.
import { Form, Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { card, field, label, primary } from 'components/ui';

export default function Forgot() {
  const { errors, flash, getRoute } = useHenri();
  const sent = errors || {};

  return (
    <Layout>
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight">
          Reset your password
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Tell us the address of the account. If it is registered, a link valid
          for one hour is on its way; either way this page says the same thing.
        </p>

        {(flash.notice || []).map((message) => (
          <p
            className={`${card} mt-6 px-4 py-3 text-sm`}
            key={message}
            role="status"
          >
            {message}
          </p>
        ))}

        <Form
          action="/password/forgot"
          className={`${card} mt-6 grid gap-4 p-6`}
        >
          {({ processing }) => (
            <>
              <div>
                <label className={label} htmlFor="email">
                  Email
                </label>
                <input
                  autoComplete="email"
                  className={`${field} mt-1`}
                  id="email"
                  name="email"
                  required
                  type="email"
                />
                {sent.email && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                    {sent.email}
                  </p>
                )}
              </div>

              <button className={primary} disabled={processing} type="submit">
                Send the link
              </button>
            </>
          )}
        </Form>

        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          <Link className="underline" href={getRoute('new_sessions_path')}>
            Back to sign in
          </Link>
        </p>
      </div>
    </Layout>
  );
}
