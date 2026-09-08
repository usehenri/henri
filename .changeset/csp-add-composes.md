---
'@usehenri/core': minor
'@usehenri/cli': patch
---

`config.csp.add`, so adding one script origin no longer takes the rest of the policy with it.

`config.helmet` is merged over henri's own options and that merge replaces arrays. For every other helmet option that is right. For the Content Security Policy it was a trap, and it was measured on a booted application rather than argued about. This:

```json
{
  "assets": { "prefix": "https://cdn.example.com" },
  "csp": { "nonce": true },
  "helmet": {
    "contentSecurityPolicy": {
      "directives": { "script-src": ["'self'", "https://plausible.io"] }
    }
  }
}
```

answered `script-src 'self' https://plausible.io`, where henri had built `script-src 'self' https://cdn.example.com 'nonce-h7Qk…'`. Three things left with the array and nothing said so: the origin of `assets.prefix`, so every script the build wrote is refused and the application boots, answers 200 and paints nothing; the nonce, so `csp.nonce: true` was on and named by nowhere while the renderer went on stamping it onto the tags; and, in development, `'unsafe-inline'` and `'unsafe-eval'`, which is the hot reload. The header stayed well formed throughout, which is why it was silent.

**`config.csp.add` adds instead of replacing.**

```json
{ "csp": { "add": { "script-src": ["https://plausible.io"] } } }
```

The asset origin, the nonce and the development sources stay where they were. A directive henri does not set (`frame-src`) is seeded from `default-src`, which is what the browser was falling back to for it, so adding a source never quietly takes `'self'` away. `config.helmet.contentSecurityPolicy.directives` still replaces the array outright, which is how an application takes one of henri's sources _out_ — a union would have made that unsayable.

**The nonce is applied last, so an override cannot drop it.** The value is drawn per response, so nothing in a `config/*.json` can name it and an override replacing `script-src` was never a statement about it. henri's rule about `'unsafe-inline'` next to a nonce now applies to the array an application wrote too, for the reason it applies to henri's: the header says what the browser does.

**`scriptSrc` no longer fails the boot.** helmet accepts both spellings and they are one directive to it, but they were two keys to the merge — so `{ "scriptSrc": [...] }` next to henri's `script-src` made helmet throw `Content-Security-Policy received a duplicate directive "script-src"` at boot, naming a directive the application never wrote. The two spellings are folded before the merge. Writing _both_ in one `directives` object is refused (`HENRI_CONFIG_CSP_DUPLICATE_DIRECTIVE`) rather than resolved by JSON key order.

**And nothing is silent.** An override that drops one of henri's own sources is named at boot, directive by directive, with the asset origin called out for what it is; the view module's `assets from …` line no longer claims the policy names an origin it no longer names; and `csp.nonce` with the policy turned off is warned about rather than left to generate a value nothing allows.

Two adjacent fixes: `henri audit`'s `csp.script-unsafe-inline` reads both of helmet's spellings, so an application writing `scriptSrc` is no longer silently unreported; and a directive carrying a function of its own is never served from the cached header, which used to freeze whatever it answered at boot.
