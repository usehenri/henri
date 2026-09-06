import { Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import { PageHeader, card, mono } from 'components/ui';

const SECTIONS = [
  {
    items: [
      [
        'config/routes.js',
        'root, resources with only and except, member routes (submit, withdraw, decide, restore), collection routes (mine, withdrawn), a namespace for the committee and reviews nested under a proposal.',
      ],
      [
        'henri routes',
        'Prints the same table this application is wired from, without booting the server.',
      ],
    ],
    title: 'Routes',
  },
  {
    items: [
      [
        'app/controllers/proposals.js',
        'before hooks in the Rails selector form: one loads the record, one refuses somebody else’s proposal, and a hook that answers ends the request.',
      ],
      [
        'req.permit()',
        'The proposal form may set a title and an abstract; it may not set the speaker, the state or a role.',
      ],
      [
        'req.flash()',
        'The green and amber bars at the top of a page after a redirect. They survive exactly one redirect.',
      ],
      [
        'app/controllers/events.js',
        'Implicit rendering: an action that returns an object without answering renders its own page with it.',
      ],
    ],
    title: 'Controllers',
  },
  {
    items: [
      [
        'app/models/*.js',
        'Five models on the Drizzle adapter over PostgreSQL, with belongsTo and hasMany associations, enums, length and range validations.',
      ],
      [
        'options: { paranoid: true }',
        'Withdrawing a proposal soft deletes it: the row keeps its reviews, disappears from every query, and the committee can restore it.',
      ],
      [
        'db/migrations',
        'Real migrations in the drizzle-kit layout, generated with henri db:generate and applied with henri db:migrate.',
      ],
      [
        'Model.paginate(req.pagination())',
        'One query for the page and the counters, on the proposal list and the review queue.',
      ],
    ],
    title: 'Models',
  },
  {
    items: [
      [
        'Sessions and CSRF',
        'Sign up, sign in, sign out. Every form carries a token; a request without it gets a 403.',
      ],
      [
        'Roles',
        'The committee area is behind roles: [’admin’]. A browser is redirected to the login page, an API client gets a 403, and the path helpers a page receives are filtered by role, so a speaker’s page holds no link to it.',
      ],
    ],
    title: 'Users',
  },
  {
    items: [
      [
        'HAL',
        'The same routes answer JSON with _links and _embedded when asked; the links a client cannot follow are not in the answer.',
      ],
      [
        'Idempotency-Key',
        'Retrying a create with the same key replays the first answer instead of writing twice.',
      ],
      [
        'ETag and versioning',
        'Every JSON answer carries a weak ETag, and the proposals route serves application/vnd.henri.v1+json and refuses other versions.',
      ],
    ],
    title: 'JSON API',
  },
];

export default function About() {
  const { getRoute } = useHenri();

  return (
    <Layout>
      <PageHeader
        title="What this shows"
        subtitle="Lineup is a real application built on henri: a call for papers with speakers, proposals, a review committee and a public programme. Everything on this page is running here, not described."
      />

      <p className="mt-8 text-sm text-zinc-600 dark:text-zinc-400">
        The{' '}
        <Link className="underline" href={getRoute('api_main_path')}>
          API explorer
        </Link>{' '}
        calls this application&rsquo;s own endpoints from the browser so the
        hypermedia is visible without a terminal.
      </p>

      <div className="mt-8 grid gap-6">
        {SECTIONS.map((section) => (
          <section key={section.title} className={`${card} p-6`}>
            <h2 className="text-lg font-semibold tracking-tight">
              {section.title}
            </h2>
            <dl className="mt-4 grid gap-4">
              {section.items.map(([term, description]) => (
                <div key={term}>
                  <dt className={`${mono} text-zinc-900 dark:text-zinc-100`}>
                    {term}
                  </dt>
                  <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {description}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Layout>
  );
}
