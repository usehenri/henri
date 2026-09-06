// Retention and the access trail, against the real application.
//
// The rules are read from the models at boot (`henri.retention`), so this
// file is also what keeps them honest: a rule added to a model without its
// token in `config/test.json` fails here, which is exactly what would happen
// in production -- a rule nobody approved writes nothing.
//
// A sweep takes a `now`, and that is what these tests move rather than
// backdating rows: `createdAt` is the adapter's to write, so "two hundred
// days from now" is the only way to say "later" without lying to the
// database about when a record was written.
const { create, request, reset, signIn } = require('./helpers');

/** A moment, that many days ago */
const ago = (days) => new Date(Date.now() - days * 86400000);

/** A moment, that many days from now: where a sweep is run from */
const later = (days) => new Date(Date.now() + days * 86400000);

/** The rule of one model, as `henri retention` prints it */
const ruleOf = (model, name = 'default') =>
  henri.retention
    .describe()
    .rules.find((rule) => rule.model === model && rule.rule === name);

/**
 * Runs a sweep with a setting of its own, and puts the settings back
 *
 * @param {object} overrides What to change (`batch`, `approved`)
 * @param {object} options The options of the sweep
 * @returns {Promise<object>} The receipt
 */
const sweepWith = async (overrides, options) => {
  const settings = henri.retention.settings;

  henri.retention.settings = { ...settings, ...overrides };

  try {
    return await henri.retention.sweep(options);
  } finally {
    henri.retention.settings = settings;
  }
};

