---
'@usehenri/core': minor
'@usehenri/redis': minor
---

`henri.cache`: a cache store with `fetch`, on this process's memory or on the backend `config.shared` already names.

`henri.cache.fetch(key, [options], fn)` answers from the cache or runs the function and keeps what it returned; `get`, `set`, `delete`, `clear` and `scope(name)` are the store underneath, and `stats()` says what it has been doing. Every entry has a TTL (`config.cache.ttl`, five minutes by default) — there is no way to keep a value forever, by accident or on purpose.

**The stampede.** A key that expires under load is missed by every request at once. `fetch` keeps one promise per key while the function runs and hands it to everyone who missed it, so a hundred concurrent misses of one key in one process run the function once. Across processes the bound is the number of processes, deliberately: a cross-process lock needs a lease, and a lease means guessing how long the function may take — guess short and it runs twice anyway, guess long and one crashed process blocks every reader of that key.

**Two backends, named once.** Without `config.shared` the cache is this process's memory, bounded twice (`maxEntries`, 1000, and `maxSize`, 32mb) and evicting the least recently used, so it cannot become a leak. With `config.shared` — the block that already says where the rate limit, the sign-in lockout and the idempotency keys are counted — the cache is on that backend, in a key space of its own, with nothing else to configure. `config.cache.store` still names a module of its own for whoever wants the cache somewhere the counters are not.

**What a value may be.** JSON, plus `Date` (which comes back a `Date`). A model instance, any other class instance, `undefined`, `NaN`, `Infinity`, a `Map`, a `Set`, a `Buffer`, a `RegExp`, a function, a symbol, a bigint or anything circular is refused with `HENRI_CACHE_VALUE_UNSUPPORTED`, naming where it sat and what it was but never what it held — rather than stored to come back wrong. A value bigger than `maxEntrySize` (256kb) is not stored at all: `set` answers `false` and says so once, and nothing is ever truncated.

**A backend that is down is a miss**, whatever `config.shared.onError` says. The counters block because a guard that cannot count is not a guard; a cache holds no truth, so refusing a request over a copy would turn an optimization into an outage. Every fallthrough is logged at most once every ten seconds, like the counters'. Keys reaching a log line are masked by `config.filterParameters`, and values never reach one.

**henri invalidates nothing for you**: no model callback, no query cache, no route. `delete` is yours to call, and with the memory backend it reaches one process — which is the reason a deployment running several of them wants `config.shared`.

New configuration key `cache` (`ttl`, `maxEntries`, `maxSize`, `maxEntrySize`, `store`, `enabled`; `false` turns the cache off). `@usehenri/redis` gains a raw mode on its key-value store, so the cache's already-encoded entry is not wrapped in JSON a second time, and a `clear(prefix)` that walks its own key space with `SCAN` and `UNLINK` — never `FLUSHDB`. See the new [Caching](https://usehenri.io/guides/caching/) guide.
