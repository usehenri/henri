---
title: Policies
description: Record-level authorization from app/policies, with henri.can(), req.authorize(), the policy guard on a route, and the links a page is not given.
sidebar:
  order: 6
---

`roles` on a route answers one question: may this **kind of person** reach this
endpoint. It is the right question for `/admin`, and it is the wrong one for
`/proposals/42` — where what you actually want to know is whether **this**
person may read **that** proposal. Getting that wrong is the first category of
the OWASP Top 10, and it is usually not a missing feature but a forgotten `if`.

A policy is a file next to the model it is about, one function per action:

```js
// app/policies/proposal.js
const owns = (user, proposal) =>
  Boolean(user) && String(proposal.speakerId) === String(user.id);

module.exports = {
  index: () => true,
  create: (user) => Boolean(user),
  new: (user) => Boolean(user),

  show: (user, proposal) =>
    proposal.state === 'submitted' || owns(user, proposal),
  edit: (user, proposal) => owns(user, proposal),
  update: (user, proposal) => owns(user, proposal),
  destroy: (user, proposal) => owns(user, proposal),
};
```

`henri generate policy Proposal speakerId` writes that file with the seven
actions of a resource stubbed on an ownership check, and a test next to it.

## Failing closed

Three things can go wrong, and the safe answer is the same for all three:
**no**.

| What happened                         | What henri answers                                       |
| ------------------------------------- | -------------------------------------------------------- |
| The model has no policy               | `false`, with a line naming the file to write            |
| The policy has no rule for the action | `false`, with a line naming the rule to add              |
| The rule threw                        | `false`, and the exception is logged through `pen.error` |

There is no "allow when undecided" setting to turn on, and henri never falls
back to the roles. There is one quieter way to get an accidental yes, and it
is why **only the boolean `true` allows**:

```js
// Returns 'admin' for an admin and undefined for everybody else. A
// truthiness test would read the same for the string 'nope'.
admin: (user) => user.roles.find((role) => role === 'admin'), // never allows
admin: (user) => user.roles.includes('admin'), // this is the rule you meant
```

A policy that leaves an action out refuses it, and the link to that action
disappears from what leaves the server — which is how you find out, on the
page, rather than in a report six months later. Write the rules you have
routes for; do not leave them out and hope.

## Rules that need a record, and rules that do not

`index`, `new` and `create` have no record to speak of; `show`, `edit`,
`update` and `destroy` do. henri tells them apart by what the rule declares:

> **A rule that takes a second parameter is never asked without a record.**

`(user) => ...` is asked anywhere. `(user, proposal) => ...` only where a
record is in hand. `(user, proposal = null) => ...` says "ask me either way" —
the default is you opting in.

That one predicate is what lets the same file answer the route guard (no
record yet), the `_links` of a HAL resource (a record in hand) and the `paths`
of a rendered page (no record) without a second vocabulary.

## Asking

There is one way to ask, and it is the same one everywhere the answer is
needed.

```js
// Anywhere: a job, a worker, a mailer, the console
await henri.can(user, 'update', proposal);

// In a request: the user is already filled in
await req.can('update', proposal);

// The same, refusing when the answer is no
const proposal = await req.authorize('update', await Proposal.findById(id));
```

`req.authorize()` resolves with the record, so it reads as one line, and
rejects with a `POLICY_DENIED` error carrying the status of a refusal (below)
when it does not. henri answers that error the way it answers any other 4xx:
the negotiated error page for a browser, the `res.boom` body for an API
client.

henri finds the policy from the record — Mongoose, Sequelize and Drizzle all
say which model an instance belongs to — and falls back to what the route is
about. A plain object says nothing, so name the policy yourself:

```js
await henri.can(user, 'update', { speakerId: 1 }, 'proposal');
```

## Guarding a route

`policy` on a route registers the guard, next to `roles` rather than instead
of it: the role decides who may reach the endpoint, the policy who may act on
the record, and a route may declare both.

```js
// config/routes.js
module.exports = {
  // `true` names the policy after the controller: proposals -> proposal
  'resources proposals': { policy: true },

  // or name another one
  'get /proposals/mine': { controller: 'proposals#mine', policy: 'proposal' },

  // both guards: the role answers first
  'resources reviews': {
    only: ['index', 'create'],
    policy: true,
    roles: ['admin'],
  },
};
```

There is a limit to what a gate can decide, and it is worth being precise
about: **the record is not loaded yet**. So the guard answers the questions
that have no record — `index`, `new`, `create`, and any rule that declares no
record parameter — and refuses right there. For the rest it steps aside, and
two things pick it up:

- `res.resource()` asks the policy about the record it is about to send, and
  answers the refusal instead of the body. An action that already asked (with
  `req.can()` or `req.authorize()`) is trusted and not asked twice — it holds
  the record, which may be more than what is being sent.
- `config.policies.verify` (on by default) reports, once per route, an action
  that answered successfully without ever asking. That is the "forgot one"
  case, and the line names the route and the rule.

