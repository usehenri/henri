// Signing in. henri mounts POST /login itself, so this page is a plain HTML
// form: the browser posts to it and follows the redirect henri answers with
// (`config.user.afterLogin` on success, /login?error=invalid on failure).
//
// The hidden `_csrf` field carries the token the page received. A browser
// with no session cookie yet is exempt from the check, but one that already
// has a session (a flash message is enough to start one) is not.
import { Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { card, field, label, primary } from 'components/ui';

export default function Login() {
  const { csrf, data, getRoute } = useHenri();

  return (
    <Layout>
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          The seeded accounts all use the password{' '}
          <code className="font-mono">lineup-showcase</code>. Try{' '}
          <code className="font-mono">ada@lineup.dev</code> for the committee
          view.
        </p>

        {data.unconfirmed && (
          <p className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Confirm your email address first.{' '}
            <Link className="underline" href="/confirm">
              Ask for the message again
            </Link>
            .
          </p>
        )}

        {data.failed && (
          <p className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            That email and password did not match.
          </p>
        )}

        <form
          action="/login"
          className={`${card} mt-6 grid gap-4 p-6`}
          method="post"
        >
          {csrf && <input name="_csrf" type="hidden" value={csrf} />}

          <div>
            <label className={label} htmlFor="email">
              Email
            </label>
            <input
              autoComplete="username"
              className={`${field} mt-1`}
              id="email"
              name="email"
              required
              type="email"
            />
          </div>

          <div>
            <label className={label} htmlFor="password">
              Password
            </label>
            <input
              autoComplete="current-password"
              className={`${field} mt-1`}
              id="password"
              name="password"
              required
              type="password"
            />
          </div>

          <button className={primary} type="submit">
            Sign in
          </button>
        </form>

        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          No account yet?{' '}
          <Link className="underline" href={getRoute('new_accounts_path')}>
            Create one
          </Link>
          {' · '}
          <Link className="underline" href="/password/forgot">
            Forgot your password?
          </Link>
        </p>
      </div>
    </Layout>
  );
}
