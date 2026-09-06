// Choosing a new password. There is no token in this url: henri checked the
// one in the mailed link, put it in the session and redirected here, so it
// cannot leak through a `Referer` or the browser history.
//
// Saving invalidates every other session of the account, which is the point:
// the usual reason to reset a password is believing someone else has it.
import { Form, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { card, field, label, primary } from 'components/ui';

export default function Reset() {
  const { data, errors, flash } = useHenri();
  const sent = errors || {};

  return (
    <Layout>
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight">
          Choose a new password
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Everything else signed in to this account is signed out when you save,
          and the link you followed stops working.
        </p>

        {(flash.alert || []).map((message) => (
          <p
            className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
            key={message}
          >
            {message}
          </p>
        ))}

        <Form
          action="/password/reset"
          className={`${card} mt-6 grid gap-4 p-6`}
        >
          {({ processing }) => (
            <>
              <div>
                <label className={label} htmlFor="password">
                  New password ({data.minLength} characters or more)
                </label>
                <input
                  autoComplete="new-password"
                  className={`${field} mt-1`}
                  id="password"
                  minLength={data.minLength}
                  name="password"
                  required
                  type="password"
                />
                {sent.password && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                    {sent.password}
                  </p>
                )}
              </div>

              <button className={primary} disabled={processing} type="submit">
                Save it
              </button>
            </>
          )}
        </Form>
      </div>
    </Layout>
  );
}
