// Personal data: what the models marked, what never leaves the server, and
// the two operations a speaker may ask for.
//
// The map is read from the models at boot (`henri.privacy`), so this file is
// also what keeps the marks honest: a field added to User without a
// `personal` is a failure here, and `henri audit` reports it too.
const {
  PASSWORD,
  createEvent,
  createProposal,
  createUser,
  inertiaVersion,
  page,
  request,
  reset,
  signIn,
} = require('./helpers');

describe('personal data', () => {
  beforeAll(async () => {
    await inertiaVersion();
  });

  beforeEach(async () => {
    await reset();
  });

  describe('the map', () => {
    test('is what the models said', () => {
      const described = henri.privacy.describe();

      expect(described.subject).toBe('User');
      expect(described.models.map((entry) => entry.model).sort()).toEqual([
        'Proposal',
        'Review',
        'User',
      ]);

      const user = described.models.find((entry) => entry.model === 'User');

      expect(user.subject).toBe(true);
      expect(user.fields.map((field) => field.name)).toEqual([
        'bio',
        'company',
        'email',
        'name',
        'password',
        'phone',
      ]);

      // A proposal is the speaker's, through the column that points at them
      expect(
        described.models.find((entry) => entry.model === 'Proposal')
      ).toMatchObject({
        link: { declared: false, field: 'speakerId', required: true },
        onErase: 'anonymize',
      });
      // A review is the reviewer's, not the speaker's
      expect(
        described.models.find((entry) => entry.model === 'Review')
      ).toMatchObject({ link: { field: 'reviewerId' } });
    });

    test('the phone is the one field that never leaves the server', () => {
      expect(described().private).toEqual(['password', 'phone']);
      expect([...henri.privacy.keys].sort()).toEqual([
        'bio',
        'comment',
        'company',
        'email',
        'name',
        'password',
        'phone',
      ]);
    });

    /**
     * The map, as data
     *
     * @returns {object} What henri.privacy.describe() answers
     */
    function described() {
      return henri.privacy.describe();
    }
  });

  describe('what leaves the server', () => {
    test('the account page carries the phone, because it asked for it', async () => {
      const speaker = await createUser({
        name: 'Ada Okonjo',
        phone: '+1-555-0100',
      });
      const { browser } = await signIn(speaker);
      const res = await page(browser, '/account');

      expect(res.status).toBe(200);
      expect(res.body.props.data.account).toMatchObject({
        name: 'Ada Okonjo',
        phone: '+1-555-0100',
      });
    });

    test('no other answer carries it, whoever is asking', async () => {
      const speaker = await createUser({
        name: 'Bruno Sato',
        phone: '+1-555-0101',
      });
      const admin = await createUser({ roles: ['speaker', 'admin'] });
      const { event, track } = await createEvent();

      await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        state: 'submitted',
        trackId: track.id,
      });

      const { browser } = await signIn(admin);
      const list = await page(browser, '/admin/users');
      const programme = await request()
        .get('/proposals')
        .set('Accept', 'application/json');

      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toContain('555-0101');
      expect(programme.status).toBe(200);
      expect(JSON.stringify(programme.body)).not.toContain('555-0101');

      // Not because the controllers pick their fields, but because henri
      // drops the name from anything it serializes
      expect(henri.privacy.strip(speaker.toJSON())).toMatchObject({
        name: 'Bruno Sato',
      });
      expect(henri.privacy.strip(speaker.toJSON()).phone).toBeUndefined();
    });

    test('the signed-in user of every page has no phone either', async () => {
      const speaker = await createUser({ phone: '+1-555-0102' });
      const { browser } = await signIn(speaker);
      const res = await page(browser, '/proposals/mine');

      expect(res.status).toBe(200);
      expect(res.body.props.user).toMatchObject({ email: speaker.email });
      expect(res.body.props.user.phone).toBeUndefined();
    });
  });

  describe('henri privacy:export', () => {
    test('hands back everything held about one person', async () => {
      const speaker = await createUser({
        bio: 'Runs the platform team.',
        company: 'Kestrel',
        name: 'Ada Okonjo',
        phone: '+1-555-0100',
      });
      const reviewer = await createUser({ roles: ['speaker', 'admin'] });
      const { event, track } = await createEvent();
      const proposal = await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        title: 'What a database owes you',
        trackId: track.id,
      });

      await Review.create({
        comment: 'A good talk, and the speaker can deliver it.',
        proposalId: proposal.id,
        reviewerId: reviewer.id,
        score: 2,
      });

      const document = await henri.privacy.export(speaker.email);

      expect(document.subject).toEqual({
        email: speaker.email,
        externalId: speaker.externalId,
        model: 'User',
      });
      expect(document.counts).toMatchObject({
        Proposal: 1,
        Review: 0,
        User: 1,
      });
      expect(document.records.User[0]).toMatchObject({
        bio: 'Runs the platform team.',
        company: 'Kestrel',
        email: speaker.email,
        name: 'Ada Okonjo',
        phone: '+1-555-0100',
      });
      // A password is not personal data somebody is owed back
      expect(document.records.User[0].password).toBeUndefined();
      expect(document.records.User[0].id).toBeUndefined();
      expect(document.records.Proposal[0]).toMatchObject({
        title: 'What a database owes you',
      });

      // The reviewer's export holds their review, not the speaker's proposal
      const theirs = await henri.privacy.export(reviewer.email);

      expect(theirs.counts).toMatchObject({ Proposal: 0, Review: 1 });
      expect(theirs.records.Review[0].comment).toContain('A good talk');
    });

    test("a withdrawn proposal is still the speaker's", async () => {
      const speaker = await createUser({});
      const { event, track } = await createEvent();
      const proposal = await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        title: 'Withdrawn but written',
        trackId: track.id,
      });

      // Soft deleted: hidden from every query, and still in the database
      await proposal.destroy();

      expect(await Proposal.count({ speakerId: speaker.id })).toBe(0);

      const document = await henri.privacy.export(speaker.email);

      expect(document.counts.Proposal).toBe(1);
      expect(document.records.Proposal[0].title).toBe('Withdrawn but written');
    });
  });

  describe('henri privacy:erase', () => {
    test('anonymizes the speaker and keeps the programme', async () => {
      const speaker = await createUser({
        bio: 'Runs the platform team.',
        company: 'Kestrel',
        name: 'Ada Okonjo',
        phone: '+1-555-0100',
      });
      const reviewer = await createUser({ roles: ['speaker', 'admin'] });
      const { event, track } = await createEvent();
      const accepted = await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        state: 'accepted',
        title: 'What a database owes you',
        trackId: track.id,
      });
      const withdrawn = await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        title: 'A talk that was withdrawn',
        trackId: track.id,
      });

      await withdrawn.destroy();
      await Review.create({
        comment: 'A good talk, and the speaker can deliver it.',
        proposalId: accepted.id,
        reviewerId: reviewer.id,
        score: 2,
      });

      const email = speaker.email;
      const receipt = await henri.privacy.erase(email);

      expect(receipt.records).toMatchObject([
        { action: 'anonymize', count: 2, model: 'Proposal' },
        { action: 'anonymize', count: 0, model: 'Review' },
        { action: 'anonymize', count: 1, model: 'User', written: 1 },
      ]);
      expect(receipt.subject.digest).toHaveLength(64);
      expect(JSON.stringify(receipt)).not.toContain(email);

      // The programme this conference ran is its own record: the talks are
      // still there, with their titles and their scores
      const talk = await Proposal.findById(accepted.id, { include: 'speaker' });

      expect(talk.title).toBe('What a database owes you');
      expect(talk.state).toBe('accepted');
      expect(talk.speakerId).toBe(speaker.id);
      expect(await Review.count({ proposalId: accepted.id })).toBe(1);
      // Including the withdrawn one, which a restore would have brought back
      expect(
        await Proposal.withDeleted().where({ id: withdrawn.id }).count()
      ).toBe(1);

      // And the speaker is a row that names nobody
      const erased = await User.findById(speaker.id);

      expect(erased).toBeTruthy();
      expect(erased.email).toMatch(/^erased-[0-9a-f]+@erased\.invalid$/u);
      expect(erased.name).toBe('[erased]');
      expect(erased.bio).toBeNull();
      expect(erased.company).toBeNull();
      expect(erased.phone).toBeNull();
      expect(erased.passwordChangedAt).toBeTruthy();

      // Nobody can sign in as them any more
      const answer = await request()
        .post('/login')
        .type('form')
        .send({ email, password: PASSWORD });

      expect(answer.status).not.toBe(302);
    });

    test("erases the reviewer's words with the reviewer", async () => {
      const speaker = await createUser({});
      const reviewer = await createUser({ roles: ['speaker', 'admin'] });
      const { event, track } = await createEvent();
      const proposal = await createProposal({
        eventId: event.id,
        speakerId: speaker.id,
        trackId: track.id,
      });

      await Review.create({
        comment: 'What one committee member thought of it.',
        proposalId: proposal.id,
        reviewerId: reviewer.id,
        score: 1,
      });

      await henri.privacy.erase(reviewer.email);

      const review = await Review.findOne({ reviewerId: reviewer.id });

      // The decision stays, the words go: the score is the committee's
      // record, the comment was the reviewer's own
      expect(review.score).toBe(1);
      // Padded to the ten characters the model asks for: what an erasure
      // writes has to pass the application's own validation
      expect(review.comment).toBe('[erased]..');
    });

    test('a dry run says what would happen and changes nothing', async () => {
      const speaker = await createUser({ name: 'Grace', phone: '+1-555-0199' });
      const receipt = await henri.privacy.erase(speaker.email, {
        dryRun: true,
      });

      expect(receipt.dryRun).toBe(true);
      expect(receipt.file).toBeNull();

      const untouched = await User.findById(speaker.id);

      expect(untouched.name).toBe('Grace');
      expect(untouched.phone).toBe('+1-555-0199');
    });

    test('a person nobody knows is a coded refusal', async () => {
      await expect(
        henri.privacy.erase('nobody@lineup.dev')
      ).rejects.toMatchObject({ code: 'HENRI_PRIVACY_UNKNOWN_SUBJECT' });
    });
  });
});
