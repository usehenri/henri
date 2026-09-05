---
'@usehenri/testing': patch
---

`@usehenri/testing/setup-file` now binds every server the suite starts to `127.0.0.1`.

A server started with a port but no host takes the IPv6 wildcard in dual-stack mode, with address reuse enabled, so another process can hold the same port on the loopback address at the same time. On macOS and the BSDs the more specific socket then wins the IPv4 connection and a request is answered by the wrong server. The symptoms do not look like a port problem: a `404` on a route that exists, a missing middleware header, an empty body, a `socket hang up`, or a parse error when a database answers an HTTP client. This is what made henri's own suite fail about one run in ten. Applying it made 6000 requests answer correctly where 12 had gone to the wrong server. `@usehenri/testing/loopback` applies it on its own for a suite that boots henri another way.
