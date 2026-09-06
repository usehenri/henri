---
'@usehenri/core': minor
'@usehenri/cli': minor
---

The call log records the address the request came from, and says how sure it is.

An inbound row gains three columns: `client`, the address henri believes the
request came from; `peer`, the address that actually opened the socket; and
`source`, how `client` was decided. Every forwarding header is text a client
typed, so henri believes one only when the configuration can support it:
`X-Forwarded-For` through express' `trustProxy`, and a header express will
not read (`cf-connecting-ip` and friends) through the new
`calls.address.header` **and** `calls.address.from`, which lists the proxies
allowed to set it. Naming a header without `from` fails the boot
(`HENRI_CALLS_ADDRESS_UNVERIFIABLE`).

A blanket `trustProxy: true` in front of a forwarded request records **no
client address at all** and says `unverified`, keeping the peer. An address
that is a guess is worse than an empty column: an operator reading a call log
is answering "who did this", and the empty column asks a question where the
guess answers one. `henri audit` reports the combination
(`calls.address-unverified`), and reports a `from` covering every address
(`calls.address-from-any`).

An address is personal data, so it gets the care the rest of that table gets.
It lives in columns of its own and the forwarding headers are masked out of
the stored header blob, which is the one place an erasure cannot reach.
`calls.address.anonymize` truncates it to a `/24` or a `/48`, keeping the
prefix length in the value; it is off by default, because the column exists
to answer "who did this" and a `/24` answers "somebody in this city".

A person's rows now answer a data subject request: `henri privacy:export`
carries them under a `calls` key and `henri privacy:erase` writes over the
`actor`, both addresses and the four payload columns, leaving the moment, the
method, the route, the status and the request id. The access trail is
unchanged and records no address on purpose -- it holds no values, which is
what lets it outlive the erasure it recorded -- and `henri.reporter` still
carries nothing from the client.

A `henri_calls` table created before this release gains the three columns on
the next boot; the store adds what is missing.
