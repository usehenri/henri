// Record-level authorization: app/policies/proposal.js and
// app/policies/review.js, and the three places henri asks them -- the route,
// the controller, and everything that leaves the server.
//
// The tests that matter here are the refusals. A signed-in speaker who is
// not the owner gets nothing; a page never carries a link to something the
// policy would refuse; and a policy that does not exist, does not answer, or
// throws, all mean the same thing.
const {
  create,
  inertiaVersion,
  page,
  request,
  reset,
  signIn,
} = require('./helpers');

const HAL = 'application/hal+json';

describe('policies', () => {
  let speaker;
  let other;
  let admin;
  let event;
  let draft;
  let submitted;

  beforeAll(async () => {
    await reset();
    await inertiaVersion();

    speaker = await create('user', {
      email: 'owner@policies.test',
      name: 'Owner',
    });
    other = await create('user', {
      email: 'other@policies.test',
      name: 'Other',
    });
    admin = await create('user', 'admin', {
      email: 'committee@policies.test',
    });

    event = await create('event', { name: 'Policy Conf' });

    draft = await create('proposal', {
      eventId: event.id,
      speakerId: speaker.id,
      title: 'A draft nobody else may read',
    });
    submitted = await create('proposal', 'submitted', {
      eventId: event.id,
      speakerId: speaker.id,
      title: 'A submitted proposal anybody may read',
    });
  });

  describe('henri.can is the one question', () => {
    test('the policy answers, and only a true is a yes', async () => {
      expect(await henri.can(speaker, 'update', draft)).toBe(true);
      expect(await henri.can(other, 'update', draft)).toBe(false);
      expect(await henri.can(null, 'update', draft)).toBe(false);
      // The committee reads a draft; it does not write one
      expect(await henri.can(admin, 'show', draft)).toBe(true);
      expect(await henri.can(admin, 'update', draft)).toBe(false);
    });

    test('a model with no policy refuses, whoever is asking', async () => {
      expect(henri.policies.has('event')).toBe(false);
      expect(await henri.can(admin, 'destroy', event)).toBe(false);
    });

    test('an action the policy does not mention refuses', async () => {
      expect(await henri.can(speaker, 'destroy', draft)).toBe(false);
    });

    test('a rule that needs a proposal is never asked without one', async () => {
      expect(await henri.can(speaker, 'update', null, 'proposal')).toBe(false);
      // ...while the rules that need none answer anywhere
      expect(await henri.can(speaker, 'create', null, 'proposal')).toBe(true);
      expect(await henri.can(null, 'create', null, 'proposal')).toBe(false);
    });

    test('a rule that throws is a refusal, never an allow', async () => {
      const policy = henri.policies.get('proposal');
      const original = policy.update;

      policy.update = () => {
        throw new Error('the policy is broken');
      };

      try {
        expect(await henri.can(speaker, 'update', draft)).toBe(false);
      } finally {
        policy.update = original;
      }
    });
  });

  describe('a proposal somebody else owns', () => {
    test('a draft is nothing at all to a stranger, not a 403', async () => {
      const { browser } = await signIn(other);
      const answer = await browser
        .get(`/proposals/${draft.externalId}`)
        .set('Accept', 'application/json');

      expect(answer.status).toBe(404);
      expect(answer.body.title).toBeUndefined();
    });

    test('a readable proposal that is not theirs cannot be written', async () => {
      const { browser, csrf } = await signIn(other);
      const answer = await browser
        .patch(`/proposals/${submitted.externalId}`)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', csrf)
        .send({ title: 'Hijacked, obviously' });

      expect(answer.status).toBe(403);
      expect((await Proposal.findByKey(submitted.id)).title).toBe(
        'A submitted proposal anybody may read'
      );
    });

    test('and neither can it be submitted or withdrawn', async () => {
      const { browser, csrf } = await signIn(other);

      for (const action of ['submit', 'withdraw']) {
        const answer = await browser
          .post(`/proposals/${draft.externalId}/${action}`)
          .set('Accept', 'application/json')
          .set('X-CSRF-Token', csrf);

        // The draft is not even readable by this user: it stops one hook
        // earlier, at the 404
        expect(answer.status).toBe(404);
      }

      expect(await Proposal.findByKey(draft.id)).not.toBeNull();
    });
  });

  describe('the gate on the route', () => {
    test('answers the collection actions before the controller runs', async () => {
      const anonymous = await request()
        .get('/proposals/new')
        .set('Accept', 'application/json');

      expect(anonymous.status).toBe(401);

      const html = await request()
        .get('/proposals/new')
        .set('Accept', 'text/html');

      expect(html.status).toBe(302);
      expect(html.headers.location).toBe('/login');
    });

    test('leaves the public list public', async () => {
      const answer = await request().get('/proposals').set('Accept', HAL);

      expect(answer.status).toBe(200);
      expect(answer.body._embedded.proposals.length).toBeGreaterThan(0);
    });

    test('composes with the role guard rather than replacing it', async () => {
      // The reviews resource carries both. The role answers first
      const { browser } = await signIn(other);
      const answer = await browser
        .get(`/proposals/${submitted.externalId}/reviews`)
        .set('Accept', 'application/json');

      expect(answer.status).toBe(403);
      expect(answer.body.error).toBe('Forbidden');

      const committee = await signIn(admin);
      const allowed = await committee.browser
        .get(`/proposals/${submitted.externalId}/reviews`)
        .set('Accept', HAL);

      expect(allowed.status).toBe(200);
    });
  });

  describe('what leaves the server', () => {
    test('_links never carry an action the policy would refuse', async () => {
      const mine = await signIn(speaker);
      const owner = await mine.browser
        .get(`/proposals/${submitted.externalId}`)
        .set('Accept', HAL);

      expect(owner.body._links.update).toBeTruthy();
      expect(owner.body._links.edit).toBeTruthy();

      const { browser } = await signIn(other);
      const stranger = await browser
        .get(`/proposals/${submitted.externalId}`)
        .set('Accept', HAL);

      expect(stranger.status).toBe(200);
      // Same record, same roles, different answer: this is the whole point
      expect(stranger.body._links.update).toBeUndefined();
      expect(stranger.body._links.edit).toBeUndefined();
      expect(stranger.body._links.self.href).toBe(
        `/proposals/${submitted.externalId}`
      );
    });

    test('a collection filters the links of every record it embeds', async () => {
      const { browser } = await signIn(other);
      const answer = await browser.get('/proposals').set('Accept', HAL);

      for (const item of answer.body._embedded.proposals) {
        expect(item._links.self).toBeTruthy();
        expect(item._links.update).toBeUndefined();
      }

      const mine = await signIn(speaker);
      const own = await mine.browser.get('/proposals').set('Accept', HAL);
      const found = own.body._embedded.proposals.find(
        (item) => item.externalId === submitted.externalId
      );

      expect(found._links.update).toBeTruthy();
    });

    test('the paths of a page lose what a record-less rule refuses', async () => {
      const anonymous = (await page(request(), '/')).body.props.paths;

      // A visitor with no account cannot write a proposal, so the page is
      // never given the link to the form
      expect(anonymous.new_proposals_path).toBeUndefined();
      expect(anonymous.create_proposals_path).toBeUndefined();
      // Reading is public, and a rule that needs the record is answered on
      // the record's own _links rather than here
      expect(anonymous.index_proposals_path).toBeTruthy();
      expect(anonymous.show_proposals_path).toBeTruthy();

      const { browser } = await signIn(speaker);
      const signedIn = (await page(browser, '/')).body.props.paths;

      expect(signedIn.new_proposals_path).toBeTruthy();
      expect(signedIn.create_proposals_path).toBeTruthy();
    });
  });

  describe('scoping a list', () => {
    test('the policy says which proposals are a speaker s own', async () => {
      expect(await henri.policies.scope(speaker, 'proposal')).toEqual({
        speakerId: speaker.id,
      });

      const { browser } = await signIn(other);
      const answer = await page(browser, '/proposals/mine');

      expect(answer.status).toBe(200);
      expect(answer.body.props.data.proposals).toEqual([]);

      const mine = await signIn(speaker);
      const own = await page(mine.browser, '/proposals/mine');

      expect(
        own.body.props.data.proposals.map((one) => one.title).sort()
      ).toEqual([
        'A draft nobody else may read',
        'A submitted proposal anybody may read',
      ]);
    });
  });
});
