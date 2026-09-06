// Seed data, henri's db/seeds.rb. `henri db:seed` boots the models and the
// user module (no views, no router, no workers) and awaits what this file
// exports; the models are globals here, like everywhere else.
//
// Seeds are run again on every machine, after every reset and on every
// deploy, so everything below is find-then-create and the numbers are
// deterministic: running it twice changes nothing.
//
// Sign in with any of the emails below; the password is always `showcase`.
// ada@lineup.dev and grace@lineup.dev are on the program committee (admins).

// Name, slug, blurb. The conference keeps the same four tracks every year.
const TRACKS = [
  [
    'Backend',
    'backend',
    'Servers, databases, queues and the things that page you at night.',
  ],
  [
    'Frontend',
    'frontend',
    'Browsers, rendering, accessibility and the last mile to the user.',
  ],
  [
    'Operations',
    'operations',
    'Deploying, observing and keeping software alive in production.',
  ],
  [
    'Craft',
    'craft',
    'Teams, reviews, testing and how software actually gets written.',
  ],
];

// `age` is how many days ago the proposals of the edition were submitted, so
// a freshly seeded database is never dated.
const EVENTS = [
  {
    age: 4,
    city: 'Montreal',
    closesAt: '2026-11-30',
    name: 'Lineup Conf 2026',
    opensAt: '2026-08-01',
    slug: 'lineup-2026',
    state: 'open',
    summary:
      'The eleventh edition. Two days of talks about the craft of building and running software, and the call for papers is open.',
    year: 2026,
  },
  {
    age: 330,
    city: 'Lisbon',
    closesAt: '2025-11-30',
    name: 'Lineup Conf 2025',
    opensAt: '2025-08-01',
    slug: 'lineup-2025',
    state: 'announced',
    summary:
      'The tenth edition, in Lisbon. The programme is out and the videos are online.',
    year: 2025,
  },
  {
    age: 700,
    city: 'Berlin',
    closesAt: '2024-11-30',
    name: 'Lineup Conf 2024',
    opensAt: '2024-08-01',
    slug: 'lineup-2024',
    state: 'announced',
    summary: 'The ninth edition, in Berlin. Archived here for the record.',
    year: 2024,
  },
];

