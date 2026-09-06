// The chrome every page sits in: the navigation, the flash messages and the
// footer.
//
// The links are built from `paths`, the named routes henri hands the page,
// already filtered by the roles of the current user. That is why the
// committee link below needs no `user.roles.includes('admin')` check: a
// speaker's page simply does not carry `index_admin/dashboard_path`.
import { Form, Link, useHenri } from '@usehenri/inertia';
import { secondary } from 'components/ui';

const linkClass =
  'text-sm text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50';

const FLASH_TONES = {
  alert:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  notice:
    'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
};

/**
 * The application shell
 *
 * @param {object} props The props
 * @param {React.ReactNode} props.children The page
 * @returns {React.ReactElement} The layout
 */
export default function Layout({ children }) {
  const { flash, getRoute, paths, user } = useHenri();
  const messages = Object.entries(flash || {}).flatMap(([tone, list]) =>
    (list || []).map((message, index) => [`${tone}-${index}`, tone, message])
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link
            className="mr-auto flex items-baseline gap-2"
            href={getRoute('home_main_path')}
          >
            <span className="text-lg font-semibold tracking-tight">Lineup</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              call for papers
            </span>
          </Link>

          <Link className={linkClass} href={getRoute('index_events_path')}>
            Editions
          </Link>
          <Link className={linkClass} href={getRoute('index_proposals_path')}>
            Proposals
          </Link>
          <Link className={linkClass} href={getRoute('api_main_path')}>
            API
          </Link>

          {paths['index_admin/dashboard_path'] && (
            <Link
              className={linkClass}
              href={getRoute('index_admin/dashboard_path')}
            >
              Committee
            </Link>
          )}

          {user ? (
            <>
              <Link
                className={linkClass}
                href={getRoute('mine_proposals_path')}
              >
                My proposals
              </Link>
              <Link className={linkClass} href={getRoute('show_accounts_path')}>
                {user.name || user.email}
              </Link>
              <Form action="/logout" method="post">
                <button className={linkClass} type="submit">
                  Sign out
                </button>
              </Form>
            </>
          ) : (
            <>
              <Link className={linkClass} href={getRoute('new_sessions_path')}>
                Sign in
              </Link>
              <Link className={secondary} href={getRoute('new_accounts_path')}>
                Sign up
              </Link>
            </>
          )}
        </div>
      </header>

      {messages.length > 0 && (
        <div className="mx-auto w-full max-w-5xl px-6 pt-6">
          {messages.map(([key, tone, message]) => (
            <p
              key={key}
              className={`mb-2 rounded-lg border px-4 py-3 text-sm ${
                FLASH_TONES[tone] || FLASH_TONES.notice
              }`}
              role="status"
            >
              {message}
            </p>
          ))}
        </div>
      )}

      <main className="mx-auto w-full max-w-5xl grow px-6 py-10">
        {children}
      </main>

      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-zinc-500 dark:text-zinc-400">
          <p>
            Lineup is a demonstration application. The conference, the people
            and the talks are invented.
          </p>
          <Link className="hover:underline" href={getRoute('about_main_path')}>
            What this shows
          </Link>
        </div>
      </footer>
    </div>
  );
}
