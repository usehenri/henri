# @usehenri/redis

## 1.2.0

### Minor Changes

- [#419](https://github.com/usehenri/henri/pull/419) [`43a0e1a`](https://github.com/usehenri/henri/commit/43a0e1a6a320baa43298391e1c1e0334d6cd28d5) Thanks [@reel](https://github.com/reel)! - `henri.flags`: feature flags declared in one file, on for everyone, for a named set, for a stable share of them, or for a group the application writes in code.
  
  `config/flags.js` is the declaration — `checkout: false` is a whole flag, and the long form adds `description`, `expose` and `group`. `await req.flag('checkout')` and `await henri.flags.enabled('checkout', user)` are the read; `henri flags`, `flags:on`, `flags:off`, `flags:percentage` and `flags:reset` are what an operator has. `flipper` is what this learns from: the gates and the `enable`/`disable` vocabulary are kept, `percentage_of_time` is not (a feature that flickers within one page load is a bug henri would have caused), and neither are the expression gates, the web UI or the metrics.
  
  **A name nothing declares is a failure, not a `false`** — the position `req.permit()`, `params`, `answers` and `filters` already take. A typo that answers `false` forever is a feature that silently never ships; a typo that throws is a stack trace in development, in the suite, and on the first request that reaches it. Both messages name the closest declared flag, and the cost is stated out loud in the guide: removing a flag is two deploys.
  
  **The percentage is stable and it is hashed carefully.** The bucket is `sha256(flag + actor)`, computed and never stored, so the same person keeps the same answer across processes and restarts and a rollout only ever adds people. The flag name is in the hash so two features at ten percent are not on for the same ten percent, and the identifier — the `externalId`, never the primary key — is hashed **whole**: a uuid v7 is time-ordered, so bucketing on any prefix of one would roll a feature out by signup date rather than at random.
  
  **The state is where every process can read it.** `config.shared` when there is a backend, `.henri/flags.json` otherwise, this process's memory under `NODE_ENV=test`, and the boot line says which and says its limit. Reads come from an in-memory snapshot re-read on a timer (`flags.refresh`, ten seconds, which is the whole staleness window), not through `henri.cache` — a cache's answer to a backend that is down is a miss, and a miss here would revert every flag to its default mid-incident. **A store that cannot be read flips nothing**: the snapshot stands and it is reported at most once a minute.
  
  `henri flags` boots to runlevel 2 and no further, so a kill switch can be flipped while the database is unreachable. There is **no HTTP surface** in any environment: an application that wants a page writes the controller and puts a policy on it.
  
  New configuration key `flags` (`store`, `refresh`, `enabled`), four `HENRI_FLAGS_*` codes, and `@usehenri/redis` gains a key-value write with no expiry, for the state that must outlive a restart. See the new [Feature flags](https://usehenri.io/guides/feature-flags/) guide.

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

- Updated dependencies [[`792a15a`](https://github.com/usehenri/henri/commit/792a15ade614cf8b920d9197586f9866700d458e), [`1e23664`](https://github.com/usehenri/henri/commit/1e23664829bd1a356de28f404cfb21c9ae211388), [`5b627ad`](https://github.com/usehenri/henri/commit/5b627adfa37e9f16bc75af96cc8ff5308a91f688), [`4dff51e`](https://github.com/usehenri/henri/commit/4dff51edc050e29398c793a5aedb48776b7b7119), [`60dbf33`](https://github.com/usehenri/henri/commit/60dbf33c2a4f14e328a0df1cb44be061e15431e5), [`1b316c6`](https://github.com/usehenri/henri/commit/1b316c6f3c5d5eb5752c70b534092d1052956cc6), [`d074e8b`](https://github.com/usehenri/henri/commit/d074e8b482582e25f80d8a14b4735e69a2b7821e), [`7fd13f6`](https://github.com/usehenri/henri/commit/7fd13f631b75f7aa152b73046b50c6902ae3ca93), [`b559fb7`](https://github.com/usehenri/henri/commit/b559fb72b391eeb21a3f6a0cda1515e01ecbfafc), [`1c0dfe8`](https://github.com/usehenri/henri/commit/1c0dfe84a98eff2122512256c4f42ec7ccde4212), [`93060a8`](https://github.com/usehenri/henri/commit/93060a86df795dbbd99bf1895beb0cf14c4b86de), [`e031900`](https://github.com/usehenri/henri/commit/e031900082f28aec72af4cda9cd959f932e2ebc7), [`9173000`](https://github.com/usehenri/henri/commit/91730005efa88f073bfaaf67078c3ec0e137b459), [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea), [`b7f33e2`](https://github.com/usehenri/henri/commit/b7f33e28a5e4844391befd75d08e42c4cf6212ed), [`3d6f3fc`](https://github.com/usehenri/henri/commit/3d6f3fc048d05db41be86069608d342e437408cb), [`b278119`](https://github.com/usehenri/henri/commit/b2781190de436eb5838e866446c9a0c8210bb6ca), [`b161e1b`](https://github.com/usehenri/henri/commit/b161e1b8fad94af2d2afc351dc1bc07dabbb1379), [`7cb0b04`](https://github.com/usehenri/henri/commit/7cb0b04b29b61dedaa82fcd1972646fb3765acfc), [`1616e34`](https://github.com/usehenri/henri/commit/1616e343a612be2bffffcfa5b23bfa8ad191bbe3), [`c8f5367`](https://github.com/usehenri/henri/commit/c8f53678b33341d086b467f801e959314afc7860), [`bcf4ce2`](https://github.com/usehenri/henri/commit/bcf4ce22bcd294844504164fac1fa4aef1ffec41), [`ab5a8e4`](https://github.com/usehenri/henri/commit/ab5a8e4a88c80cca070a2b8ad398c80babdaff11), [`43d267f`](https://github.com/usehenri/henri/commit/43d267f0f9d192b2c01e89c3925b7daf5000041b), [`9f868f3`](https://github.com/usehenri/henri/commit/9f868f3d9162fa218e34304110210e6949f97d5c), [`d88bf7f`](https://github.com/usehenri/henri/commit/d88bf7fe038a6b58e7bed02ff4c90755f6c0e65e), [`49398a6`](https://github.com/usehenri/henri/commit/49398a6308f0760f01c6ff2ec98aaa35f484474d), [`89dda62`](https://github.com/usehenri/henri/commit/89dda62da456a0a55600e79cfb65ce89f11258e2), [`62fac46`](https://github.com/usehenri/henri/commit/62fac46fd6cae5581979b73daf99700fd246e0ea), [`a93d6cc`](https://github.com/usehenri/henri/commit/a93d6cc39b33b261089e91f3e757b54fefc9fe15), [`d9f3be4`](https://github.com/usehenri/henri/commit/d9f3be49c5929d929a220220bf6e72fdcb135595), [`c44f025`](https://github.com/usehenri/henri/commit/c44f025acec3d5bbbb57e2310d02184a1053a10d), [`67cfb20`](https://github.com/usehenri/henri/commit/67cfb200ea0e0b31bacf2af183db6467b0fa011d), [`e661f98`](https://github.com/usehenri/henri/commit/e661f98fe8f8acce15aa10ce2dc320c5a2cb006f), [`43a0e1a`](https://github.com/usehenri/henri/commit/43a0e1a6a320baa43298391e1c1e0334d6cd28d5), [`cee57b9`](https://github.com/usehenri/henri/commit/cee57b9d3521a4a70c715222eae1f18ff4a6c128), [`61bf75c`](https://github.com/usehenri/henri/commit/61bf75cbaccda1aecff34408a175b2d85447d7a8), [`2c8a826`](https://github.com/usehenri/henri/commit/2c8a8265262dbf6ea5c3e73e8e7892a230d4d0f0), [`46d5dbc`](https://github.com/usehenri/henri/commit/46d5dbcc983c03e96ae5a87d7288c5d8a5adbc24), [`ba97ea9`](https://github.com/usehenri/henri/commit/ba97ea968f0b34cd67b7a3e803ecd34543b8aaaf), [`5ccd537`](https://github.com/usehenri/henri/commit/5ccd537b3621b54d11e7f24ccca39643ae7d5cf7), [`d88bf7f`](https://github.com/usehenri/henri/commit/d88bf7fe038a6b58e7bed02ff4c90755f6c0e65e), [`9895cbf`](https://github.com/usehenri/henri/commit/9895cbf4be85b476e341a5be915e3049e5a027de), [`61bf75c`](https://github.com/usehenri/henri/commit/61bf75cbaccda1aecff34408a175b2d85447d7a8), [`5a150d5`](https://github.com/usehenri/henri/commit/5a150d576208571c32b9cd12827d035e31ed4313), [`3c1c5b8`](https://github.com/usehenri/henri/commit/3c1c5b83ea135b000ddd6ffbfd05457b000f2f7c), [`2625067`](https://github.com/usehenri/henri/commit/26250673d91ab70ad024739d02b647754f75267d), [`aa3f90b`](https://github.com/usehenri/henri/commit/aa3f90bd6f42bb05431c33f3e4bf2202cb6bb7c6), [`a1c6769`](https://github.com/usehenri/henri/commit/a1c6769099e3dc28b22b5338a2a57b13bdf69f7a), [`0a8bb41`](https://github.com/usehenri/henri/commit/0a8bb415d352cd75b12d07e591c8ec7c16774a99), [`ec1c8c4`](https://github.com/usehenri/henri/commit/ec1c8c419f4d9063a7617472b2970fdb8a929fa1), [`dd2731d`](https://github.com/usehenri/henri/commit/dd2731d6a20fd96aa1be1aeb5e6ec0155001326b), [`ab52e18`](https://github.com/usehenri/henri/commit/ab52e187c420dfe381f03ed51c5c141fda525acb), [`b7b56e1`](https://github.com/usehenri/henri/commit/b7b56e190ae774abc0096fe2aebaf91f823115af), [`b7038ce`](https://github.com/usehenri/henri/commit/b7038ceaa430f4a0b9eaf7e983fc2844421bf636), [`1ea0f85`](https://github.com/usehenri/henri/commit/1ea0f85066b86fba31f58937cc10abb6359e6a26), [`762062a`](https://github.com/usehenri/henri/commit/762062aadc450d49b1a2d15524f9d579ab4f60e7), [`01a561a`](https://github.com/usehenri/henri/commit/01a561aa58650ec15df1c2659795a5e4c5bbfd53), [`bd1b630`](https://github.com/usehenri/henri/commit/bd1b63083b3817b8c47b8a187de76027458a1b32), [`27b5513`](https://github.com/usehenri/henri/commit/27b5513d1cae8aba734fe27da0ace2a82423e2f4), [`e31a3f7`](https://github.com/usehenri/henri/commit/e31a3f73e7e8facf3cedf7460f115e57995f32c3), [`2689779`](https://github.com/usehenri/henri/commit/26897798b840fd28a4bc091c050a83457b36905d), [`72cd1d3`](https://github.com/usehenri/henri/commit/72cd1d35ffb99311bbca815c1f6ab41ee3682f64), [`a2e1ec2`](https://github.com/usehenri/henri/commit/a2e1ec29df52462f12ebaae9bfbc1ad4f427b27f), [`afead74`](https://github.com/usehenri/henri/commit/afead7489498ed42e1893a25123ea772cac2ca09), [`a4ecba5`](https://github.com/usehenri/henri/commit/a4ecba50c663f4d5c741adbb6cd9bc0eefe0e5cc), [`baec3fd`](https://github.com/usehenri/henri/commit/baec3fd22be92bf8ffbaeb251b0b6c2771f8347a), [`1103628`](https://github.com/usehenri/henri/commit/110362808f8ec6d73a75ff7fc89a77f3e943d773), [`e865d94`](https://github.com/usehenri/henri/commit/e865d945d65419ac676f5a2fe3ba3b6114a1e53d), [`4274567`](https://github.com/usehenri/henri/commit/4274567e20a980657f07df9ec7db25296c7d55f5), [`aea429c`](https://github.com/usehenri/henri/commit/aea429ca99338a62370ab3e3d94bdc6b8c227601), [`8a8e3b3`](https://github.com/usehenri/henri/commit/8a8e3b33d7967b81f66633aa25c3075318f01d60), [`18715f9`](https://github.com/usehenri/henri/commit/18715f90ea8958dc57da1bb029b8209c36b84cc6), [`0d2ebc3`](https://github.com/usehenri/henri/commit/0d2ebc344bfcd80533ef900638083e4c105407bb), [`49398a6`](https://github.com/usehenri/henri/commit/49398a6308f0760f01c6ff2ec98aaa35f484474d), [`ec64e44`](https://github.com/usehenri/henri/commit/ec64e44e7b79a02da5fc587a72a9a6c900836982), [`831aa5c`](https://github.com/usehenri/henri/commit/831aa5c011f3432630c68b8d26755d2582f82f74), [`16824e8`](https://github.com/usehenri/henri/commit/16824e8fe9ccc6a04dab5d9b2481c29ff4f6b64b), [`fda9366`](https://github.com/usehenri/henri/commit/fda9366e9ed2b072764a995c5aa60205ca7a4725), [`1a86acb`](https://github.com/usehenri/henri/commit/1a86acbf15e4a43e5fb81277bb22e101c06e77a4), [`808d824`](https://github.com/usehenri/henri/commit/808d82471d59e64ccc735f617bab293eb572c46b), [`0b32fbd`](https://github.com/usehenri/henri/commit/0b32fbde19c95da8fe07fab76933840a4242c71c), [`c0c16e8`](https://github.com/usehenri/henri/commit/c0c16e873ba440aee9832160553cbb12ab81bd2c), [`41470bf`](https://github.com/usehenri/henri/commit/41470bf378d83ca3d35d00e8c31796fea5eb15e0), [`8e44e7e`](https://github.com/usehenri/henri/commit/8e44e7e882dd8741b3ac632651b453389d76bf2c), [`de1c1e0`](https://github.com/usehenri/henri/commit/de1c1e02ed83d13dcfeb8e44012f309eb663f03e), [`4b4677d`](https://github.com/usehenri/henri/commit/4b4677d4a09d39fe50b1fa4af577600342578daf)]:
  - @usehenri/core@1.2.0