## What a refusal answers

| Who                  | Status                                                                       |
| -------------------- | ---------------------------------------------------------------------------- |
| An anonymous visitor | `401`, and the login page in a browser: "log in and try again" leaks nothing |
| A signed-in user     | `config.policies.status`, **`404`** by default                               |

404 is the default on purpose: a `403` tells whoever asked that the record is
there, which is half of what they wanted. Set `"policies": { "status": 403 }`
when your records are not secret and a clear refusal is friendlier, or ask for
one call at a time:

```js
// This proposal is public; it is the writing that is refused, and saying so
// is more useful than pretending it does not exist
await req.authorize('update', proposal, { status: 403 });
```

## The links a page is not given

`_links` and `paths` are already filtered by role. Policies filter them again,
and this is where the feature earns its keep: a view that cannot link where
the reader may not go is what stops the leak, because nobody has to remember
to hide a button.

- **`_links`** (`res.resource()`, `res.collection()`): the record is in hand,
  so `edit`, `update` and `destroy` are asked about that record and
  `collection`, `create` and `new` about the collection. `self` is left alone
  — it names the representation the client is already holding, not something
  it may do — and so are the links your controller added itself, since henri
  does not know what action they are.
- **`paths`** (the table `res.render()` gives a page): there is no record
  here, so only the rules that answer without one are asked. A `show` rule
  taking a proposal never removes `show_proposals_path`; that question is
  answered where the record is, on its own `_links`.

A controller with no policy is not asked about at all, so an application that
ships none sees exactly the table the roles built.

### When the answer is a presentation of the record

A controller that presents its records before sending them hands
`res.resource()` a plain object, and a presenter usually drops exactly what
the rules read — the owner column is an internal foreign key. `subject` names
what the policies are asked about:

```js
// One record
res.resource(present(proposal), { subject: proposal });

// A page of them: an array parallel to the one being sent,
// or (item, index) => record
res.collection(records.map(present), { subject: records });
```

## Scoping a list

"May this person read this proposal" is not "which proposals may they read",
and answering the first one row at a time does not answer the second. A policy
says what a list is filtered by, and henri hands the value straight back:

```js
// app/policies/proposal.js
scope: (user) => ({ speakerId: user && user.id }),
```

```js
// app/controllers/proposals.js
const proposals = await Proposal.where(await req.scope('proposal'));
```

**henri never looks inside that value.** It is a `where` for the ORM you
chose, not something henri builds a query from — which is what keeps this a
seam rather than a half-written query builder. A policy with no `scope` throws
`HENRI_POLICY_SCOPE_REQUIRED` rather than quietly meaning "everything",
because "everything they may see" has no safe default; `scope: () => ({})` is
how a policy says everything on purpose.

## `before`, and the shape of a rule

A policy may export `before`, run ahead of every rule. A boolean is the answer
of the whole policy; anything else falls through:

```js
module.exports = {
  // An admin does not need the rest of the file to be consulted
  before: (user) => (user && user.roles.includes('admin') ? true : undefined),

  update: (user, proposal) => owns(user, proposal),
};
```

Every rule receives a third argument, the context: `{ action, policy, user,
req, henri }`. `req` is null outside a request.

Rules are asked a lot — once per link, per record, per page — so keep them
synchronous and free of queries. Load what a rule needs in a `before` hook of
the controller and put it on the record.

## Where policies live

`app/policies/*.js`, loaded the way `app/models` is, one file per model and
named after it. A namespace is kept: `admin/proposals` looks for
`app/policies/admin/proposal.js`, and never borrows the policy of the
`proposals` controller next door. `henri.policies` is the registry
(`names()`, `get()`, `rule()`, `resolve()`), and a reload picks up a changed
file like any other.

## Configuration

```json
{
  "policies": { "status": 404, "verify": true }
}
```

Writing the file is what turns policies on; the key only holds the two
decisions an application may reasonably differ on. See
[Configuration](/configuration/#the-policies-object).

## Testing a refusal

The tests worth writing are the ones that prove a no.

```js
const { henri, setup } = require('@usehenri/testing');

describe('the proposal policy', () => {
  beforeAll(() => setup());

  test('somebody else gets nothing', async () => {
    expect(await henri.can(stranger, 'update', proposal, 'proposal')).toBe(
      false
    );
  });

  test('an action nobody wrote a rule for is refused', async () => {
    expect(await henri.can(owner, 'publish', proposal, 'proposal')).toBe(false);
  });
});
```

`henri generate policy` writes that file for you. `henri audit` reports a
policy that nothing asks — the rules written and the gate forgotten looks
exactly like having solved the problem, so it is worth a finding
(`policies.unenforced`, see [Security](/guides/security/)). The other way
round is [`henri doctor`](/reference/cli/#doctor): a route declaring
`policy: true` with no file behind it refuses every request, because the
policies fail closed, and `routes.policy` says so before anyone finds out
from a 404.
