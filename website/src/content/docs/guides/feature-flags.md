---
title: Feature flags
description: 'Feature flags declared in one file: on for everyone, for a named set, for a stable share of them, or for a group the application describes in code.'
sidebar:
  order: 11
---

A feature flag is a switch you can move without a deploy. henri's are declared in one file, kept somewhere every process can read, and asked about through `req.flag()` or `henri.flags.enabled()`.

```js
// config/flags.js
module.exports = {
  checkout: false,
};
```

```js
// app/controllers/orders.js
module.exports = {
  show: async (req, res) => {
    if (await req.flag('checkout')) {
      return res.render('/orders/checkout', { data: {} });
    }

    return res.render('/orders/show', { data: {} });
  },
};
```

```bash
henri flags              # every flag, what it answers and what moved it
henri flags:on checkout  # on for everyone, without a deploy
```

Nothing has to be installed and nothing has to be configured: `henri.flags` is in every application, the state goes in `.henri/flags.json` until you say otherwise, and an application with no `config/flags.js` never loads any of it.

## Declaring one

`config/flags.js` exports an object, one key per flag. The short form is the name and what it answers before anybody touches it:

```js
module.exports = {
  checkout: false,
  'legacy-editor': true,
};
```

The long form says more about the same flag:

```js
module.exports = {
  newEditor: {
    // what it answers until somebody flips it
    default: false,
    // what it is for, printed by `henri flags`
    description: 'The rewritten proposal editor',
    // reaches a rendered page as `flags.newEditor`; without this it does not
    expose: true,
    // asked last, and only a `true` opens it
    group: (user) => Boolean(user) && user.roles.includes('staff'),
  },
};
```

A name is letters and digits with a single `-`, `_` or `.` between them (`checkout`, `new-editor`, `billing.v2`). Anything else, a `default` that is not a boolean, a `group` that is not a function — each fails the boot naming the flag (`HENRI_FLAGS_DECLARATION_INVALID`), rather than answering something surprising six months later.

### A name nothing declares is a failure

This is the one decision worth arguing, because most flag libraries go the other way: in `flipper` any name becomes a flag the moment you enable it. henri refuses it, on both sides.

```js
await req.flag('chekout');
// HENRI_FLAGS_UNKNOWN: henri.flags.enabled() asked for "chekout", which is
// not a declared flag -- did you mean "checkout"?
```

```bash
henri flags:on chekout
# exits 2, with the same near miss
```

The reason is that the two failure modes are not equally bad. A typo that answers `false` forever is a feature that silently never ships and gives nobody a reason to look; a typo that throws is a stack trace in development, in the test suite, and on the first request that reaches it in production. The loud one is cheaper to own. It is the position `req.permit()`, `params`, `answers` and `filters` already take — what is not declared does not happen — and it is what keeps the list of flags an application has readable, in one file, in the repository, in a diff somebody reviewed.

The cost is real and worth stating: **removing a flag is two deploys.** Stop reading it, ship that, then take it out of `config/flags.js`. Undeclaring it while code still asks is a 500, exactly as deleting a route while a link still points at it is a 404. henri cannot check the names at boot, because they live in the code rather than in a file it reads, so the check is at the call.

## Who a flag is on for

The state henri keeps per flag is three things — a switch, a set of actors and a percentage — and the declaration adds a fourth, the group. They are a union, asked in this order, first `true` wins:

| #   | Gate            | On when                                                                            |
| --- | --------------- | ---------------------------------------------------------------------------------- |
| 1   | the switch      | `henri flags:on <name>` was run                                                    |
| 2   | the named set   | this actor is in it                                                                |
| 3   | the percentage  | this actor's bucket is under it                                                    |
| 4   | the kill switch | never — `henri flags:off <name>` was run, and the group below cannot argue with it |
| 5   | the group       | the declared function answered `true`                                              |
| 6   | the default     | the declaration says so                                                            |

```bash
henri flags:on checkout                       # everyone
henri flags:on checkout 018f0000-…-000000000000   # one person
henri flags:percentage checkout 25            # a quarter of the actors
henri flags:off checkout                      # nobody
henri flags:reset checkout                    # back to the declared default
```

**`flags:off` is a reset.** It writes the `false` _and_ clears the named set and the percentage, the way flipper's `disable` does. During an incident "turn it off" has to mean off, not "off except for the forty people somebody added in March". Adding an actor afterwards is a new decision and works, because the reset already happened.