// Name, email, company, bio, admin
const PEOPLE = [
  [
    'Ada Okonjo',
    'ada@lineup.dev',
    'Kestrel Systems',
    'Runs the platform team at Kestrel. Chairs the committee this year.',
    true,
  ],
  [
    'Grace Lindqvist',
    'grace@lineup.dev',
    'Northwind',
    'Database person. Reviews anything with the word "index" in it.',
    true,
  ],
  [
    'Bruno Sato',
    'bruno@lineup.dev',
    'Fathom',
    'Writes Go for a living and Elixir for fun.',
    false,
  ],
  [
    'Chantal Auger',
    'chantal@lineup.dev',
    'Vitrine',
    'Front end, design systems, and a long grudge against modals.',
    false,
  ],
  [
    'Dev Patel',
    'dev@lineup.dev',
    'Grainhouse',
    'On call more often than he would like. Talks about it anyway.',
    false,
  ],
  [
    'Elin Haugen',
    'elin@lineup.dev',
    'Nordkapp',
    'Compilers, then databases, now developer tooling.',
    false,
  ],
  [
    'Farid Belkacem',
    'farid@lineup.dev',
    'Cedar & Co',
    'Consultant. Has migrated eleven monoliths and regrets two.',
    false,
  ],
  [
    'Gwen Morris',
    'gwen@lineup.dev',
    'Tidepool Labs',
    'Accessibility engineer. Tests with a screen reader before a mouse.',
    false,
  ],
  [
    'Hana Kovac',
    'hana@lineup.dev',
    'Slipstream',
    'Performance work, mostly on other people’s code.',
    false,
  ],
  [
    'Ismail Toure',
    'ismail@lineup.dev',
    'Marrow',
    'Backend, payments, and the parts of finance nobody wants.',
    false,
  ],
  [
    'Júlia Ferreira',
    'julia@lineup.dev',
    'Aurora Health',
    'Health data, privacy, and slow careful releases.',
    false,
  ],
  [
    'Kwame Mensah',
    'kwame@lineup.dev',
    'Bright Anvil',
    'Runs a four person team and a very large Postgres.',
    false,
  ],
  [
    'Lena Fischer',
    'lena@lineup.dev',
    'Halcyon',
    'Testing, property based and otherwise.',
    false,
  ],
  [
    'Marco Rossi',
    'marco@lineup.dev',
    'Piazza',
    'Ex sysadmin. Still thinks in packets.',
    false,
  ],
  [
    'Nadia Rahman',
    'nadia@lineup.dev',
    'Quarry',
    'Data engineering, and the ethics of keeping things forever.',
    false,
  ],
  [
    'Oskar Nowak',
    'oskar@lineup.dev',
    'Freelance',
    'Contract work on legacy Rails and legacy grief.',
    false,
  ],
  [
    'Priya Venkat',
    'priya@lineup.dev',
    'Lantern',
    'Security engineer. Reads changelogs for fun.',
    false,
  ],
  [
    'Quentin Roy',
    'quentin@lineup.dev',
    'Mistral Books',
    'Search, ranking, and a bookshop that pays for it.',
    false,
  ],
  [
    'Rosa Delgado',
    'rosa@lineup.dev',
    'Coral',
    'Mobile web, offline first, patchy networks.',
    false,
  ],
  [
    'Sven Bakker',
    'sven@lineup.dev',
    'Duinen',
    'Infrastructure. Has opinions about YAML.',
    false,
  ],
  [
    'Tara Nolan',
    'tara@lineup.dev',
    'Pinewood',
    'Engineering manager, recovering architect.',
    false,
  ],
  [
    'Umberto Conti',
    'umberto@lineup.dev',
    'Fondamenta',
    'Distributed systems, and explaining them with drawings.',
    false,
  ],
  [
    'Vera Ilyina',
    'vera@lineup.dev',
    'Sable',
    'Observability, tracing, and deleting dashboards.',
    false,
  ],
  [
    'Wesley Adjei',
    'wesley@lineup.dev',
    'Tinderbox',
    'Build systems and the long tail of CI.',
    false,
  ],
];

