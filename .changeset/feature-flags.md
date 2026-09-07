---
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/redis': minor
---

`henri.flags`: feature flags declared in one file, on for everyone, for a named set, for a stable share of them, or for a group the application writes in code.

`config/flags.js` is the declaration — `checkout: false` is a whole flag, and the long form adds `description`, `expose` and `group`. `await req.flag('checkout')` and `await henri.flags.enabled('checkout', user)` are the read; `henri flags`, `flags:on`, `flags:off`, `flags:percentage` and `flags:reset` are what an operator has. `flipper` is what this learns from: the gates and the `enable`/`disable` vocabulary are kept, `percentage_of_time` is not (a feature that flickers within one page load is a bug henri would have caused), and neither are the expression gates, the web UI or the metrics.

**A name nothing declares is a failure, not a `false`** — the position `req.permit()`, `params`, `answers` and `filters` already take. A typo that answers `false` forever is a feature that silently never ships; a typo that throws is a stack trace in development, in the suite, and on the first request that reaches it. Both messages name the closest declared flag, and the cost is stated out loud in the guide: removing a flag is two deploys.

**The percentage is stable and it is hashed carefully.** The bucket is `sha256(flag + actor)`, computed and never stored, so the same person keeps the same answer across processes and restarts and a rollout only ever adds people. The flag name is in the hash so two features at ten percent are not on for the same ten percent, and the identifier — the `externalId`, never the primary key — is hashed **whole**: a uuid v7 is time-ordered, so bucketing on any prefix of one would roll a feature out by signup date rather than at random.

**The state is where every process can read it.** `config.shared` when there is a backend, `.henri/flags.json` otherwise, this process's memory under `NODE_ENV=test`, and the boot line says which and says its limit. Reads come from an in-memory snapshot re-read on a timer (`flags.refresh`, ten seconds, which is the whole staleness window), not through `henri.cache` — a cache's answer to a backend that is down is a miss, and a miss here would revert every flag to its default mid-incident. **A store that cannot be read flips nothing**: the snapshot stands and it is reported at most once a minute.

`henri flags` boots to runlevel 2 and no further, so a kill switch can be flipped while the database is unreachable. There is **no HTTP surface** in any environment: an application that wants a page writes the controller and puts a policy on it.

New configuration key `flags` (`store`, `refresh`, `enabled`), four `HENRI_FLAGS_*` codes, and `@usehenri/redis` gains a key-value write with no expiry, for the state that must outlive a restart. See the new [Feature flags](https://usehenri.io/guides/feature-flags/) guide.
