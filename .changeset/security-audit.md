---
'@usehenri/cli': minor
'@usehenri/mcp': minor
---

`henri audit` checks an application against the OWASP Application Security Verification Standard, from its files alone.

Knowing whether an application does the things a web application is judged on used to mean hiring someone. `henri audit` answers the checkable part of that question in the shape `henri doctor` already had: nothing booted, a stable name per check, `--json`, and an exit code.

```text
  henri audit: 2 findings in 27 checks (1 high, 1 medium, 0 low; failing on medium)

  high    csrf.disabled              config/production.json
          A01:2021 Broken Access Control / ASVS V4.2.2 (L1)
          cross-site request forgery protection is turned off, so any site can post to this one with the visitor session
          -> Remove "csrf": false. A JSON client that sends Authorization: Bearer, or no session cookie at all, is already exempt
```

The standard underneath is the ASVS 4.0.3, because it is the one written to be verified: numbered requirements, at levels, that an answer can be measured against. The Top 10 (2021) rides along as a second label on every finding, because that is what a report is read against outside a security team.

What it checks: a secret or a database password written in `config/*.json`; a `.env` or a credentials key that reached a commit; a `HENRI_SECRET` that is too short or reads like a placeholder; CSRF, helmet, the rate limiters, the parameter filters or the request timeout turned off; a `cors` that accepts any origin; `trustProxy: true`; a session that outlives 30 days; a `user.public` naming a credential; a model write that takes `req.body` whole; `{ unsafe: true }`; a raw query built by interpolation; a record answered as the ORM returned it; unescaped output in a view; an action of a resource left without a role while its siblings have one; a model exporting a `graphql` key, which mounts an endpoint with no depth limit; and the known advisories of the production dependencies.

Every check answers something that is true or false from the repository. Nothing here prints advice: henri's own defaults are never reported, because they are secure until an application turns them off, and what only a deployment knows — whether a proxy sits in front, whether TLS terminates before the process — is not checked at all. `henri audit --checks` prints the catalogue with the requirement and level each one maps to, so the answer is what an application has covered and not only what it failed.

- `--fail-on=<severity>` decides what exits with `1`: `medium` by default, `none` to report without failing. A finding in `config/test.json` is reported one severity lower.
- `--no-deps` skips the dependency advisories, which is the only step that reaches the network. That step asks the package manager about the **production** dependencies at **high and critical** only, and says so as a `low` finding rather than failing when it cannot run.
- `henri doctor` runs the same static checks and adds one `security.findings` warning when they find something, so the habit of running `doctor` is enough to notice.
- The `henri` MCP server exposes it as the `audit` tool.

The new [Security](https://usehenri.io/guides/security/) page carries the other half, and is the more useful one: the table of what henri does for every application — the hashing, the session cookie, the headers, the CSRF token, the rate limits, the role guards, the `externalId` — next to what stays yours, and the gaps henri has not closed yet.
