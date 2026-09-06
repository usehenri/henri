---
'@usehenri/core': patch
---

The development server finds its port by binding rather than by asking first, and `detect-port` is no longer a dependency.

Asking whether a port is free and binding it afterwards leaves a window for anything else to take it in between: the same race that made the test suite answer from the wrong server. The server now binds the port it wants and walks up on `EADDRINUSE` in development, where a busy port outside development stays an error the operator sees. That also removes a package from every henri application's dependency tree, which is one fewer thing that can lose its provenance.
