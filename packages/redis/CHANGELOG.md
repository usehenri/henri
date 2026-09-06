# @usehenri/redis

## 1.2.0

### Minor Changes

- [#373](https://github.com/usehenri/henri/pull/373) [`2c8a826`](https://github.com/usehenri/henri/commit/2c8a8265262dbf6ea5c3e73e8e7892a230d4d0f0) Thanks [@reel](https://github.com/reel)! - `config.shared`: one backend for the counters that only worked with one process
  
  The rate limit, the sign-in lockout and the idempotency keys each keep a
  number per key, and all three were kept in the process's memory unless the
  application named a store in three separate configuration keys. Two processes
  therefore meant two sets of counters: a rate limit that is twice what it says,
  a lockout an attacker escapes by being routed elsewhere, and an idempotency
  key that stops being idempotent.
  
  `config.shared` is the one place to say where they live instead:
  
  ```json
  {
    "shared": {
      "adapter": "redis",
      "url": "redis://127.0.0.1:6379",
      "prefix": "lineup:",
      "onError": "closed"
    }
  }
  ```
  
  `@usehenri/redis` is the backend, a package an application installs
  (`pnpm add @usehenri/redis`), resolved from the application the way a store
  adapter is; nothing is added to an application that does not name it. It talks
  to Redis through node-redis and counts the rate limits with `rate-limit-redis`.
  `rateLimit.store`, `user.lockout.store` and `api.idempotency.store` keep
  working and still win, key by key.
  
  When the backend does not answer, `shared.onError` decides: `closed` (the
  default) refuses the request with a `503` and a `Retry-After`, `open` serves it
  uncounted; either is logged, at most once every ten seconds per counter. The
  idempotency keys are always closed, whatever `onError` says. A backend that is
  unreachable at boot does not fail the boot: the client keeps reconnecting and
  `GET /readyz` reports it (`"shared": { "ok": false }`), so the process leaves
  the load balancer instead of the fleet.
  
  The boot says which it is on every application -- `counted in redis (fail
  closed)` or `counted in this process` -- and warns outright when the
  environment says this process is one of several (a cluster worker, a numbered
  pm2 instance, `WEB_CONCURRENCY`, a Heroku dyno past the first) and no shared
  backend is configured. `henri doctor` reports a shared store that does not
  answer (`shared.unreachable`) and asks for the adapter package when the
  configuration names one; `--no-reach` skips the connection.
  
  Sessions are not part of this: they already go through the database adapter,
  which every process shares.

- [#374](https://github.com/usehenri/henri/pull/374) [`0b32fbd`](https://github.com/usehenri/henri/commit/0b32fbde19c95da8fe07fab76933840a4242c71c) Thanks [@reel](https://github.com/reel)! - `henri.cache`: a cache store with `fetch`, on this process's memory or on the backend `config.shared` already names.
  
  `henri.cache.fetch(key, [options], fn)` answers from the cache or runs the function and keeps what it returned; `get`, `set`, `delete`, `clear` and `scope(name)` are the store underneath, and `stats()` says what it has been doing. Every entry has a TTL (`config.cache.ttl`, five minutes by default) — there is no way to keep a value forever, by accident or on purpose.
  
  **The stampede.** A key that expires under load is missed by every request at once. `fetch` keeps one promise per key while the function runs and hands it to everyone who missed it, so a hundred concurrent misses of one key in one process run the function once. Across processes the bound is the number of processes, deliberately: a cross-process lock needs a lease, and a lease means guessing how long the function may take — guess short and it runs twice anyway, guess long and one crashed process blocks every reader of that key.
  
  **Two backends, named once.** Without `config.shared` the cache is this process's memory, bounded twice (`maxEntries`, 1000, and `maxSize`, 32mb) and evicting the least recently used, so it cannot become a leak. With `config.shared` — the block that already says where the rate limit, the sign-in lockout and the idempotency keys are counted — the cache is on that backend, in a key space of its own, with nothing else to configure. `config.cache.store` still names a module of its own for whoever wants the cache somewhere the counters are not.
  
  **What a value may be.** JSON, plus `Date` (which comes back a `Date`). A model instance, any other class instance, `undefined`, `NaN`, `Infinity`, a `Map`, a `Set`, a `Buffer`, a `RegExp`, a function, a symbol, a bigint or anything circular is refused with `HENRI_CACHE_VALUE_UNSUPPORTED`, naming where it sat and what it was but never what it held — rather than stored to come back wrong. A value bigger than `maxEntrySize` (256kb) is not stored at all: `set` answers `false` and says so once, and nothing is ever truncated.
  
  **A backend that is down is a miss**, whatever `config.shared.onError` says. The counters block because a guard that cannot count is not a guard; a cache holds no truth, so refusing a request over a copy would turn an optimization into an outage. Every fallthrough is logged at most once every ten seconds, like the counters'. Keys reaching a log line are masked by `config.filterParameters`, and values never reach one.
  
  **henri invalidates nothing for you**: no model callback, no query cache, no route. `delete` is yours to call, and with the memory backend it reaches one process — which is the reason a deployment running several of them wants `config.shared`.
  
  New configuration key `cache` (`ttl`, `maxEntries`, `maxSize`, `maxEntrySize`, `store`, `enabled`; `false` turns the cache off). `@usehenri/redis` gains a raw mode on its key-value store, so the cache's already-encoded entry is not wrapped in JSON a second time, and a `clear(prefix)` that walks its own key space with `SCAN` and `UNLINK` — never `FLUSHDB`. See the new [Caching](https://usehenri.io/guides/caching/) guide.

### Patch Changes

- Updated dependencies [[`1e23664`](https://github.com/usehenri/henri/commit/1e23664829bd1a356de28f404cfb21c9ae211388), [`5b627ad`](https://github.com/usehenri/henri/commit/5b627adfa37e9f16bc75af96cc8ff5308a91f688), [`1b316c6`](https://github.com/usehenri/henri/commit/1b316c6f3c5d5eb5752c70b534092d1052956cc6), [`7fd13f6`](https://github.com/usehenri/henri/commit/7fd13f631b75f7aa152b73046b50c6902ae3ca93), [`b559fb7`](https://github.com/usehenri/henri/commit/b559fb72b391eeb21a3f6a0cda1515e01ecbfafc), [`1c0dfe8`](https://github.com/usehenri/henri/commit/1c0dfe84a98eff2122512256c4f42ec7ccde4212), [`93060a8`](https://github.com/usehenri/henri/commit/93060a86df795dbbd99bf1895beb0cf14c4b86de), [`e031900`](https://github.com/usehenri/henri/commit/e031900082f28aec72af4cda9cd959f932e2ebc7), [`9173000`](https://github.com/usehenri/henri/commit/91730005efa88f073bfaaf67078c3ec0e137b459), [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea), [`b278119`](https://github.com/usehenri/henri/commit/b2781190de436eb5838e866446c9a0c8210bb6ca), [`b161e1b`](https://github.com/usehenri/henri/commit/b161e1b8fad94af2d2afc351dc1bc07dabbb1379), [`1616e34`](https://github.com/usehenri/henri/commit/1616e343a612be2bffffcfa5b23bfa8ad191bbe3), [`bcf4ce2`](https://github.com/usehenri/henri/commit/bcf4ce22bcd294844504164fac1fa4aef1ffec41), [`ab5a8e4`](https://github.com/usehenri/henri/commit/ab5a8e4a88c80cca070a2b8ad398c80babdaff11), [`43d267f`](https://github.com/usehenri/henri/commit/43d267f0f9d192b2c01e89c3925b7daf5000041b), [`9f868f3`](https://github.com/usehenri/henri/commit/9f868f3d9162fa218e34304110210e6949f97d5c), [`89dda62`](https://github.com/usehenri/henri/commit/89dda62da456a0a55600e79cfb65ce89f11258e2), [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea), [`d9f3be4`](https://github.com/usehenri/henri/commit/d9f3be49c5929d929a220220bf6e72fdcb135595), [`c44f025`](https://github.com/usehenri/henri/commit/c44f025acec3d5bbbb57e2310d02184a1053a10d), [`67cfb20`](https://github.com/usehenri/henri/commit/67cfb200ea0e0b31bacf2af183db6467b0fa011d), [`e661f98`](https://github.com/usehenri/henri/commit/e661f98fe8f8acce15aa10ce2dc320c5a2cb006f), [`2c8a826`](https://github.com/usehenri/henri/commit/2c8a8265262dbf6ea5c3e73e8e7892a230d4d0f0), [`46d5dbc`](https://github.com/usehenri/henri/commit/46d5dbcc983c03e96ae5a87d7288c5d8a5adbc24), [`ba97ea9`](https://github.com/usehenri/henri/commit/ba97ea968f0b34cd67b7a3e803ecd34543b8aaaf), [`5ccd537`](https://github.com/usehenri/henri/commit/5ccd537b3621b54d11e7f24ccca39643ae7d5cf7), [`9895cbf`](https://github.com/usehenri/henri/commit/9895cbf4be85b476e341a5be915e3049e5a027de), [`5a150d5`](https://github.com/usehenri/henri/commit/5a150d576208571c32b9cd12827d035e31ed4313), [`3c1c5b8`](https://github.com/usehenri/henri/commit/3c1c5b83ea135b000ddd6ffbfd05457b000f2f7c), [`aa3f90b`](https://github.com/usehenri/henri/commit/aa3f90bd6f42bb05431c33f3e4bf2202cb6bb7c6), [`a1c6769`](https://github.com/usehenri/henri/commit/a1c6769099e3dc28b22b5338a2a57b13bdf69f7a), [`ec1c8c4`](https://github.com/usehenri/henri/commit/ec1c8c419f4d9063a7617472b2970fdb8a929fa1), [`dd2731d`](https://github.com/usehenri/henri/commit/dd2731d6a20fd96aa1be1aeb5e6ec0155001326b), [`b7038ce`](https://github.com/usehenri/henri/commit/b7038ceaa430f4a0b9eaf7e983fc2844421bf636), [`1ea0f85`](https://github.com/usehenri/henri/commit/1ea0f85066b86fba31f58937cc10abb6359e6a26), [`01a561a`](https://github.com/usehenri/henri/commit/01a561aa58650ec15df1c2659795a5e4c5bbfd53), [`e31a3f7`](https://github.com/usehenri/henri/commit/e31a3f73e7e8facf3cedf7460f115e57995f32c3), [`2689779`](https://github.com/usehenri/henri/commit/26897798b840fd28a4bc091c050a83457b36905d), [`72cd1d3`](https://github.com/usehenri/henri/commit/72cd1d35ffb99311bbca815c1f6ab41ee3682f64), [`a2e1ec2`](https://github.com/usehenri/henri/commit/a2e1ec29df52462f12ebaae9bfbc1ad4f427b27f), [`afead74`](https://github.com/usehenri/henri/commit/afead7489498ed42e1893a25123ea772cac2ca09), [`a4ecba5`](https://github.com/usehenri/henri/commit/a4ecba50c663f4d5c741adbb6cd9bc0eefe0e5cc), [`baec3fd`](https://github.com/usehenri/henri/commit/baec3fd22be92bf8ffbaeb251b0b6c2771f8347a), [`e865d94`](https://github.com/usehenri/henri/commit/e865d945d65419ac676f5a2fe3ba3b6114a1e53d), [`4274567`](https://github.com/usehenri/henri/commit/4274567e20a980657f07df9ec7db25296c7d55f5), [`aea429c`](https://github.com/usehenri/henri/commit/aea429ca99338a62370ab3e3d94bdc6b8c227601), [`8a8e3b3`](https://github.com/usehenri/henri/commit/8a8e3b33d7967b81f66633aa25c3075318f01d60), [`18715f9`](https://github.com/usehenri/henri/commit/18715f90ea8958dc57da1bb029b8209c36b84cc6), [`831aa5c`](https://github.com/usehenri/henri/commit/831aa5c011f3432630c68b8d26755d2582f82f74), [`16824e8`](https://github.com/usehenri/henri/commit/16824e8fe9ccc6a04dab5d9b2481c29ff4f6b64b), [`fda9366`](https://github.com/usehenri/henri/commit/fda9366e9ed2b072764a995c5aa60205ca7a4725), [`1a86acb`](https://github.com/usehenri/henri/commit/1a86acbf15e4a43e5fb81277bb22e101c06e77a4), [`0b32fbd`](https://github.com/usehenri/henri/commit/0b32fbde19c95da8fe07fab76933840a4242c71c), [`c0c16e8`](https://github.com/usehenri/henri/commit/c0c16e873ba440aee9832160553cbb12ab81bd2c), [`41470bf`](https://github.com/usehenri/henri/commit/41470bf378d83ca3d35d00e8c31796fea5eb15e0), [`8e44e7e`](https://github.com/usehenri/henri/commit/8e44e7e882dd8741b3ac632651b453389d76bf2c), [`de1c1e0`](https://github.com/usehenri/henri/commit/de1c1e02ed83d13dcfeb8e44012f309eb663f03e), [`4b4677d`](https://github.com/usehenri/henri/commit/4b4677d4a09d39fe50b1fa4af577600342578daf)]:
  - @usehenri/core@1.2.0