describe('retention', () => {
  beforeEach(async () => {
    await reset();
  });

  describe('the rules', () => {
    test('are what the models said', () => {
      const { rules } = henri.retention.describe();

      expect(rules.map((rule) => `${rule.model}:${rule.rule}`).sort()).toEqual([
        'Proposal:decided',
        'Proposal:drafts',
        'Review:default',
      ]);

      // A decided proposal goes into the trash two years after the
      // decision, not two years after it was written
      expect(ruleOf('Proposal', 'decided')).toMatchObject({
        action: 'soft-delete',
        after: 63072000000,
        from: 'decidedAt',
      });
      // A draft nobody submitted is a different class of record, with a
      // clock and a verb of its own
      expect(ruleOf('Proposal', 'drafts')).toMatchObject({
        action: 'delete',
        from: 'createdAt',
        where: { state: 'draft' },
      });
      // The reviewer's words go; the score and the row stay
      expect(ruleOf('Review')).toMatchObject({
        action: 'anonymize',
        after: 63072000000,
      });
    });

    test('are all approved in this environment, and say so', () => {
      for (const rule of henri.retention.describe().rules) {
        expect(rule.approved).toBe(true);
        expect(rule.token).toMatch(/^\w+:\w+:[0-9a-f]{12}$/u);
      }
    });

    test('nothing runs the sweep here, and the module says so', () => {
      // The showcase does not depend on @usehenri/jobs: the boot line names
      // the command a cron entry would run instead
      expect(henri.retention.schedule()).toMatch(
        /henri retention:sweep --yes/u
      );
    });
  });

  describe('a sweep', () => {
    /**
     * A speaker, an edition, three proposals and one review
     *
     * @returns {Promise<object>} What was created
     */
    const conference = async () => {
      const speaker = await create('user');
      const reviewer = await create('user', 'admin');
      const event = await create('event');
      const track = await create('track', { eventId: event.id });
      const draft = await create('proposal', {
        eventId: event.id,
        speakerId: speaker.id,
        title: 'A draft nobody ever submitted',
      });
      const decided = await create('proposal', 'accepted', {
        decidedAt: ago(800),
        eventId: event.id,
        speakerId: speaker.id,
        title: 'A talk the committee decided on',
        trackId: track.id,
      });
      const recent = await create('proposal', 'accepted', {
        decidedAt: ago(10),
        eventId: event.id,
        speakerId: speaker.id,
        title: 'A talk decided on last week',
        trackId: track.id,
      });
      const review = await create('review', {
        proposalId: decided.id,
        reviewerId: reviewer.id,
      });

      return { decided, draft, recent, review, speaker };
    };

    test('says what it would do, and writes nothing', async () => {
      const { draft } = await conference();
      const receipt = await henri.retention.sweep({
        dryRun: true,
        now: later(200),
      });

      expect(receipt.dryRun).toBe(true);

      const drafts = receipt.rules.find((rule) => rule.rule === 'drafts');

      expect(drafts.would).toBe(1);
      expect(drafts.written).toBe(0);
      expect(drafts.skipped).toBe('dry run');

      // Nothing moved
      expect(await Proposal.findByKey(draft.id)).not.toBeNull();
      expect(receipt.file).toBeNull();
    });

    test('deletes what it deletes, and hides what it hides', async () => {
      const { decided, draft, recent } = await conference();
      const receipt = await henri.retention.sweep({ now: later(200) });
      const rule = (name) => receipt.rules.find((one) => one.rule === name);

      expect(rule('drafts').written).toBe(1);
      expect(rule('decided').written).toBe(1);
      // The review is two hundred days old, and it is kept for two years
      expect(rule('default').written).toBe(0);

      // The draft is gone for good
      expect(await Proposal.withDeleted().where({ id: draft.id }).count()).toBe(
        0
      );
      // The decided one is in the trash, and an admin can bring it back
      expect(await Proposal.findByKey(decided.id)).toBeNull();
      expect(
        await Proposal.withDeleted().where({ id: decided.id }).count()
      ).toBe(1);
      // The one decided last week was not touched
      expect(await Proposal.findByKey(recent.id)).not.toBeNull();
    });

    test('anonymizes the reviewer, and keeps the committee record', async () => {
      const { review } = await conference();
      const receipt = await henri.retention.sweep({
        now: later(800),
        only: 'Review',
      });

      expect(receipt.rules).toHaveLength(1);
      expect(receipt.rules[0].written).toBe(1);
      expect(receipt.rules[0].fields).toEqual(['comment']);

      const kept = await Review.findByKey(review.id);

      // The score and the row are the committee's record of a decision
      expect(kept.score).toBe(2);
      expect(kept.comment).not.toContain('careful');
    });

    test('leaves a receipt that names no record', async () => {
      await conference();

      const receipt = await henri.retention.sweep({ now: later(800) });

      expect(receipt.file).toMatch(/^\.tmp\/privacy\/retention-/u);

      const document = JSON.stringify(receipt);

      // A sample of public identifiers, and nothing a person wrote
      expect(document).not.toContain('careful and quite specific');
      expect(document).not.toContain('nobody ever submitted');
      expect(receipt.rules.every((rule) => rule.sample.length <= 20)).toBe(
        true
      );
    });

    test('takes what a bounded run left for the next one', async () => {
      const speaker = await create('user');
      const event = await create('event');

      for (let index = 0; index < 3; index += 1) {
        await create('proposal', {
          eventId: event.id,
          speakerId: speaker.id,
          title: `A draft nobody submitted, number ${index}`,
        });
      }

      const first = await sweepWith(
        { batch: 2 },
        { now: later(200), only: 'Proposal:drafts' }
      );

      expect(first.rules[0].matched).toBe(3);
      expect(first.rules[0].written).toBe(2);
      expect(first.rules[0].remaining).toBe(1);

      const second = await sweepWith(
        { batch: 2 },
        { now: later(200), only: 'Proposal:drafts' }
      );

      expect(second.rules[0].written).toBe(1);
      expect(second.rules[0].remaining).toBe(0);
    });

    test('a rule nobody approved writes nothing, whatever else happens', async () => {
      await conference();

      const receipt = await sweepWith({ approved: [] }, { now: later(800) });

      expect(receipt.pending).toBe(3);
      expect(
        receipt.rules.every((rule) => rule.skipped === 'not approved')
      ).toBe(true);
      expect(receipt.rules.every((rule) => rule.written === 0)).toBe(true);
      // And it still says how much it would have taken
      expect(
        receipt.rules.reduce((total, rule) => total + rule.would, 0)
      ).toBeGreaterThan(0);

      expect(await Proposal.withDeleted().where({}).count()).toBe(3);
    });

    test('a record whose clock never started is counted, not swept', async () => {
      // Submitted, never decided: `decidedAt` is null, so the two-year
      // clock of the `decided` rule has not started
      await create('proposal', 'submitted', {
        submittedAt: ago(900),
        title: 'A talk still waiting for an answer',
      });

      const plan = await henri.retention.plan({
        now: later(800),
        only: 'Proposal:decided',
      });

      expect(plan.steps[0].matched).toBe(0);
      expect(plan.steps[0].waiting).toBe(1);
    });
  });
});