// Title, abstract, format, level, track slug, speaker index, state, by
// edition. The 2026 call for papers is open, so it holds drafts and
// submissions; the two older editions are decided.
const PROPOSALS = {
  'lineup-2024': [
    [
      'The monolith we did not split',
      'Three years of pressure to move to services, and the modular monolith we built instead. Module boundaries, one database, and the two services we did extract.',
      'talk',
      'intermediate',
      'backend',
      6,
      'accepted',
    ],
    [
      'Backups you have actually restored',
      'A backup nobody has restored is a hypothesis. The quarterly drill we run, and the three times it failed.',
      'talk',
      'beginner',
      'operations',
      13,
      'accepted',
    ],
    [
      'Slow is a feature request',
      'Turning "the app is slow" into a number, a budget and a ticket. How we picked the four pages that mattered.',
      'talk',
      'beginner',
      'frontend',
      8,
      'accepted',
    ],
    [
      'Reading other people’s code',
      'A method for getting oriented in an unfamiliar codebase in a day, refined over eleven consulting engagements.',
      'talk',
      'beginner',
      'craft',
      6,
      'accepted',
    ],
    [
      'Schema changes without fear',
      'Additive first, backfill second, drop last, and never in the same deploy. The rules and the tooling that enforces them.',
      'talk',
      'intermediate',
      'backend',
      1,
      'accepted',
    ],
    [
      'Queues, retries and poison messages',
      'What happens to the message that fails forever, and the dead letter policy we wish we had written first.',
      'talk',
      'advanced',
      'backend',
      2,
      'accepted',
    ],
    [
      'The intranet nobody could use',
      'A redesign driven by watching eight people try to file an expense. Very little of it was visual.',
      'talk',
      'beginner',
      'frontend',
      3,
      'accepted',
    ],
    [
      'Incident reviews that change something',
      'Blameless is not enough: a review needs an owner and a date. The template we settled on after forty incidents.',
      'talk',
      'intermediate',
      'operations',
      20,
      'accepted',
    ],
    [
      'Microservices for two developers',
      'We split a small application into nine services and spent a year putting it back together.',
      'talk',
      'intermediate',
      'backend',
      15,
      'rejected',
    ],
    [
      'A new state management library',
      'Announcing a library that solves state management once and for all.',
      'lightning',
      'intermediate',
      'frontend',
      4,
      'rejected',
    ],
    [
      'Blockchain for conference tickets',
      'A ticketing system on a distributed ledger, and why the committee should care.',
      'talk',
      'beginner',
      'backend',
      16,
      'rejected',
    ],
    [
      'Serverless everything',
      'Moving every workload to functions, including the ones that run for an hour.',
      'talk',
      'intermediate',
      'operations',
      13,
      'rejected',
    ],
  ],

  'lineup-2025': [
    [
      'Postgres is enough',
      'Queues, full text search, JSON documents and a cache, all in the database you already operate. Where that stops being true, with numbers.',
      'talk',
      'intermediate',
      'backend',
      1,
      'accepted',
    ],
    [
      'The index you did not add',
      'Six months of slow query logs from a mid sized product, and what adding four indexes did to them. Also the two indexes we removed.',
      'talk',
      'beginner',
      'backend',
      11,
      'accepted',
    ],
    [
      'Migrating money',
      'Moving a payments ledger between two schemas while it kept taking money. Dual writes, reconciliation, and the day we found a rounding difference.',
      'talk',
      'advanced',
      'backend',
      9,
      'accepted',
    ],
    [
      'Feature flags rot',
      'Flags are cheap to add and expensive to keep. An audit of a codebase with three hundred of them, and the process that got it to forty.',
      'talk',
      'intermediate',
      'backend',
      6,
      'accepted',
    ],
    [
      'Design systems for two designers and no budget',
      'What a small team can actually maintain: tokens, ten components, and written rules for everything else.',
      'talk',
      'beginner',
      'frontend',
      3,
      'accepted',
    ],
    [
      'The accessibility bugs QA never files',
      'Focus order, live regions and error summaries: the defects that pass every visual review. How we got them into the same tracker as everything else.',
      'talk',
      'intermediate',
      'frontend',
      7,
      'accepted',
    ],
    [
      'A megabyte of JavaScript, itemised',
      'We took the bundle apart line by line and published the receipt. Half of it was two date libraries and a country list.',
      'lightning',
      'beginner',
      'frontend',
      8,
      'accepted',
    ],
    [
      'Blue, green and the database',
      'Zero downtime deploys are easy until state is involved. Expand and contract migrations, in the order we run them.',
      'talk',
      'advanced',
      'operations',
      19,
      'accepted',
    ],
    [
      'Alerting on symptoms, not causes',
      'We deleted every alert that did not correspond to something a user could feel, and slept better. What replaced them.',
      'talk',
      'intermediate',
      'operations',
      22,
      'accepted',
    ],
    [
      'Testing the parts that hurt',
      'Coverage numbers do not tell you where the risk is. A way to find the twenty percent of the code that causes the incidents, and test that.',
      'talk',
      'intermediate',
      'craft',
      12,
      'accepted',
    ],
    [
      'Everything is a state machine',
      'Order, subscription, proposal: the same four states keep reappearing. Making them explicit, and letting the database enforce them.',
      'talk',
      'intermediate',
      'backend',
      5,
      'rejected',
    ],
    [
      'My favourite editor plugins',
      'A tour of the twelve plugins I install on a new machine, in the order I install them.',
      'lightning',
      'beginner',
      'craft',
      15,
      'rejected',
    ],
    [
      'Kubernetes for a single container',
      'We ran one small service on a full cluster for two years. This is what it cost and what we moved to.',
      'talk',
      'beginner',
      'operations',
      13,
      'rejected',
    ],
    [
      'Rust in the browser, again',
      'Compiling a validation library to WebAssembly and measuring whether it was worth it. It was not, quite.',
      'talk',
      'advanced',
      'frontend',
      4,
      'rejected',
    ],
  ],

  'lineup-2026': [
    [
      'Your database is not a queue, until it is',
      'Every team eventually builds a job queue on top of the database they already run. This talk walks through the version that works: SKIP LOCKED, a visibility timeout, and the four failure modes that will still bite you.',
      'talk',
      'intermediate',
      'backend',
      2,
      'submitted',
    ],
    [
      'Reading a query plan without panicking',
      'EXPLAIN output looks like a wall of numbers until someone shows you which three matter. We read six real plans from a production system, from a trivial index scan to a nested loop that took a site down.',
      'talk',
      'beginner',
      'backend',
      1,
      'submitted',
    ],
    [
      'The migration that ran for nine hours',
      'A postmortem of a schema change that locked a table on a Friday afternoon. What we did wrong, what the tooling could not tell us, and the checklist we use now.',
      'talk',
      'intermediate',
      'backend',
      11,
      'submitted',
    ],
    [
      'Idempotency keys, end to end',
      'Retries are not optional on a flaky network, and neither is exactly-once behaviour for a payment. A tour of idempotency keys from the client header to the storage layer, including what to do when the first attempt is still running.',
      'talk',
      'advanced',
      'backend',
      9,
      'submitted',
    ],
    [
      'Soft deletes and the lies they tell',
      'A deleted_at column looks harmless and then quietly breaks unique constraints, foreign keys and every report you have. Where soft deletes earn their keep and where they should be an archive table instead.',
      'talk',
      'intermediate',
      'backend',
      5,
      'submitted',
    ],
    [
      'Server rendering is fine, actually',
      'A tour of what a server rendered application gives you for free in 2026: no hydration bill, no waterfall, no client state library. We build one live and measure it against its single page equivalent.',
      'talk',
      'intermediate',
      'frontend',
      3,
      'submitted',
    ],
    [
      'Forms nobody hates',
      'Validation on the server, errors under the right field, and a submit button that cannot be pressed twice. Boring requirements that almost no framework gives you by default.',
      'talk',
      'beginner',
      'frontend',
      7,
      'submitted',
    ],
    [
      'A screen reader user opens your app',
      'A recorded walkthrough of five well known interfaces with a screen reader, at the speed real users run it. The problems are not exotic: they are headings, labels and focus.',
      'talk',
      'beginner',
      'frontend',
      7,
      'submitted',
    ],
    [
      'Offline first on a train',
      'Building for a network that comes and goes: a queue in the browser, conflict rules a human can explain, and an interface that never lies about what has been saved.',
      'workshop',
      'advanced',
      'frontend',
      18,
      'submitted',
    ],
    [
      'Deleting half our dashboards',
      'We had four hundred dashboards and no idea which ones anyone opened. This is the story of instrumenting the observability tooling itself, then deleting most of it.',
      'talk',
      'intermediate',
      'operations',
      22,
      'submitted',
    ],
    [
      'On call for a four person team',
      'Rotation, escalation and sleep, when there is no separate operations team and never will be. What we page on, what waits for morning, and how we decided.',
      'talk',
      'beginner',
      'operations',
      11,
      'submitted',
    ],
    [
      'The YAML is the application',
      'Configuration grew until it was a programming language with no type checker and no tests. How we moved deployment config back into code, in stages, without a big bang.',
      'talk',
      'intermediate',
      'operations',
      19,
      'submitted',
    ],
    [
      'Tracing a request through six services',
      'One request, six hops, and a latency budget nobody wrote down. We follow a real trace and find the two seconds hiding in a retry loop.',
      'talk',
      'advanced',
      'operations',
      21,
      'submitted',
    ],
    [
      'Code review without the sighs',
      'Review is where most teams spend their disagreement budget. Concrete rules that lowered our time to merge without lowering the bar: small diffs, one owner, and comments that say what to do.',
      'talk',
      'beginner',
      'craft',
      20,
      'submitted',
    ],
    [
      'Property based tests for people who write CRUD',
      'You do not need a parser to benefit from generated inputs. Three examples from an ordinary business application, and the two bugs they found the day we wrote them.',
      'workshop',
      'intermediate',
      'craft',
      12,
      'submitted',
    ],
    [
      'The framework you already have',
      'Before adopting the next thing, an honest inventory of what your current stack does and what it does not. A method for that inventory, and permission to stay.',
      'lightning',
      'beginner',
      'craft',
      15,
      'submitted',
    ],
    [
      'Rewriting search without downtime',
      'Moving a bookshop search from LIKE queries to a real index, one query shape at a time, with both running side by side for a month.',
      'talk',
      'advanced',
      'backend',
      17,
      'draft',
    ],
    [
      'What we log when we log a person',
      'Every log line about a user is a small privacy decision. A practical scheme for redaction, retention and the requests that let someone read their own trail.',
      'talk',
      'intermediate',
      'operations',
      14,
      'draft',
    ],
    [
      'CI that finishes before you switch tabs',
      'A build that took twenty two minutes now takes four. Caching, test selection and the parts we simply deleted.',
      'talk',
      'intermediate',
      'craft',
      23,
      'draft',
    ],
    [
      'Drawing distributed systems',
      'A talk made entirely of drawings: consensus, partitions and clocks, explained the way I explain them to new hires on a whiteboard.',
      'talk',
      'beginner',
      'craft',
      21,
      'draft',
    ],
  ],
};