`flags:reset` is the other one: it forgets every flip, so the declared default answers again and the group is asked again. A flag whose `default` is `true` is switchable — `flags:off` writes an explicit `false` — which is what makes a flag protecting a rollback path usable.

### The actor

An actor is **a record carrying an `externalId`, or that identifier itself**:

```js
await henri.flags.enabled('checkout', req.user);
await henri.flags.enabled('checkout', '018f0000-0000-7000-8000-000000000000');
await henri.flags.enabled('checkout', account); // anything with an externalId
await henri.flags.enabled('checkout'); // nobody in particular
```

A primary key is refused (`HENRI_FLAGS_ACTOR_INVALID`). It never leaves the server anywhere else in henri — `Model.findById()` will not even take one — and a flag store full of them would be the one place it did. Without an actor only the switch and the group can answer yes: a percentage has nobody to bucket, so it stays closed rather than flipping a coin.

The actor does not have to be a person. A tenant, an account, a workspace — anything with a stable public identifier is one, and a plain string is taken as given.

### The percentage, and why it is stable

A percentage rollout is only useful if the same person gets the same answer on every request, on every process, after every restart. So the bucket is **computed and never stored**: `sha256(flag + actor)`, the first four bytes as a fraction, on when it lands under the percentage. Raising 10% to 25% only ever adds people; lowering it only ever removes them.

Two details are load-bearing, and the second is the one that is easy to get wrong.

**The flag name is in the hash.** Without it, every flag at ten percent would be on for exactly the same ten percent of people — one cohort receiving every experiment the application ever runs, which is both a bad sample and a bad time for them.

**The identifier is hashed whole.** `externalId` is a uuid v7, and a uuid v7 is _time-ordered_: its leading bits are the millisecond it was minted in. Bucketing on any prefix of it — the first hex characters, a cheap checksum of the head — would roll the feature out **by signup date**. The first cohort would be everybody who arrived in one window, which is the population least like the average user and the one already most tolerant of breakage; you would ship on evidence gathered from the wrong people. A full sha256 destroys that order, and the suite proves it by bucketing ten thousand identifiers minted in sequence and checking every tenth of the sequence, not only the total.

### The group

The group is a function in the declaration, asked last and only for a `true`:

```js
staffTools: {
  default: false,
  group: (user) => Boolean(user) && user.roles.includes('staff'),
},
```

It gets the actor as it was passed in — the record, so it can read whatever it needs — and it is the escape hatch for "on for this kind of person" that a named set cannot express. A group that throws is not a yes: henri logs it and falls back to the declared default. A truthy value is not a yes either, for the reason [policies](/guides/policies/) give: `user.roles.find(...)` returns a string, and only `=== true` opens a gate.

The group does **not** get the request. A flag is a question about _who_, and a rule that reads the request — this path, this header, this record — is a policy in disguise; henri has [a policy layer](/guides/policies/) for that, with a record, a scope and a refusal that answers the right status.

## Reading one

```js
await henri.flags.enabled('checkout', user); // anywhere
await req.flag('checkout'); // the same, with req.user filled in
```

Reading is not a round trip. Every process holds the whole state in memory and re-reads it on a timer, so a flag read costs a `Map` lookup and a hash. The staleness window is `config.flags.refresh` — ten seconds by default: a flip reaches every other process within it, and the process that flipped it sees it at once.

`henri.cache` would have been the other way to do this and is deliberately not used. A cache's answer to a backend that is down is a miss, and a miss here would silently revert every flag to its declared default in the middle of the incident you flipped it for. This is the rule the whole module is built around: **a store that cannot be read flips nothing.** A failed poll keeps the snapshot it has and says so at most once a minute. Flags stop moving while a backend is down; they never move back.

### In a page

A flag reaches a rendered page only when its declaration says `expose: true`:

```js
newBanner: { default: false, expose: true },
```

```jsx
export default function Home({ flags }) {
  return flags.newBanner ? <Banner /> : null;
}
```

The view options carry `flags` as `{ [name]: boolean }`, resolved for the signed-in user, next to `paths` and `user`. It is absent when nothing is exposed — a key that is always there and usually empty is a key every page learns to ignore.

