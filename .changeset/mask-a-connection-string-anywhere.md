---
'@usehenri/core': patch
---

The boot report masks the password of a connection string wherever the string
is, not only when the value is the url itself.

`DATABASE_URL` has always printed `postgres://henri:[FILTERED]@host/db`. The
same url arriving inside an object — `HENRI_CONFIG_JSON__stores`, or a store
block from the encrypted credentials — went through the redaction that matches
_key names_, and `url` is a name no `filterParameters` list would ever hold, so
the password was printed in the clear. Both paths now walk the value and mask
every connection string in it.
