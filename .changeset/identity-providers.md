---
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/drizzle': patch
---

Signing in with somebody else's identity provider, and the merge rule that decides who ends up owning the account.

`omniauth` is the second biggest thing in Rails authentication and nothing has replaced it, but the strategy was never the work: passport has one for every provider. The work is the part a framework alone can do — an identity table beside the user model, a callback that lives inside the CSRF, session and lockout machinery henri already owns, and a rule for what happens when a provider hands over an address that already belongs to somebody here. That last one is what applications get wrong, and getting it wrong hands a password account to whoever can obtain an ID token for its address.

```json
{
  "user": {
    "identities": {
      "providers": {
        "acme": {
          "authorizationUrl": "https://acme.example/oauth/authorize",
          "tokenUrl": "https://acme.example/oauth/token",
          "userinfoUrl": "https://acme.example/oauth/userinfo",
          "clientId": "...",
          "clientSecret": "...",
          "scope": ["openid", "email"]
        }
      }
    }
  }
}
```

henri ships **no provider list and no provider secrets**. There is no `github` in the source and nothing to fill in for one: an application names its providers, and the client secret belongs in the encrypted credentials (`henri credentials:edit`) or in the environment — `henri audit` reports one written in a `config/*.json` the way it already reports an encryption key there.

**The merge rule refuses.** A callback whose verified address already belongs to an account answers `exists`, opens no session, writes nothing, and tells the person to sign in the way they already do and then link the provider from their account. Linking automatically on `email_verified` is the wrong answer three times over: it lets a stranger change which credentials open an account, it collapses that account's security to the weakest provider it can be linked from, and `email_verified` is a provider's belief about a mailbox rather than a statement about who owns an account in your database — and half the providers do not send it at all, so reading "absent" as "verified" builds the takeover by accident. The third possibility, _link only when the session already belongs to that user_, is right and is not a setting because it is the **flow**: a callback started from a signed-in session is a link, always, and it is the only automatic link henri makes. `merge: "verified"` exists for the single-tenant application whose provider is its own corporate identity provider; it needs that provider marked `trusted`, and `henri audit` reports the pair.

**An address the provider did not verify decides nothing.** It is never matched against an account and never creates one, and the refusal is written **before the user table is read**, so an address that has an account and one that has none are the same answer at the same price — the property the account flows already keep. A person who is already linked signs in whatever the address says, because the credential is the subject the provider issues and never the address, which is also why two providers claiming one address are two rows rather than a merge.

The endpoints go inside the machinery rather than beside it. `POST /auth/:provider` leaves through the double-submit CSRF token and the origin check, which this one route asks for itself even when the visitor holds no session cookie — the middleware waives the check there, because there is normally no session for a third-party page to ride on, and a visitor about to sign in is exactly the person who has none (`GET` answers `405`, so a third-party page cannot start an authentication in a visitor's browser); `GET /auth/:provider/callback` comes back to a `state` minted per attempt, kept in the session, single use and expiring, with PKCE S256 whose verifier never leaves the server; the session identifier is new before the person is in it; and the per-account lockout of `POST /login` is checked and cleared here too, so a provider is not a way around it — but a failed callback is never _counted_, because there is nothing to guess at a callback and counting would only hand somebody a way to lock an address out. `POST /auth/:provider/unlink` refuses to take away the last way into an account.

`henri_identities` is a table henri owns the way the queue and the access trail own theirs — raw SQL through the adapter or a MongoDB collection, never a model — because **a row is a credential**: whoever can write one can sign in as whoever it points at, and a model would put `provider` and `subject` behind an application's own mass assignment, scaffold and routes. A row records what it is allowed to imply (`signin`, or `verify` for a provider that identifies a person and never opens a session on its own) and how it came to be (`signup`, `session` or `verified`), and both are read from the row rather than from the configuration, so changing a provider never promotes what was linked under the old rule. `henri privacy:export` lists a person's providers without the subject, and `henri privacy:erase` deletes the rows rather than anonymizing them, because an anonymized credential still opens the account.

henri never parses an `id_token`: the profile is what `userinfoUrl` answers to a request henri makes with the access token, which is the same claims over a channel that is already authenticated and none of the JWKS, key rotation and algorithm confusion. And henri is a client, never an OAuth _provider_ — that is a different product.

`henri generate authentication` writes the sign-in buttons and an account page for linking and unlinking, both rendered from whatever the configuration names, so an application with no provider gets no button and a sentence saying where a provider goes.
