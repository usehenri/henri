// The controller ergonomics: before hooks loading a record and enforcing
// ownership, req.permit, flash messages across a redirect, implicit
// rendering, and the soft delete behind "withdraw".
const {
  createEvent,
  createProposal,
  createUser,
  inertiaVersion,
  page,
  request,
  reset,
  signIn,
} = require('./helpers');

const ABSTRACT =
  'A perfectly serviceable abstract, comfortably longer than the sixty characters the model insists on.';

describe('proposals', () => {
  let speaker;
  let other;
  let admin;
  let event;
  let closed;
  let track;

  beforeAll(async () => {
    await reset();
    await inertiaVersion();

    speaker = await createUser({
      email: 'author@example.test',
      name: 'Author',
    });
    other = await createUser({ email: 'other@example.test', name: 'Other' });
    admin = await createUser({
      email: 'committee@example.test',
      roles: ['speaker', 'admin'],
    });

    ({ event, track } = await createEvent({ name: 'Open Conf' }));
    ({ event: closed } = await createEvent({
      name: 'Closed Conf',
      state: 'closed',
    }));
  });

  describe('the public list', () => {
    beforeAll(async () => {
      await Proposal.withDeleted().destroy({ force: true });

      for (let index = 0; index < 15; index += 1) {
        await createProposal({
          eventId: event.id,
          speakerId: speaker.id,
          state: 'submitted',
          title: `A submitted proposal number ${index}`,
          trackId: track.id,
        });
      }

      await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        state: 'draft',
        title: 'A draft nobody should see',
      });
    });

    test('paginates and hides the drafts', async () => {
      const first = await page(request(), '/proposals');

      expect(first.status).toBe(200);
      expect(first.body.props.data.total).toBe(15);
      expect(first.body.props.data.perPage).toBe(12);
      expect(first.body.props.data.proposals).toHaveLength(12);
      expect(first.body.props.data.pages).toBe(2);

      const second = await page(request(), '/proposals?page=2');

      expect(second.body.props.data.proposals).toHaveLength(3);
      expect(
        second.body.props.data.proposals.map((entry) => entry.title)
      ).not.toContain('A draft nobody should see');
    });

    test('filters on a state', async () => {
      const answer = await page(request(), '/proposals?state=accepted');

      expect(answer.body.props.data.total).toBe(0);
    });

    test('never sends the speaker email to a page', async () => {
      const answer = await page(request(), '/proposals');
      const [first] = answer.body.props.data.proposals;

      expect(first.speaker).toEqual({
        company: null,
        id: speaker.id,
        name: 'Author',
      });
      expect(JSON.stringify(answer.body)).not.toContain('author@example.test');
    });
  });

  describe('before hooks', () => {
    test('a missing record is a 404 from the hook, not from the action', async () => {
      const answer = await request()
        .get('/proposals/999999')
        .set('Accept', 'application/json');

      expect(answer.status).toBe(404);
      expect(answer.body.message).toMatch(/No proposal/);
    });

    test('a draft is a 404 for everyone but its speaker and the committee', async () => {
      const draft = await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        state: 'draft',
        title: 'A draft of my own',
      });
      const anonymous = await request()
        .get(`/proposals/${draft.id}`)
        .set('Accept', 'application/json');

      expect(anonymous.status).toBe(404);

      const { browser } = await signIn(other);
      const stranger = await browser
        .get(`/proposals/${draft.id}`)
        .set('Accept', 'application/json');

      expect(stranger.status).toBe(404);

      const mine = await signIn(speaker);
      const owner = await page(mine.browser, `/proposals/${draft.id}`);

      expect(owner.status).toBe(200);
      expect(owner.body.props.data.editable).toBe(true);

      const committee = await signIn(admin);
      const reviewer = await page(committee.browser, `/proposals/${draft.id}`);

      expect(reviewer.status).toBe(200);
      expect(reviewer.body.props.data.editable).toBe(false);
    });

    test('an anonymous write is turned away before the action runs', async () => {
      const answer = await request()
        .post('/proposals')
        .set('Accept', 'application/json')
        .send({ abstract: ABSTRACT, eventId: event.id, title: 'Sneaking in' });

      expect(answer.status).toBe(401);
      expect(await Proposal.count({ title: 'Sneaking in' })).toBe(0);
    });

    test('editing somebody else’s proposal is a 403', async () => {
      // Submitted, so it is readable: an unreadable one would be a 404 from
      // the hook before, and never reach the ownership check
      const theirs = await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        state: 'submitted',
        title: 'Not yours to edit',
      });
      const { browser, csrf } = await signIn(other);
      const answer = await browser
        .patch(`/proposals/${theirs.id}`)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', csrf)
        .send({ title: 'Hijacked, obviously' });

      expect(answer.status).toBe(403);
      expect((await Proposal.findById(theirs.id)).title).toBe(
        'Not yours to edit'
      );
    });
  });

  describe('creating', () => {
    test('req.permit keeps the state and the speaker out of the request', async () => {
      const { browser, csrf } = await signIn(speaker);
      const answer = await browser
        .post('/proposals')
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', csrf)
        .send({
          abstract: ABSTRACT,
          eventId: event.id,
          speakerId: other.id,
          state: 'accepted',
          title: 'A proposal that tried to accept itself',
        });

      expect(answer.status).toBe(201);
      expect(answer.body.state).toBe('draft');
      expect(answer.body.speaker.id).toBe(speaker.id);
    });

    test('an invalid proposal answers 422 with one message per field', async () => {
      const { browser, csrf } = await signIn(speaker);
      const answer = await browser
        .post('/proposals')
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', csrf)
        .send({ abstract: 'too short', eventId: event.id, title: 'no' });

      expect(answer.status).toBe(422);
      expect(answer.body.data.errors).toMatchObject({
        abstract: expect.any(String),
        title: expect.any(String),
      });
    });

    test('an Inertia form gets the errors on the page it rendered', async () => {
      const { browser, csrf } = await signIn(speaker);
      const answer = await browser
        .post('/proposals')
        .set('X-Inertia', 'true')
        .set('X-CSRF-Token', csrf)
        .send({ abstract: 'too short', eventId: event.id, title: 'no' });

      expect(answer.status).toBe(200);
      expect(answer.body.component).toBe('proposals/new');
      expect(answer.body.props.errors.abstract).toEqual(expect.any(String));
    });
  });

  describe('the state transitions', () => {
    test('submitting moves the draft on and flashes across the redirect', async () => {
      const draft = await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        title: 'A draft ready to go',
      });
      const { browser, csrf } = await signIn(speaker);
      const answer = await browser
        .post(`/proposals/${draft.id}/submit`)
        .set('Accept', 'text/html')
        .set('X-CSRF-Token', csrf);

      expect(answer.status).toBe(302);
      expect(answer.headers.location).toBe(`/proposals/${draft.id}`);

      const reloaded = await Proposal.findById(draft.id);

      expect(reloaded.state).toBe('submitted');
      expect(reloaded.submittedAt).toBeInstanceOf(Date);

      // The message survives exactly one render
      const landing = await page(browser, `/proposals/${draft.id}`);

      expect(landing.body.props.flash.notice).toEqual([
        'Submitted. The committee will review it.',
      ]);

      const again = await page(browser, `/proposals/${draft.id}`);

      expect(again.body.props.flash).toEqual({});
    });

    test('submitting twice is a 409', async () => {
      const draft = await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        title: 'A draft submitted twice',
      });
      const { browser, csrf } = await signIn(speaker);

      await browser
        .post(`/proposals/${draft.id}/submit`)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', csrf);

      const answer = await browser
        .post(`/proposals/${draft.id}/submit`)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', csrf);

      expect(answer.status).toBe(409);
    });

    test('a closed call for papers refuses a submission', async () => {
      const draft = await createProposal({
        eventId: closed.id,
        speakerId: speaker.id,
        title: 'A draft for a closed edition',
      });
      const { browser, csrf } = await signIn(speaker);
      const answer = await browser
        .post(`/proposals/${draft.id}/submit`)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', csrf);

      expect(answer.status).toBe(409);
      expect((await Proposal.findById(draft.id)).state).toBe('draft');
    });

    test('a submitted proposal can no longer be edited', async () => {
      const submitted = await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        state: 'submitted',
        title: 'Already with the committee',
      });
      const { browser, csrf } = await signIn(speaker);
      const answer = await browser
        .patch(`/proposals/${submitted.id}`)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', csrf)
        .send({ title: 'A second thought about it' });

      expect(answer.status).toBe(409);
    });
  });

  describe('withdrawing (a soft delete)', () => {
    test('hides the row everywhere and keeps its reviews', async () => {
      const proposal = await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        state: 'submitted',
        title: 'A proposal about to be withdrawn',
      });

      await Review.create({
        comment: 'A review that must survive the withdrawal.',
        proposalId: proposal.id,
        reviewerId: admin.id,
        score: 1,
      });

      const { browser, csrf } = await signIn(speaker);
      const answer = await browser
        .post(`/proposals/${proposal.id}/withdraw`)
        .set('Accept', 'text/html')
        .set('X-CSRF-Token', csrf);

      expect(answer.status).toBe(302);
      expect(answer.headers.location).toBe('/proposals/mine');

      // Gone from every ordinary query
      expect(await Proposal.findById(proposal.id)).toBeNull();
      expect(await Proposal.count({ id: proposal.id })).toBe(0);

      const gone = await request()
        .get(`/proposals/${proposal.id}`)
        .set('Accept', 'application/json');

      expect(gone.status).toBe(404);

      // Still there, with its review
      const kept = await Proposal.withDeleted()
        .where({ id: proposal.id })
        .first();

      expect(kept.deletedAt).toBeInstanceOf(Date);
      expect(await Review.count({ proposalId: proposal.id })).toBe(1);
    });

    test('the committee sees it in the trash and puts it back', async () => {
      const proposal = await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        state: 'submitted',
        title: 'A proposal to restore',
      });
      const owner = await signIn(speaker);

      await owner.browser
        .post(`/proposals/${proposal.id}/withdraw`)
        .set('Accept', 'text/html')
        .set('X-CSRF-Token', owner.csrf);

      const { browser, csrf } = await signIn(admin);
      const trash = await page(browser, '/admin/proposals/withdrawn');

      expect(
        trash.body.props.data.proposals.map((entry) => entry.title)
      ).toContain('A proposal to restore');

      const answer = await browser
        .post(`/admin/proposals/${proposal.id}/restore`)
        .set('Accept', 'text/html')
        .set('X-CSRF-Token', csrf);

      expect(answer.status).toBe(302);
      expect(await Proposal.findById(proposal.id)).toBeTruthy();
    });
  });

  describe('implicit rendering', () => {
    test('an action that returns an object renders its own page with it', async () => {
      const answer = await page(request(), '/events');

      expect(answer.status).toBe(200);
      // An index action renders /<controller>, which resolves to
      // app/views/pages/events/index.jsx
      expect(answer.body.component).toBe('events');
      expect(answer.body.props.data.events).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Open Conf' })])
      );
    });

    test('a nested resource knows which parent it hangs under', async () => {
      const answer = await page(request(), `/events/${event.id}/tracks`);

      expect(answer.status).toBe(200);
      expect(answer.body.component).toBe('tracks/index');
      expect(answer.body.props.data.event.id).toBe(event.id);
      expect(answer.body.props.data.tracks).toHaveLength(1);
    });
  });

  describe('the committee', () => {
    test('reviews a proposal through the nested route and decides on it', async () => {
      const proposal = await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        state: 'submitted',
        title: 'A proposal to decide on',
      });
      const { browser, csrf } = await signIn(admin);
      const review = await browser
        .post(`/proposals/${proposal.id}/reviews`)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', csrf)
        .send({ comment: 'Worth a slot, and I would go.', score: 2 });

      expect(review.status).toBe(201);
      expect(review.body.reviewer.name).toBe('A Speaker');

      const twice = await browser
        .post(`/proposals/${proposal.id}/reviews`)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', csrf)
        .send({ comment: 'Changed my mind about it.', score: 1 });

      expect(twice.status).toBe(409);

      const decision = await browser
        .post(`/admin/proposals/${proposal.id}/decide`)
        .set('Accept', 'text/html')
        .set('X-CSRF-Token', csrf)
        .send({ state: 'accepted' });

      expect(decision.status).toBe(302);

      const decided = await Proposal.findById(proposal.id);

      expect(decided.state).toBe('accepted');
      expect(decided.decidedAt).toBeInstanceOf(Date);
    });

    test('refuses a decision that is not accepted or rejected', async () => {
      const proposal = await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        state: 'submitted',
        title: 'A proposal with a bad decision',
      });
      const { browser, csrf } = await signIn(admin);
      const answer = await browser
        .post(`/admin/proposals/${proposal.id}/decide`)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', csrf)
        .send({ state: 'maybe' });

      expect(answer.status).toBe(422);
      expect((await Proposal.findById(proposal.id)).state).toBe('submitted');
    });
  });
});
