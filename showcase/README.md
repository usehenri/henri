# Lineup

A call for papers and program committee tool, built on henri. It is the
showcase application of this repository: a real application, not a brochure.
Speakers write proposals, the committee reviews and decides, and the accepted
talks become the public programme.

It is private and never published to npm. It depends on the workspace packages
(`workspace:^`), so it always runs against the framework in this checkout.

|          |                                                                       |
| -------- | --------------------------------------------------------------------- |
| Renderer | Inertia (Vite + React 19), server-side rendered, Tailwind CSS v4      |
| Store    | `@usehenri/drizzle` on PostgreSQL, with migrations in `db/migrations` |
| Models   | `User`, `Event`, `Track`, `Proposal`, `Review`                        |
| Tests    | `pnpm --filter @usehenri/showcase test` (needs PostgreSQL)            |

## From a clean checkout to a running seeded application

```bash
mise install                        # node 24 + pnpm 11
pnpm install                        # the whole workspace
pnpm db:up                          # PostgreSQL from compose.yaml
cd showcase
cp .env.example .env                # HENRI_SECRET, never committed
pnpm db:create                      # henri db:create, the database of config/dev.json
pnpm db:migrate                     # apply db/migrations
pnpm db:seed                        # 3 editions, 24 people, 46 proposals
pnpm start                          # henri server, http://localhost:3000
```

`pnpm db:setup` is the three database steps in one.

Sign in with any of the seeded accounts; the password is always `lineup-showcase`.
`ada@lineup.dev` and `grace@lineup.dev` are on the program committee, so they
see `/admin`; `bruno@lineup.dev` and the twenty-one others are speakers.

Registration, the password reset and the address confirmation are henri's
(`config.user.signup`, `passwordReset` and `confirmation`); `/signup`,
`/password/forgot` and `/confirm` are the pages this application puts in
front of them. In development the mails go nowhere: `config.mail` uses
nodemailer's json transport, and `/_mailers` renders every one of them, links
included.

If your PostgreSQL is not on `127.0.0.1:5432` — `pnpm db:up` takes
`HENRI_POSTGRES_PORT` when something else already listens there —
`DATABASE_URL` points the store at it, with no file to copy:

```bash
export DATABASE_URL=postgres://henri:henri@127.0.0.1:55433/henri_showcase
pnpm db:setup && pnpm start
```

henri applies it over `stores.default.url` and prints the key it took from the
environment on boot. It applies to every environment, the test suite included,
so unset it (or point it at `henri_showcase_test`) before `pnpm test`; copying
`config/default.json` to the git-ignored `config/dev.json` is still the way to
make the split permanent.

`HENRI_SECRET` signs the sessions. It lives in `.env`, which is git-ignored,
so `henri doctor` stays green and no secret is ever committed; a variable
already set in the environment wins over the file, which is how the CI job and
the container pass their own. The container refuses to start without one.

## The commands

```bash
pnpm start            # henri server, with hot reload
pnpm test             # createdb (test) + henri test
pnpm routes           # the expanded routes table
pnpm doctor           # check the application against the conventions
pnpm console          # a REPL with henri and the models
pnpm build            # the production Vite bundles
pnpm db:generate      # write a migration from a model change
pnpm db:status        # applied and pending migrations
```

## What it exercises

Everything below runs here; `/about` in the application says the same thing
to a visitor.

### Routes (`config/routes.js`)

`root`, `resources` with `only` and `except`, `member` routes (`submit`,
`withdraw`, `decide`, `restore`), `collection` routes (`mine`, `withdrawn`), a
`namespace` for the committee, `reviews` nested under a proposal, per-route
`roles`, and `version: 'v1'` on the proposals. `pnpm routes` prints all 31.

### Controllers

- `before` hooks in the Rails selector form (`app/controllers/proposals.js`):
  one refuses an anonymous write, one loads the record, one refuses somebody
  else's proposal. A hook that answers ends the request. The rule behind the
  last two is not in the controller: `app/policies/proposal.js` holds it and
  `req.can()` asks it (see below).
- `req.permit()` decides what a form may set: a proposal cannot choose its own
  speaker or state, a profile cannot grant itself a role.
- `req.flash()` across a redirect, rendered by `components/layout.jsx`.
- Implicit rendering in `app/controllers/events.js` and
  `app/controllers/admin/dashboard.js`: the action returns an object and henri
  renders its page with it.
- `res.negotiate({ html, json })` so one action serves a browser and an API
  client, and `henri.model.errors()` for a 422 with one message per field.

### Policies

`app/policies/proposal.js` and `app/policies/review.js` answer the question
roles cannot: may **this** speaker edit **that** proposal. `policy: true` on
the routes makes henri ask before the action runs (for `index`, `new`,
`create` and `mine`, which need no record), the `before` hooks ask once the
proposal is loaded, and the same file filters the `_links` of every HAL answer
and the `paths` of every page -- an anonymous visitor is not given
`new_proposals_path`, and a proposal that is not yours comes back without its
`update` link. `scope` is the other half: `proposals#mine` reads the `where`
from the policy rather than writing it again.

