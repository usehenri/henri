---
'@usehenri/core': patch
---

`upgrade-insecure-requests` is only sent to requests that arrived over https.

On a page served over plain http the directive rewrote every later request of that page to https, including the redirect a controller answers after a `POST`. The record was written and the browser then failed against a server that speaks http, so the page never followed the redirect and the form looked broken with only a network error in the console. It hit every app checked with `henri build && henri server --production` locally and every deployment served over http. The directive now follows `req.secure`, which honours `trustProxy` and `X-Forwarded-Proto`, so apps behind a TLS proxy keep it and `config.helmet` can still add it everywhere.