// Proposal title, reviewer index, score, comment
const REVIEWS = [
  [
    'Your database is not a queue, until it is',
    0,
    2,
    'Exactly the talk I keep wanting to send people. The failure modes section is what makes it more than a blog post.',
  ],
  [
    'Your database is not a queue, until it is',
    1,
    1,
    'Strong. I would cut the history at the front and get to SKIP LOCKED faster.',
  ],
  [
    'Reading a query plan without panicking',
    1,
    2,
    'We get a version of this every year and this is the best one. Real plans from a real system.',
  ],
  [
    'Reading a query plan without panicking',
    0,
    1,
    'Good beginner slot. Please make sure the plans are readable from the back row.',
  ],
  [
    'The migration that ran for nine hours',
    0,
    1,
    'Postmortems land well here. Needs a clearer takeaway checklist at the end.',
  ],
  [
    'Idempotency keys, end to end',
    1,
    2,
    'Advanced but broadly useful, and the in-flight case is the part everyone gets wrong.',
  ],
  [
    'Idempotency keys, end to end',
    0,
    1,
    'Yes. Slight overlap with the queue talk; we should not schedule them opposite each other.',
  ],
  [
    'Soft deletes and the lies they tell',
    0,
    0,
    'Useful content, but the outline reads like a list of grievances. Would like to see the decision framework.',
  ],
  [
    'Server rendering is fine, actually',
    1,
    1,
    'The live build is a risk and also the reason to accept it.',
  ],
  [
    'Server rendering is fine, actually',
    0,
    2,
    'Timely, and the measurement section keeps it honest.',
  ],
  [
    'Forms nobody hates',
    0,
    1,
    'Unglamorous and useful. Good first-talk material.',
  ],
  [
    'A screen reader user opens your app',
    1,
    2,
    'We should have had this three years ago. Accept.',
  ],
  [
    'A screen reader user opens your app',
    0,
    2,
    'Recorded walkthroughs make this bulletproof. Please keep them short.',
  ],
  [
    'Offline first on a train',
    0,
    1,
    'A workshop is the right format. Needs a hard cap on the setup time.',
  ],
  [
    'Deleting half our dashboards',
    1,
    1,
    'Fun and true. The instrumentation-of-the-instrumentation angle is the novel bit.',
  ],
  [
    'On call for a four person team',
    0,
    2,
    'Small teams are most of our audience and this is written for them.',
  ],
  [
    'The YAML is the application',
    1,
    0,
    'Agree with the thesis, unconvinced by the staged migration section as written.',
  ],
  [
    'Tracing a request through six services',
    0,
    1,
    'Good, if the trace is from a system the audience can imagine running.',
  ],
  ['Code review without the sighs', 1, 2, 'Concrete rules, not vibes. Accept.'],
  [
    'Property based tests for people who write CRUD',
    0,
    1,
    'The CRUD framing is what makes this different from the usual pitch.',
  ],
  [
    'The framework you already have',
    1,
    1,
    'A good lightning talk. Do not let it become a rant.',
  ],
  [
    'Postgres is enough',
    0,
    2,
    'The "where it stops being true" half is what earns the title.',
  ],
  [
    'The index you did not add',
    1,
    2,
    'Six months of real logs. Nothing to argue with.',
  ],
  [
    'Migrating money',
    0,
    2,
    'The rounding difference story alone justifies the slot.',
  ],
  ['Feature flags rot', 1, 1, 'Every team over five years old needs this.'],
  [
    'Everything is a state machine',
    1,
    -1,
    'True but well covered elsewhere, and the outline stays abstract.',
  ],
  [
    'Everything is a state machine',
    0,
    0,
    'Would reconsider with a worked example from the speaker’s own system.',
  ],
  ['My favourite editor plugins', 0, -2, 'Not a conference talk.'],
  [
    'Kubernetes for a single container',
    1,
    -1,
    'The cost analysis is interesting; the rest is a complaint.',
  ],
  [
    'Rust in the browser, again',
    0,
    -1,
    'Honest negative result, but the audience for it here is small.',
  ],
];

