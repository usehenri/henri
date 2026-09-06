// The handful of class strings and small components every page reuses.
// Tailwind class names are plain strings, so naming them here is all a
// "design system" needs to be at this size.
import { Link } from '@usehenri/inertia';

export const card =
  'rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40';

export const field =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-brand-500';

export const label =
  'block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400';

const button =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50';

export const primary = `${button} bg-brand-600 text-white hover:bg-brand-500`;

export const secondary = `${button} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800`;

export const danger = `${button} border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40`;

export const mono = 'font-mono text-[0.8em]';

const TONES = {
  accepted:
    'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  draft:
    'border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300',
  neutral:
    'border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300',
  rejected:
    'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  submitted:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
};

/**
 * A small pill, coloured by the state it shows
 *
 * @param {object} props The props
 * @param {string} [props.tone] A proposal state, or `neutral`
 * @param {React.ReactNode} props.children The label
 * @returns {React.ReactElement} The badge
 */
export function Badge({ tone = 'neutral', children }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        TONES[tone] || TONES.neutral
      }`}
    >
      {children}
    </span>
  );
}

/**
 * The page title block
 *
 * @param {object} props The props
 * @param {string} props.title The title
 * @param {React.ReactNode} [props.subtitle] A line under the title
 * @param {React.ReactNode} [props.children] Actions, aligned right
 * @returns {React.ReactElement} The header
 */
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-200 pb-6 dark:border-zinc-800">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            {subtitle}
          </p>
        )}
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}

/**
 * What a list shows when it holds nothing
 *
 * @param {object} props The props
 * @param {React.ReactNode} props.children The message
 * @returns {React.ReactElement} The placeholder
 */
export function Empty({ children }) {
  return (
    <p
      className={`${card} px-6 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400`}
    >
      {children}
    </p>
  );
}

/**
 * A labelled value in a definition list
 *
 * @param {object} props The props
 * @param {string} props.term The label
 * @param {React.ReactNode} props.children The value
 * @returns {React.ReactElement} The pair
 */
export function Fact({ term, children }) {
  return (
    <div>
      <dt className={label}>{term}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

/**
 * Previous and next links around a paginated list, built from the current
 * url so the filters of the page survive the jump
 *
 * @param {object} props The props
 * @param {string} props.path The path of the list
 * @param {object} props.query The current query string, as an object
 * @param {number} props.page The current page
 * @param {number} props.pages The number of pages
 * @param {number} props.total How many records there are
 * @param {string} [props.noun] What the records are called
 * @returns {?React.ReactElement} The pager, or null on a single page
 */
export function Pagination({
  path,
  query,
  page,
  pages,
  total,
  noun = 'proposals',
}) {
  if (pages <= 1) {
    return null;
  }

  const href = (target) => {
    const params = new URLSearchParams(
      Object.entries(query || {}).filter(([, value]) => value)
    );

    params.set('page', String(target));

    return `${path}?${params.toString()}`;
  };

  return (
    <nav className="mt-8 flex items-center justify-between gap-4 text-sm">
      {page > 1 ? (
        <Link className={secondary} href={href(page - 1)}>
          &larr; Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-zinc-500 dark:text-zinc-400">
        Page {page} of {pages} &middot; {total} {noun}
      </span>
      {page < pages ? (
        <Link className={secondary} href={href(page + 1)}>
          Next &rarr;
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
