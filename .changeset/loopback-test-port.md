---
'@usehenri/core': patch
---

Under `NODE_ENV=test` the server lets the kernel hand it a port instead of looking for a free one first.

`server.start()` called `detect(port)` and then `listen()` on whatever it answered, which is two operations with a gap in between: anything else binding meanwhile — another suite booting its own application, a supertest listener, a database picking a port the same way — could take it, and the boot then failed with `port 3000 already in use`, or worse, succeeded on a port another suite believed it owned and answered its requests. Asking for port `0` is a single operation and cannot race; `henri.server.port` and `henri.server.url` report the port the kernel gave. Development and production keep the port from the configuration.