describe('the access trail', () => {
  beforeEach(async () => {
    await reset();
    // The trail is the one table `reset()` leaves alone -- it is
    // append-only, and nothing in the application deletes from it -- so
    // this file empties it itself to count from a known place
    await henri.model.getStore('default').query('DELETE FROM henri_trail');
  });

  test('is on, and it is a table henri owns', () => {
    expect(henri.trail.enabled).toBe(true);
    expect(henri.trail.settings.table).toBe('henri_trail');
    // Reads are off here, as they are everywhere until an application asks:
    // every recorded read is a round trip and an insert on the request path
    expect(henri.trail.settings.reads).toBe(false);
  });

  test('records a sweep, one entry per rule', async () => {
    await create('proposal', { title: 'A draft nobody ever submitted' });

    const before = await henri.trail.count({ action: 'retention.sweep' });

    await henri.retention.sweep({ now: later(200) });

    expect(await henri.trail.count({ action: 'retention.sweep' })).toBe(
      before + 3
    );

    const entries = await henri.trail.list({ action: 'retention.sweep' });
    const drafts = entries.find((entry) => entry.meta.rule === 'drafts');

    expect(drafts.model).toBe('Proposal');
    expect(drafts.records).toBe(1);
    expect(drafts.meta.action).toBe('delete');
    expect(drafts.ids).toHaveLength(1);
  });

  test('answers "prove the erasure happened" from an address alone', async () => {
    const speaker = await create('user', { email: 'erased@example.test' });

    await create('proposal', {
      speakerId: speaker.id,
      title: 'A talk that survives its speaker',
    });

    await henri.privacy.export('erased@example.test');
    await henri.privacy.erase('erased@example.test');

    const about = await henri.trail.about('erased@example.test');

    expect(about.map((entry) => entry.action)).toEqual([
      'privacy.erase',
      'privacy.export',
    ]);
    // The address is not in the table: its digest is
    expect(JSON.stringify(about)).not.toContain('erased@example.test');
    expect(about[0].subjectDigest).toEqual(expect.any(String));
  });

  test('records the reads that leave through an answer', async () => {
    const speaker = await create('user');
    const proposal = await create('proposal', 'submitted', {
      speakerId: speaker.id,
      title: 'A talk somebody will read about',
    });
    const { browser } = await signIn(speaker);
    const before = await henri.trail.count({ action: 'record.read' });

    henri.trail.settings = { ...henri.trail.settings, reads: 'personal' };

    let answer;

    try {
      answer = await browser
        .get(`/proposals/${proposal.externalId}`)
        .set('Accept', 'application/json');
    } finally {
      henri.trail.settings = { ...henri.trail.settings, reads: false };
    }

    expect(answer.status).toBe(200);
    expect(await henri.trail.count({ action: 'record.read' })).toBe(before + 1);

    const [entry] = await henri.trail.list({ action: 'record.read' });

    expect(entry.source).toBe('http');
    // The answer is a presentation of the proposal, which carries no model;
    // `subject` is where the record itself is
    expect(entry.model).toBe('Proposal');
    expect(entry.records).toBe(1);
    expect(entry.ids).toEqual([proposal.externalId]);
    expect(entry.actor).toBe(speaker.externalId);
    expect(entry.route).toMatch(/^GET /u);
    // Names and identifiers, never a value
    expect(JSON.stringify(entry)).not.toContain('A talk somebody will read');
  });

  test('records nothing for an answer that carries no record', async () => {
    const before = await henri.trail.count({});
    const answer = await request().get('/livez');

    expect(answer.status).toBe(200);
    expect(await henri.trail.count({})).toBe(before);
  });

  test('refuses to become a second copy of what it protects', async () => {
    await expect(
      henri.trail.record({ action: 'app.thing', meta: { name: 'Ada' } })
    ).rejects.toThrow(/marked personal/u);
    await expect(
      henri.trail.record({
        action: 'app.thing',
        meta: { who: 'ada@example.test' },
      })
    ).rejects.toThrow(/email address/u);
  });

  test('the chain of this application holds', async () => {
    await henri.trail.record({ action: 'app.one', records: 1 });
    await henri.trail.record({ action: 'app.two', records: 2 });

    const result = await henri.trail.verify();

    expect(result.ok).toBe(true);
    expect(result.entries).toBeGreaterThan(0);
    expect(result.broken).toBeNull();
  });

  test('an edited row is caught', async () => {
    const entry = await henri.trail.record({
      action: 'app.tampered',
      records: 1,
    });
    const store = henri.model.getStore('default');

    await store.query('UPDATE henri_trail SET records = $1 WHERE id = $2', [
      99,
      entry.id,
    ]);

    const result = await henri.trail.verify();

    expect(result.ok).toBe(false);
    expect(result.broken).toMatchObject({ reason: 'hash', seq: entry.seq });

    // Put it back, so the rest of the suite still verifies
    await store.query('UPDATE henri_trail SET records = $1 WHERE id = $2', [
      1,
      entry.id,
    ]);
    expect((await henri.trail.verify()).ok).toBe(true);
  });
});
