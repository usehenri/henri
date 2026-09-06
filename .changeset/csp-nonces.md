---
'@usehenri/core': minor
'@usehenri/inertia': minor
'@usehenri/react': minor
'@usehenri/cli': minor
---

Content Security Policy nonces: `"csp": { "nonce": true }`

Every response draws a fresh nonce (16 bytes of the system CSPRNG, base64url),
`script-src` names it and loses `'unsafe-inline'` -- which the browser ignores
next to a nonce anyway, so the header now says what the browser does. The value
reaches your code as `res.locals.cspNonce`, `req._henri.nonce` and the `nonce`
view option.

The renderers carry it: the Inertia engine writes it on every script, style and
fetching link of the document (its own tags, the shell's, the ones Vite injects
in development and the ones the server bundle returned) and adds
`<meta property="csp-nonce">`, which is what Vite's own runtime reads for the
styles it injects and the chunks `__vitePreload` loads; the React engine gets it
through Next's pages router, which reads the nonce off the request's
`Content-Security-Policy` header; Handlebars gets a `{{nonce}}` helper. The Vue
renderer cannot, and the boot fails with `HENRI_VIEW_NONCE_UNSUPPORTED` rather
than sending a policy the document does not honour -- a view engine of your own
opts in with `supportsNonce = true`.

`style-src` deliberately keeps `'unsafe-inline'` and never gets the nonce: a
`style=""` attribute cannot carry one, and React, Inertia and Vite all set them.

The nonce costs 62ns a response (the secure-headers middleware goes from 147ns
to 209ns a request): the bytes come out of a pool refilled with
`crypto.randomFillSync` and the header is serialized once per protocol and cut
in two around the nonce, instead of the ~1.5µs `crypto.randomBytes` plus helmet
re-joining the header would cost.

`henri audit` gains `csp.script-unsafe-inline` (ASVS V14.4.3): a `script-src`
of the application's own that allows `'unsafe-inline'` with no nonce beside it.
