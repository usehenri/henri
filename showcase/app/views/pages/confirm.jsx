// "Check your inbox", and the form that asks for the message again.
//
// The link in the mail is `GET /confirm/:token`, mounted by henri: it
// confirms the address and lands on config.user.confirmation.after. This page
// is only what a visitor sees before or instead of that, and its resend
// answers the same way for an address that exists, one that does not, and one
// that is already confirmed.
import { Form, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { card, field, label, primary } from 'components/ui';

export default function Confirm() {
  const { data, errors, flash } = useHenri();
  const sent = errors || {};

  return (
    <Layout>
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight">
          Confirm your address
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Follow the link in the message we sent. In development nothing leaves
          the machine: read the mails on{' '}
          <code className="font-mono">/_mailers</code>.
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
        {(flash.alert || []).map((message) => (
          <p
            className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
            key={message}
          >
            {message}
          </p>
        ))}

        <Form action="/confirm" className={`${card} mt-6 grid gap-4 p-6`}>
          {({ processing }) => (
            <>
              <div>
                <label className={label} htmlFor="email">
                  Email
                </label>
                <input
                  autoComplete="email"
                  className={`${field} mt-1`}
                  defaultValue={data.email || ''}
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
                Send it again
              </button>
            </>
          )}
        </Form>
      </div>
    </Layout>
  );
}