### Users and roles

Sign up (`accounts#create`, then `req.logIn`), sign in and sign out through
henri's own `POST /login` and `POST /logout`, the CSRF token in every form, and
`req.user` reaching the pages as `user`. `/admin` is behind `roles: ['admin']`:
a browser is redirected to `/login`, an API client gets a `403` naming the
role, and the path helpers a page receives are filtered by role, so a speaker's
page holds no link to the committee.

### JSON API

The same routes answer HAL. `GET /proposals` with
`Accept: application/hal+json` is a collection with `_embedded.proposals`, the
paging links, `Link` and `X-Total-Count`; `GET /proposals/:id` is a resource
with `_links`. `:id` is the `externalId` of the record, a uuid: the bigint
primary key is what the foreign keys are made of and it never leaves the
server, so no url and no payload carries a number anybody could count up. Pagination is `Proposal.paginate(req.pagination())`, creates
honour `Idempotency-Key`, every answer carries a weak `ETag`, and the route
serves `application/vnd.henri.v1+json` and refuses other versions with a `406`.

`/api` in the application is an explorer: it makes those requests from the
browser and shows the status, the headers and the body.

### Models

Five models on the Drizzle adapter, with `belongsTo`/`hasMany` associations
declared on both sides, enum, length and range validations, timestamps, a
public `externalId` on every table, and `options: { paranoid: true }` on
`Proposal`: withdrawing soft deletes it, the reviews survive, and the
committee restores it from `/admin/proposals/withdrawn`. The proposal form
posts the public id of an edition and of a track, and
`resolveReferences()` in `app/helpers/proposals.js` turns them back into the
foreign keys the columns hold.

`db/migrations` is the drizzle-kit layout written by `henri db:generate`. The
development store sets `"sync": false`, so a schema change needs a migration
rather than a silent push, and `test/schema.test.js` fails when the models and
the migrations disagree.

## Tests

```bash
pnpm --filter @usehenri/showcase test        # from the repository root
pnpm test                                    # from showcase/
```

`henri test` runs Vitest with `NODE_ENV=test`; `@usehenri/testing` boots the
application in the worker and binds supertest to it. The suite needs the
PostgreSQL of `compose.yaml`, which is why it is **not** part of the
monorepo's `pnpm test`: `vitest.config.mjs` at the root excludes `showcase/`.

The boot pushes the schema, which creates the tables of a fresh test database
by itself. A test database created before a migration that adds a `NOT NULL`
column to a table already holding rows is a different matter: drizzle-kit asks
before doing that and there is no terminal to ask, so the boot fails. Migrate
it once, or drop it and let the next run build it again:

```bash
NODE_ENV=test henri db:migrate     # from showcase/
```

The five files cover the flows above: `auth.test.js` (sign up, sign in, sign
out, CSRF), `roles.test.js` (the guard and the filtered path helpers),
`proposals.test.js` (before hooks, `req.permit`, flash, the state transitions,
the soft delete), `api.test.js` (HAL, pagination, `Idempotency-Key`, ETags,
versioning) and `schema.test.js` (models, migrations, routes table).

## Docker

The build context is the repository root, because the application depends on
the workspace packages:

```bash
docker build -f showcase/Dockerfile -t lineup .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgres://henri:henri@host.docker.internal:5432/henri_showcase \
  -e HENRI_SECRET="$(openssl rand -hex 32)" \
  lineup
```

Nothing is written at start time. `config/production.json` is committed and
carries what the application is; the environment carries what changes between
deployments, and henri applies it over the file (see
[Configuration](https://usehenri.io/configuration/)): `DATABASE_URL` is
`stores.default.url`, `HENRI_SECRET` the secret, and any other key is
`HENRI_CONFIG__<key>`, for instance
`-e HENRI_CONFIG__api__perPage=25`. The boot prints every key it took from the
environment, with the secrets masked.

`docker-entrypoint.sh` only checks the two variables the application cannot
start without, maps `PORT` to `HENRI_CONFIG__port` and `HENRI_MIGRATE=false` to
`HENRI_CONFIG__stores__default__migrate`, and runs `db/seeds.js` first when
`HENRI_SEED=true`. The boot applies `db/migrations`, and
`GET /readyz` is the healthcheck (`GET /livez` is the liveness probe).

## Layout

```
showcase/
  app/
    controllers/          main, sessions, accounts, events, tracks,
                          proposals, reviews, admin/{dashboard,proposals,users}
    helpers/proposals.js  what the page and the API answers share
    policies/             proposal, review: who may act on one record
    models/               User, Event, Track, Proposal, Review
    views/
      pages/              the Inertia pages, one per rendered route
      components/         layout, ui, proposal-form
      styles/index.css    the whole stylesheet (Tailwind v4)
  config/                 default.json, test.json, routes.js
  db/                     seeds.js, migrations/
  test/                   the suite run by `henri test`
```
