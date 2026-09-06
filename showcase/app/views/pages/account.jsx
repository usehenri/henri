// The speaker profile. The form posts a PATCH through Inertia; the engine
// turns the controller's redirect into a 303 so the browser follows it with a
// GET, which is the Inertia convention for PUT, PATCH and DELETE.
import { Form, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import {
  Badge,
  Fact,
  PageHeader,
  card,
  field,
  label,
  primary,
} from 'components/ui';

export default function Account() {
  const { data, flash, pathFor } = useHenri();
  const { account, counts } = data;

  return (
    <Layout>
      <PageHeader
        title={account.name}
        subtitle="What the committee sees next to your proposals."
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="grid gap-6">
          <Form
            action={pathFor('update_accounts_path')}
            className={`${card} grid gap-4 p-6`}
            method="patch"
          >
            {({ errors, processing }) => (
              <>
                <div>
                  <label className={label} htmlFor="name">
                    Name
                  </label>
                  <input
                    className={`${field} mt-1`}
                    defaultValue={account.name || ''}
                    id="name"
                    name="name"
                    required
                  />
                  {errors.name && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {errors.name}
                    </p>
                  )}
                </div>

                <div>
                  <label className={label} htmlFor="company">
                    Company
                  </label>
                  <input
                    className={`${field} mt-1`}
                    defaultValue={account.company || ''}
                    id="company"
                    name="company"
                  />
                </div>

                <div>
                  <label className={label} htmlFor="bio">
                    Bio
                  </label>
                  <textarea
                    className={`${field} mt-1`}
                    defaultValue={account.bio || ''}
                    id="bio"
                    name="bio"
                    rows={4}
                  />
                  {errors.bio && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {errors.bio}
                    </p>
                  )}
                </div>

                <div>
                  <button
                    className={primary}
                    disabled={processing}
                    type="submit"
                  >
                    Save
                  </button>
                  <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                    The form may set a name, a company and a bio.{' '}
                    <code className="font-mono">req.permit()</code> drops
                    everything else, so it cannot change your email or grant
                    itself a role.
                  </p>
                </div>
              </>
            )}
          </Form>

          {/*
          Changing the address is henri's POST /account/email: it writes
          nothing, it mails a link to the new address, and the account keeps
          the address it has until that link is followed. An address nobody
          proved they can read never becomes the address of an account.
        */}
          <Form action="/account/email" className={`${card} grid gap-4 p-6`}>
            {({ errors, processing }) => (
              <>
                <h2 className="text-lg font-semibold tracking-tight">
                  Change your email
                </h2>
                {(flash.notice || []).map((message) => (
                  <p
                    className="text-sm text-zinc-600 dark:text-zinc-400"
                    key={message}
                    role="status"
                  >
                    {message}
                  </p>
                ))}

                <div>
                  <label className={label} htmlFor="account-email">
                    New address
                  </label>
                  <input
                    autoComplete="email"
                    className={`${field} mt-1`}
                    id="account-email"
                    name="email"
                    required
                    type="email"
                  />
                  {errors.email && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {errors.email}
                    </p>
                  )}
                </div>

                <div>
                  <label className={label} htmlFor="account-password">
                    Your current password
                  </label>
                  <input
                    autoComplete="current-password"
                    className={`${field} mt-1`}
                    id="account-password"
                    name="password"
                    required
                    type="password"
                  />
                  {errors.password && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {errors.password}
                    </p>
                  )}
                </div>

                <div>
                  <button
                    className={primary}
                    disabled={processing}
                    type="submit"
                  >
                    Send the confirmation
                  </button>
                  <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                    The change takes effect when the link in the message is
                    followed, and not before.
                  </p>
                </div>
              </>
            )}
          </Form>
        </div>

        <aside className={`${card} grid gap-4 self-start p-6`}>
          <Fact term="Email">
            {account.email}
            {!account.confirmed && (
              <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                unconfirmed
              </span>
            )}
          </Fact>
          <Fact term="Roles">
            <span className="flex flex-wrap gap-1">
              {(account.roles || []).map((role) => (
                <Badge key={role}>{role}</Badge>
              ))}
            </span>
          </Fact>
          {counts && (
            <>
              <Fact term="Proposals">{counts.proposals}</Fact>
              <Fact term="Reviews written">{counts.reviews}</Fact>
            </>
          )}
        </aside>
      </div>
    </Layout>
  );
}