/** The proposals that were withdrawn by their speaker after submitting */
const WITHDRAWN = ['Drawing distributed systems'];

/**
 * Finds a record, or creates it
 *
 * @param {function} Model The model
 * @param {object} where What identifies the record
 * @param {object} attributes The attributes to create it with
 * @returns {Promise<object>} The existing or created instance
 */
const findOrCreate = async (Model, where, attributes) => {
  const existing = await Model.findOne(where);

  if (existing) {
    return existing;
  }

  return Model.create({ ...where, ...attributes });
};

/**
 * A date `days` before now, so a seeded database is never stale
 *
 * @param {number} days How many days ago
 * @returns {Date} The date
 */
const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

module.exports = async (henri) => {
  const events = {};
  const tracks = {};
  const users = [];
  const proposals = new Map();

  for (const spec of EVENTS) {
    const event = await findOrCreate(
      Event,
      { slug: spec.slug },
      {
        city: spec.city,
        closesAt: new Date(spec.closesAt),
        name: spec.name,
        opensAt: new Date(spec.opensAt),
        state: spec.state,
        summary: spec.summary,
        year: spec.year,
      }
    );

    events[spec.slug] = event;

    for (const [name, slug, blurb] of TRACKS) {
      tracks[`${spec.slug}/${slug}`] = await findOrCreate(
        Track,
        { eventId: event.id, slug },
        { blurb, name }
      );
    }
  }

  for (const [name, email, company, bio, admin] of PEOPLE) {
    const user = await findOrCreate(
      User,
      { email },
      { bio, company, name, password: 'showcase' }
    );

    // Roles are never mass assignable: setRoles() is the only way in
    if (admin && !(await user.hasRole(['admin']))) {
      await User.setRoles(user.id, ['speaker', 'admin']);
    }

    users.push(user);
  }

  for (const spec of EVENTS) {
    const event = events[spec.slug];
    let index = 0;

    for (const [
      title,
      abstract,
      format,
      level,
      track,
      speaker,
      state,
    ] of PROPOSALS[spec.slug]) {
      const decided = state === 'accepted' || state === 'rejected';
      // Proposal is paranoid, so a withdrawn one is invisible to findOne():
      // withDeleted() keeps the seeds idempotent after the withdrawals below
      const existing = await Proposal.withDeleted()
        .where({ eventId: event.id, title })
        .first();
      const proposal =
        existing ||
        (await Proposal.create({
          abstract,
          decidedAt: decided ? daysAgo(spec.age - 10) : null,
          eventId: event.id,
          format,
          level,
          speakerId: users[speaker].id,
          state,
          submittedAt: state === 'draft' ? null : daysAgo(spec.age + index),
          title,
          trackId: (tracks[`${spec.slug}/${track}`] || {}).id || null,
        }));

      proposals.set(title, proposal);
      index += 1;
    }
  }

  for (const [title, reviewer, score, comment] of REVIEWS) {
    const proposal = proposals.get(title);

    if (!proposal) {
      continue;
    }

    await findOrCreate(
      Review,
      { proposalId: proposal.id, reviewerId: users[reviewer].id },
      { comment, score }
    );
  }

  for (const title of WITHDRAWN) {
    const proposal = proposals.get(title);

    if (proposal && !proposal.deletedAt) {
      await proposal.destroy();
    }
  }

  henri.pen.info(
    'seeds',
    `${EVENTS.length} editions, ${users.length} people, ${proposals.size} proposals, ${REVIEWS.length} reviews`
  );
  henri.pen.info(
    'seeds',
    'sign in as ada@lineup.dev (admin), password showcase'
  );
};
