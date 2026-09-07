---
'@usehenri/core': minor
'@usehenri/inertia': minor
'@usehenri/react': minor
'@usehenri/cli': minor
---

An asset prefix that also fixes the Content Security Policy, and the seam a CSS inliner plugs into.

Two things about the last hop, where what an application built reaches a browser or a mail client.

**`config.assets.prefix` points the compiled assets somewhere else.**

```json
{ "assets": { "prefix": "https://cdn.example.com" } }
```

It is what Vite calls `base` and Next calls `assetPrefix`, said once for whichever renderer the application uses: the entry module and its chunks, the stylesheets, and the fonts and images those stylesheets name. An absolute `http(s)` url moves them to another host, a path (`/assets`) keeps them on this one, and anything that is not a prefix — credentials, a query, a fragment — fails the boot with the rest of the configuration.

**The Content Security Policy is the part worth having.** `default-src 'self'` and `script-src 'self'` refuse a script from another origin, so an asset prefix that did not reach the policy would give you an application that boots, answers `200`, and paints nothing — every script of the document refused, with the reason only in the browser console. henri names the origin itself, in the directives that carry what a build produced (`script-src`, `style-src`, `font-src`, `img-src`, `connect-src`, `worker-src`, `media-src`) and in nothing else. `default-src` is deliberately left alone: widening it would let the asset host be framed and embedded as well, and the one thing that falls back to it is a `<link rel="prefetch">`, where a refusal costs a warm cache and never a page. Nothing goes in `config.helmet`, and the nonce still lands on every tag.

Three properties, each argued in the guide: the application still serves the assets at the same paths, which is what an origin-pull CDN pulls from; the prefix applies to the production build only, because in development the dev servers serve from this origin and there is nothing on the other host yet; and it is compiled into the bundle, so it decides the urls _inside_ a chunk and not only the document's tags. The policy names the origin in every environment all the same, which costs a request nothing and means a production configuration is never one directive away from a blank page.

On the Next.js renderer the value travels in `HENRI_ASSET_PREFIX`, because that is what next.js actually reads: it loads `app/views/next.config.js` off disk both in the build henri spawns and in a booted application, so a prefix handed only to `next({ conf })` reaches the build manifest and never a tag of the document. `config/next.js` still gets the last word, a renderer with no build is told the key does nothing, and `henri audit` reports an `http://` prefix in a production configuration (`assets.plaintext-prefix`, high: over https the browser refuses every script of every page).

This is **not** `uploads.urls.cdn`, and they do not share a word on purpose. That one is a cache in front of henri's own `/_uploads` route, which forwards to this application; this one names a host that serves files the build wrote, which the application never looks at again.

**`henri.mailers.onRender()` is where a CSS inliner goes, and henri ships none.**

```js
const juice = require('juice');

henri.mailers.onRender((message) => {
  message.html = juice(message.html);
});
```

A mail client is not a browser: Gmail drops a `<style>` element, Outlook honours about half of what survives, and a `<link>` never loads — so the rules a mail is styled by have to end up in `style=""` attributes. henri does not do that, and the guide now says why rather than leaving it unmentioned: the honest version is a CSS parser, a selector engine with specificity, an html parser and an html serializer, anything smaller is a regular expression over rendered html, and a mail that comes back mangled cannot be fixed after it is sent. `juice` is four of those and is one dependency in the application rather than one in the framework.

What henri owns is the seam and the guarantee about when it runs. The handler sees every message henri renders — a delivery, a `deliverLater()` and a `/_mailers` preview alike — and it runs **last**: both parts already exist, so an inliner rewriting `html` can never leak a `style=""` attribute into the `text/plain` part, which is derived from the html one. It receives the nodemailer payload and `{ mailer, action, view, layout }`, may change it in place or answer a new one, may be async, and throwing fails the render instead of sending something half-styled.
