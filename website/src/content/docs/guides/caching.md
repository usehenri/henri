---
title: Caching
description: henri.cache — get, set, delete and fetch, on this process's memory or on the backend config.shared already names, with one promise per key so a hundred concurrent misses run the function once.
sidebar:
  order: 11
---

A cache holds a copy of something that is true somewhere else. That single sentence is where everything on this page comes from: the copy has to be written down (so it is serialized, and not everything survives that), it can be missing (so nothing may depend on it being there), and it can be wrong (so somebody has to decide when it stops being worth keeping — and that somebody is you, not henri).

`henri.cache` is in every application, with nothing to install and nothing to configure:

```js
const board = await henri.cache.fetch(
  ['leaderboard', event.externalId],
  { ttl: '30s' },
  () => Score.top(event)
);
```

That is the call worth having. `get`, `set`, `delete` and `clear` are there too, but `fetch` is the one that reads like what you meant: answer from the cache, or run this and keep what it returned.

## Where it is kept

| Your application                                                     | Where the cache is                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------- |
| anything                                                             | this process's memory, bounded (1000 entries, 32mb, LRU) |
| [`config.shared`](/configuration/#the-shared-object) names a backend | that backend, in a key space of its own                  |
| `config.cache.store` names a module                                  | that store                                               |

The second row is the point: the block that already says where the rate limit, the sign-in lockout and the idempotency keys are counted is where the cache goes too. There is no second place to name a Redis.

```json
{
  "shared": { "adapter": "redis", "url": "redis://127.0.0.1:6379" }
}
```

```bash
npm install @usehenri/redis
```

The boot says which one it is, on every application:

```
info cache redis 5m default ttl, 256kb per entry
```

## `fetch`, and the stampede

A popular key expires and every request in flight misses it at the same moment. A `fetch` that answered "not there, so run it" to each of them would run the expensive thing a hundred times, at the worst possible moment. henri keeps one promise per key while the function runs and hands it to everyone who missed:

```js
// 100 requests, one query
await Promise.all(
  Array.from({ length: 100 }, () =>
    henri.cache.fetch('leaderboard', () => Score.top())
  )
);
```

Across processes the bound is the number of processes, and that is deliberate. Making it one everywhere needs a lock in the backend, which needs a lease, which means guessing how long the function may take: guess short and it runs twice anyway, guess long and one crashed process blocks every reader of that key until the lease expires. The single flight above costs nothing, never blocks a reader, and holds when the backend is down. The lock is what an application writes for the one key that needs it, over `set` and `delete`.

Two more things `fetch` does, both on purpose:

- **it caches `null`.** "There is no such record" is an answer, and it is the answer a cache is asked for again a millisecond later.
- **it caches nothing when the function throws.** An error is not an answer. The rejection reaches every caller that was waiting on it, and the next call is free to try again.

`{ force: true }` skips the read, runs the function and writes what it answered.

## What a value may be

The value crosses a serialization edge, so what comes back has to be what went in. What survives is JSON, plus `Date`:

```js
await henri.cache.set('memo', {
  count: 12,
  tags: ['a', 'b'],
  updatedAt: new Date(), // comes back a Date
  missing: null,
});
```

Everything else is refused, at `set`, with an error naming where it sat and what it was — never what it held:

```
the value.rows[0] is an instance of Memo, which the cache cannot store.
Store what you want back: record.toJSON(), or henri.model.stores.default.toPlain(record).
```

| Refused                                                                  | Why                                                                                 |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| a model instance, and every other class instance                         | it would come back a plain object, with none of its methods                         |
| `undefined`                                                              | it is what a miss answers: a stored one would be a hit nothing can tell from a miss |
| `NaN`, `Infinity`                                                        | JSON writes them `null`                                                             |
| a `Map`, a `Set`, a `Buffer`, a `RegExp`, a function, a symbol, a bigint | JSON has nowhere to put them                                                        |
| anything circular                                                        | there is no shape to write down                                                     |

A refusal is a programming mistake, so it throws ([`HENRI_CACHE_VALUE_UNSUPPORTED`](/reference/errors/#henri_cache_value_unsupported)). Two exceptions, both because they are about data rather than about code: an object key whose value is `undefined` is dropped, exactly as `JSON.stringify` and `res.json()` drop it, and a value bigger than `maxEntrySize` is not cached at all — `set` answers `false`, it is logged once, nothing is truncated, and whatever was under that key is forgotten rather than left to be served in place of what could not be written. Storing half a value that reads back as a whole one is the bug this exists to avoid.

## Keys

A key is a string, a number, a boolean, a `Date`, an array of them, a plain object, or anything with a `cacheKey()` method:

```js
henri.cache.get('settings');
henri.cache.get(['user', user.externalId, 'posts']); // user/<uuid>/posts
henri.cache.get({ page: 2, sort: 'name' }); // the keys sorted, so the order you wrote them in does not matter
```

Two features can want a key as ordinary as `recent`, so give each one a scope:

```js
const reports = henri.cache.scope('reports');

await reports.set('daily', rows); // reports:daily
await reports.clear(); // and nothing else is touched
```

A key longer than 250 characters keeps its front and ends with a digest of the whole, so it stays readable in a log and two callers of the same long key still meet.

## Expiry, and who invalidates

Every entry has a TTL. `config.cache.ttl` is the default (five minutes) and any call may say otherwise (`{ ttl: '30s' }`, `{ ttl: 3600000 }`). There is no way to write "forever": a cache with no expiry is a database with none of the guarantees, and the entry nobody remembers writing is the one that serves last month's price.

**henri invalidates nothing for you.** No model callback clears a key, no query is cached behind your back, no route is tied to a record. What henri gives you is `delete`, and where to call it is a decision about your data:

```js
await Memo.update({ id }, params);
await henri.cache.delete(['memo', id]);
```

With the memory backend that `delete` reaches one process. If your deployment runs several and invalidates keys, name a backend in `shared`: it is the difference between a stale page for one visitor in three and a cache that answers.

## When the backend is down

**A miss. Always**, whatever [`shared.onError`](/configuration/#when-the-backend-is-down) says. The three counters follow that switch because a guard that cannot count is not a guard; the cache is the opposite kind of thing — refusing a request because a copy is unavailable would turn an optimization into an outage.

- a read that fails is a miss, and `fetch` runs its function;
- a write that fails answers `false`;
- every one of them is logged, at most once every ten seconds, the way the counters' fallthroughs are.

`GET /readyz` says nothing about the cache, on purpose: a process whose cache is down still serves.

## Nothing personal by accident

Values never reach a log line, an error message or a `debug` line — the cache is handed whatever the application had, so the only thing it ever says about a value is its type. Keys do get logged, and a key is often built out of what a request carried, so a key matching [`filterParameters`](/configuration/#headers-logs-and-limits) is printed `[FILTERED]`, exactly as a parameter of that name is masked in a body:

```
warn cache [FILTERED] is 1.2mb, more than the 256kb of cache.maxEntrySize: not cached
```

## What it costs, and what it holds

```js
henri.cache.stats();
// { backend: 'memory', hits: 812, misses: 44, writes: 44, errors: 0,
//   evictions: 3, inflight: 0, entries: 41, bytes: 92416 }
```

`entries` and `bytes` are the memory backend's; they are `null` on any other. `evictions` climbing means the bounds are doing their job and the cache may be too small for what you are keeping in it.

These are also where the `henri.cache.operations` counter of [Telemetry](/guides/telemetry/#metrics) reads its values: an observable instrument, asked when something collects, so watching the hit rate costs nothing between collections.

## In tests

`@usehenri/testing` boots the application, so `henri.cache` is the real one. Clear it between tests that share a key:

```js
afterEach(() => henri.cache.clear());
```

`clear()` walks the key space, which is why it belongs in a teardown or a console rather than in a request. An application that would rather have no cache at all under test says so:

```json
{ "cache": false }
```

Every `fetch` then runs its function, and nothing else changes.

## What is not here

- **Fragment and page caching.** Handlebars renders synchronously and a cache lookup is asynchronous, so a `{{#cache}}` block would have to be a memory-only cache pretending to be the real one; Next.js and Vite own their own render pipelines and hand henri no fragment boundary to key on. Cache the data the page is built from — that is where the query was.
- **Query caching.** Nothing wraps your models. A framework that guesses when your data changed is wrong in a way you find out about in production.
- **HTTP caching.** henri already answers `ETag` and `Cache-Control`; that is a different cache, in the client, and it is not this one.
