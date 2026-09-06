---
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/mcp': minor
---

Policies: authorization that can see the record.

`roles` on a route answers "may this kind of person reach this endpoint". It
cannot answer "may this person read _this_ proposal", which is the question
every application actually has and the one broken access control keeps winning
on. henri now has an answer: `app/policies/<model>.js`, one function per
action, taking the user and the record.

- **One way to ask**, everywhere the answer is needed:
  `henri.can(user, 'update', proposal)`, the request-scoped `req.can()`, and
  `req.authorize()`, which resolves with the record and refuses when the policy
  says no.
- **It fails closed.** A model with no policy, an action with no rule and a
  rule that throws all mean no, and only the boolean `true` allows -- a truthy
  string is not a yes. There is no setting that turns any of that into one.
- **`policy` on a route** registers a guard beside the role guard rather than
  instead of it. It answers the actions that need no record before the action
  runs; `res.resource()` enforces the rest, and `config.policies.verify`
  reports an action that answered without ever asking.
- **`_links` and `paths` lose what the policy refuses**, the way they already
  lose what a role refuses. A page that cannot link where its reader may not go
  is what stops the leak. `res.resource()` and `res.collection()` take a
  `subject` for controllers that answer with a presentation of the record.
- **A refusal answers 404** by default, so it says nothing about whether the
  record exists; `config.policies.status: 403` and a per-call `{ status }`
  override it. An anonymous visitor gets a 401 and, in a browser, the login
  page.
- **Scoping is the other half**: `scope(user)` on a policy says what a list is
  filtered by, and `req.scope('proposal')` hands the value to your ORM. henri
  never looks inside it, and a policy without one throws rather than quietly
  meaning "everything".
- `henri generate policy Proposal speakerId` writes the policy and its test,
  `henri destroy policy Proposal` removes them, and `henri audit` reports a
  policy that nothing asks (`policies.unenforced`, ASVS V4.2.1).

See the new [Policies](https://usehenri.io/guides/policies/) guide.
