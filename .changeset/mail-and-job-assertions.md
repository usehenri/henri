---
'@usehenri/testing': minor
---

An inbox and a queue a test can read: `inbox()` and `enqueued()`.

`@usehenri/testing` booted the application, bound supertest to it and made the records. What it had no answer for is the two things a Rails test asserts constantly: `assert_emails 1`, and then reading the message; and `assert_enqueued_with`. Until now an application testing "signing up sends the confirmation mail" had to reach into nodemailer, and one testing "this action enqueued that job" had to query `henri_jobs` itself.

```js
const { enqueued, inbox, request } = require('@usehenri/testing');

await request().post('/signup').send({ email: 'ada@example.com', password });

const [mail] = inbox();

expect(inbox()).toHaveLength(1);
expect(mail.to).toContain('ada@example.com');
expect(mail.subject).toBe('Confirm your address');
expect(mail.html).toContain('/confirm/');
```

Plain values rather than matchers, because the application's suite is its own Vitest: an array composes with `toHaveLength`, `find` and `filter`, and a matcher would have to be registered and would answer fewer questions. `inbox(filter)` narrows on `action`, `deferred`, `mailer`, `subject` and `to` -- a string compared, a regular expression tested -- and takes a predicate for everything else. A key the inbox does not hold is refused rather than ignored, because a filter that is silently dropped makes an assertion pass for the wrong reason.

**Both doors are watched.** A message leaves through `deliver()`, which hands the rendered payload to the transport, or through `deliverLater()`, which hands it to the delivery handler -- with `@usehenri/jobs` a queue row, sent later by a runner a test never starts. An inbox that watched one of them would answer differently depending on which packages are installed, so both are captured, `deferred` says which door it was, and a message the same payload goes out of band through is counted once and not twice. What a runner sends afterwards is a second entry, `deferred: false` this time, because two things really did happen.

**The inbox belongs to the application, not to the process.** It lives on the henri instance `setup()` booted, so a test worker that boots an application of its own reads its own mail, `teardown()` takes it away with the instance, and two applications in one process never see each other's messages. `@usehenri/testing/setup-file` empties it before every test, so nothing a test asserts on can come from the one before it.

`enqueued()` reads the queue back rather than intercepting anything: a row's `args` have been through JSON exactly as the runner will read them, and a job enqueued by a model hook three layers down is in it like any other. `pending` jobs by default, which is what "enqueued" means; `{ state: 'dead' }` reads the dead letter queue and `{ state: null }` everything the table holds. `clearJobs()` forgets them, and nothing calls it for you -- those are rows in the application's own database.

`@usehenri/jobs` stays optional: this package does not depend on it, and an application with no queue is told what to install (`HENRI_JOB_QUEUE_UNAVAILABLE`) rather than handed an empty list, since an assertion that passes because the feature is missing is worse than no helper at all.
