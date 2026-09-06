// Who is who. Promoting somebody calls `User.setRoles()` in a member route
// of its own: roles are dropped from every mass assignment, so no form can
// grant one by posting a `roles` field.
import { Form, Link, useHenri } from '@usehenri/inertia';
import Layout from 'components/layout';
import {
  Badge,
  Empty,
  PageHeader,
  Pagination,
  card,
  secondary,
} from 'components/ui';

export default function AdminUsers() {
  const { data, getRoute, pathFor, user } = useHenri();
  const { page, pages, total, users } = data;
  const base = getRoute('index_admin/users_path');

  return (
    <Layout>
      <Link
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        href={getRoute('index_admin/dashboard_path')}
      >
        &larr; Committee
      </Link>

      <div className="mt-3">
        <PageHeader
          title="People"
          subtitle="Everyone with an account. An admin is a speaker who also reviews."
        />
      </div>

      {users.length === 0 ? (
        <div className="mt-8">
          <Empty>Nobody has signed up.</Empty>
        </div>
      ) : (
        <ul className="mt-8 grid gap-3">
          {users.map((person) => {
            const isAdmin = (person.roles || []).includes('admin');
            const self = user && String(user.id) === String(person.id);

            return (
              <li
                key={person.id}
                className={`${card} flex flex-wrap items-center justify-between gap-4 px-5 py-4`}
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {person.name}
                    {person.company ? (
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {' '}
                        · {person.company}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {person.email} &middot; {person.proposals} proposals,{' '}
                    {person.reviews} reviews
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {(person.roles || []).map((role) => (
                    <Badge
                      key={role}
                      tone={role === 'admin' ? 'accepted' : 'neutral'}
                    >
                      {role}
                    </Badge>
                  ))}

                  {!self && (
                    <Form
                      action={pathFor('role_admin/users_path', {
                        id: String(person.id),
                      })}
                    >
                      {({ processing }) => (
                        <>
                          <input
                            name="role"
                            type="hidden"
                            value={isAdmin ? 'speaker' : 'admin'}
                          />
                          <button
                            className={secondary}
                            disabled={processing}
                            type="submit"
                          >
                            {isAdmin
                              ? 'Remove from committee'
                              : 'Add to committee'}
                          </button>
                        </>
                      )}
                    </Form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        noun="people"
        page={page}
        pages={pages}
        path={base}
        query={{}}
        total={total}
      />
    </Layout>
  );
}
