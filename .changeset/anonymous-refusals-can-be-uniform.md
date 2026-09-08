---
'@usehenri/core': minor
---

`config.policies.anonymous`: the half of the refusal oracle that was left open.

The previous tranche made a record-level refusal indistinguishable from a missing record **for a signed-in visitor** — byte-identical `404`s on both code paths, in JSON and in HTML — and wrote down the half it did not close. An anonymous visitor still got a `401` (the login page, in a browser) for an id that exists and a `404` for one that does not, because a uniform answer is only possible when it is decided _before_ the lookup, which a record-level rule cannot be. Closing it costs the login-page affordance for every anonymous visitor of a scaffolded application, so it was documented as a caution rather than decided unilaterally.

This is the decision, as a key next to `status`, which already says what a refusal answers:

```json
{
  "policies": { "anonymous": "uniform" }
}
```

| Value                     | An anonymous refusal answers                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `"challenge"` _(default)_ | `401`, and a redirect to `user.loginPath` in a browser — what henri has always done                   |
| `"uniform"`               | exactly what a signed-in stranger gets: `policies.status`, the same message rule, and **no redirect** |

With `"uniform"` and the default `status`, the answer for a record somebody may not see and the answer for a record that is not there are one answer — same status, same body, same content type, same `Vary` — on both paths (`res.resource()` refusing on the way out, and a `req.authorize()` that throws), in JSON and in HTML. The `Location` is part of what had to become uniform: a `404` page that still said where to log in would have given it away through a header instead of a body.

It reads the key in one place, `Policies#refusal()`, so it covers **every** refusal a policy makes — the route gate's included, where nothing was leaking because nothing had been looked up. That is deliberate: a key that meant one thing for a rule taking a record and another for a rule that does not is a rule with a hole in it, and the hole is where the leak lives.

**The cost is the login page**, and it is in the hint, the configuration table and the policies guide in those words: a visitor following a bookmarked link to something they could see perfectly well once signed in gets a `404` instead of being asked to sign in, and giving them a way back is the application's job. `roles` on the route is untouched and still redirects an anonymous browser to the login page — it refuses before any lookup, so it gives nothing away — and remains the answer for a route where being asked to sign in is the right thing. The key is for the route that deliberately has no role and whose only guard is the policy.

`henri openapi` follows: a route guarded only by a policy no longer carries a `401` it cannot answer, and the description of the refusal and of the shared `NotFound` response say which of the two this application chose.

**`henri audit` says nothing about either value, and that is the argument rather than an oversight.** All 56 checks report something an application _said_ — a key set to a weakening value, a secret in a file, a shape in the source — or a declaration inconsistent with another. Not one reports a hardening left untaken, because a default henri chose is not a finding against the application. Reporting `"challenge"` would fire on every application that has policies and never asked for anything, over a trade only that application can weigh; and `"uniform"` is a strengthening, so a finding for it would be backwards. The precedent is next door: `policies.status: 403` — an application deliberately telling more — is not reported either, and this is that decision's twin.

Nothing changes for an application that does not ask: the default is today's behaviour, the signed-in half is exactly as it was, and the account flows — which answer before they look anything up, so a known and an unknown address cost the same — are untouched and asserted to be.