The default is not `expose` for a reason: the names of the features an application has not shipped yet are not something every response should carry to every browser. A controller that needs an unexposed flag asks for it by name and puts the answer in its own data.

## Where the state lives

| `config.flags.store` | What it is                                                          | The limit                                                |
| -------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `"shared"`           | the backend of [`config.shared`](/configuration/#the-shared-object) | none: every process, every machine                       |
| a path               | a JSON file (`.henri/flags.json`)                                   | one machine                                              |
| `"memory"`           | this process                                                        | `henri flags:on` reaches nothing that is already running |

Unset means `"shared"` when there is a backend, the file otherwise, and `"memory"` under `NODE_ENV=test` — a test run boots many applications at once and they must not share one switch.

Whichever it is, **the boot line says so and says its limit**:

```
flags  redis  4 declared, shared with every process
flags  file   4 declared, /srv/app/.henri/flags.json, this machine only
flags  memory 4 declared, this process only
```

A file is the default without `config.shared` because `henri flags:on` in one terminal reaching the `henri server` in the next one is the point of the command; memory would make it a command that reports success and does nothing, so henri warns about that one in production. On the shared backend the state is one key per flag with no expiry — two operators flipping two different flags in the same second both land, and two flipping the same one is last-writer-wins, which is what a switch should do.

`henri clean` empties `.henri`, so a flag file goes with it. That is the right relationship for a development machine and the reason a deployment that cares names `config.shared`.

## The command line

```bash
henri flags                                   # the table
henri flags --all                             # ... with the identifiers of every named set
henri flags:on <name> [<actor>]
henri flags:off <name> [<actor>]
henri flags:percentage <name> <0-100>
henri flags:reset <name>
```

Every one takes `--json`. `henri flags` boots to **runlevel 2** and no further: no models, no routes, no port. That is deliberate — the reason somebody reaches for a kill switch is often that something else is broken, so turning a feature off must not require the database to be up.

The actor of `:on` and `:off` is a public identifier, never an email address: looking one up would need the models, which would need the database, which is what this command is built not to need. The identifier is already in your logs and in the JSON your API answers.

## Testing one

Under `NODE_ENV=test` the state is this process's memory, so a test flips a flag and nothing else in the run sees it:

```js
const { henri } = require('@usehenri/testing');

test('the new checkout is behind a flag', async () => {
  await henri().flags.enable('checkout');

  const answer = await request().get('/orders/1');

  expect(answer.text).toContain('New checkout');
  await henri().flags.reset('checkout');
});
```

`enable`, `disable`, `percentage` and `reset` all take effect at once in the process that called them, so there is nothing to wait for. `henri.flags.refresh()` is there for a test that wrote the store from somewhere else.

## What this is not

Three things this deliberately does not do, and why:

- **Not a permission system.** A flag says whether a feature exists for somebody; it never says whether they are allowed to do something. The two look alike for exactly as long as it takes for the first one to be flipped on for everybody and the second one to become a hole. Authorization is [policies](/guides/policies/), which take a record, fail closed, filter the links out of an answer and refuse with the right status.
- **Not an A/B testing platform.** There is no event stream, no exposure log, no conversion metric, no significance test. The percentage gate is a rollout — a way to ship to some people first and find out whether the error rate moves — and a flag surface that also measures is a different product, with its own storage, its own retention and its own privacy story. Point your analytics at the answer if you want one; henri records nothing about who saw what.
- **Not a configuration store.** A flag is a boolean and there is no way to make it anything else. A timeout, a limit, a feature's copy, a list of allowed domains all belong in [the configuration](/configuration/), which is validated at boot, typed, and read from a file somebody reviewed. A key-value store that answers arbitrary values, flipped from a shell, with no schema, is how an application ends up with its behaviour spread across a Redis nobody can diff.

There is also **no HTTP surface**: henri mounts no route for flags, in any environment. A flag flipped from a shell is an operator, which henri already has a shape for; a flag flipped from a request is an authorization question, and answering it would mean inventing a policy for something that is not a record. An application that wants a page writes the controller, puts a policy on it and calls `henri.flags.enable()` — four lines, and the authorization question stays where the application can answer it.

## Configuration

```json
{
  "flags": {
    "store": "shared",
    "refresh": "10s"
  }
}
```

See the [configuration reference](/configuration/#the-flags-object) for what each key does, and [Error codes](/reference/errors/) for the four failures this raises.
