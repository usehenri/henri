const fs = require('fs-extra');
const path = require('path');

const { describe } = require('./agents');
const { digest, markers } = require('./markers');

/**
 * `henri skills`: the procedures, written down.
 *
 * **What was missing.** A scaffolded application already hands a coding
 * agent three things, and each answers a different question. `.mcp.json`
 * plus `henri mcp` are *capabilities* -- `routes`, `models`, `schema`,
 * `openapi`, `errors`, `logs`, `request` and the generators, answered for
 * this application and, where it is running, for the live one. `AGENTS.md`
 * is *always-on context*, generated from the same application by
 * `agents.js`. `henri docs` is the *reference*, shipped inside the package
 * at the version installed. What none of them is, is the **order**: an
 * agent holding all three still has to work out on its own that adding a
 * tenanted model means a mark, a migration, a policy, a `params` block and
 * a test, in that order, with the commands *this* store actually has. That
 * sequence is what a skill is.
 *
 * **Three layers, each doing what it is good at.** The *procedure* is
 * generic and ships in this file, versioned with the code it describes, so
 * it cannot describe a henri that does not exist. The *facts* are derived
 * from the application -- the adapter and therefore the migration
 * commands, the renderer and therefore the page extension, whether
 * `config.tenancy` is on, which henri packages are installed -- and they
 * come from `agents.js`'s `describe()`, the same reader `AGENTS.md` uses,
 * because a second reader of one application is the thing that goes wrong
 * later. The *judgement* is the agent's, at read time, through the tools
 * that already exist: a skill says "ask `schema` before you write SQL"
 * rather than baking this application's tables into a file that starts
 * rotting the moment it is written.
 *
 * **Why no skill restates a guide.** `henri docs <page>` and the `guide`
 * tool of `henri mcp` already serve the documentation at the version
 * installed. A skill that explained what a policy *is* would be a second
 * copy of `guides/policies.md` with none of its updates -- so a skill says
 * the order and names the page, and `DESCRIPTION` and `BUDGET` are what
 * keep it honest: a procedure that has grown into a manual no longer fits.
 *
 * **Deterministic, and nothing is asked of a model.** `henri new` runs in
 * Docker builds and in CI with no API key, so nothing here may need one:
 * the input is the directory and the output is bytes, the way
 * `types/generated.d.ts` is. `packages/cli/__tests__/fixtures/skills-app`
 * and the files checked in beside it are what proves it, compared byte for
 * byte by `packages/cli/__tests__/skills.spec.js`.
 *
 * **Where they go is a writer function.** Claude Code discovers a skill at
 * `.claude/skills/<name>/SKILL.md`, with YAML frontmatter opening the very
 * first line and a body loaded on demand when the `description` matches
 * what is being done -- verified against the Claude Code binary on the
 * machine this was written on and against its published documentation, not
 * recalled. That is one vendor's layout, so it is one entry in `LAYOUTS`
 * and `--for <vendor>` picks it; another vendor is an entry next to it
 * rather than a rewrite. The scaffold already writes vendor-specific files
 * (`CLAUDE.md` and `.mcp.json` are in `agents.js`'s `FILES`), so this is a
 * call this repository already made.
 */

/** Where a skill goes, per vendor. `--for <vendor>` picks one. */
const LAYOUTS = {
  /**
   * Claude Code. Measured rather than assumed: the frontmatter must open on
   * the first line of the file or the whole file is read as body, which is
   * why the generated region starts *below* it -- and why the frontmatter,
   * being outside the region, is never rewritten once written. The
   * `description` is the line that decides when the skill loads, so a team
   * retuning it is a team henri must not argue with.
   */
  claude: {
    file: (name) => path.join('.claude', 'skills', name, 'SKILL.md'),
    label: 'Claude Code',
    prefix: ({ description, name }) =>
      `---\nname: ${name}\ndescription: ${quoted(description)}\n---\n\n`,
  },
};

/** The vendor written when `--for` is not given */
const DEFAULT_LAYOUT = 'claude';

/**
 * The format of a generated region, carried in its marker so a file written
 * by another henri is recognised rather than mis-read. Bump it when the
 * *shape* of what is written changes, never for a wording change.
 */
const FORMAT = 1;

/**
 * The size one skill body is held to, in lines. A budget, not a target: a
 * procedure that has grown into a manual has stopped being a procedure, and
 * the manual already exists behind `henri docs`.
 */
const BUDGET = 140;

/**
 * The size a `description` is held to, in characters. This is the one part
 * of a skill that is loaded on *every* turn -- it is how the agent decides
 * whether to open the body at all -- so it is the line that has to earn its
 * place. Claude Code truncates the listing well above this; the bound here
 * is about the reader, not the format.
 */
const DESCRIPTION = 340;

/** The notice inside a generated region */
const NOTICE =
  '<!-- Generated by `henri generate skills` from this application. Everything\n     between these markers is rewritten; write your own notes outside them. -->';

/** What a freshly written skill says below the region */
const FOOTER =
  '<!-- Below the marker is yours: `henri generate skills` never reads or\n     rewrites it, and it never rewrites the frontmatter above either -- so\n     the description is yours to retune. Run it again when the app changes. -->';

/** The marked region of a skill. The machinery is shared with `AGENTS.md`. */
const MARKED = markers({
  footer: FOOTER,
  format: FORMAT,
  kind: 'skills',
  notice: NOTICE,
  subject: 'skill',
});

/**
 * The facts a skill is written from: everything `describe()` read except
 * which skills are on disk.
 *
 * That one is left out on purpose, and the reason is a loop. `AGENTS.md`
 * names the skills an application has, so `describe()` reads them -- and if
 * that reading were inside the digest a skill's own marker carries, writing
 * the skills would change the facts the skills were written from, and every
 * one of them would be stale the instant it was created. Nothing in a skill
 * body depends on it, so leaving it out costs nothing and closes the loop.
 *
 * `AGENTS.md` keeps it, which is right the other way round: the sentence
 * pointing at the skills does change when they appear, and it should be
 * regenerated when it does.
 *
 * @param {string} dir The application directory
 * @returns {object} The facts
 */
const factsFor = (dir) => {
  const facts = { ...describe(dir) };

  delete facts.skills;

  return facts;
};

/**
 * A string as a YAML scalar. JSON strings are valid double-quoted YAML, so
 * this is exact for every description below -- including the ones carrying
 * a colon, which unquoted would end the key.
 *
 * @param {string} value The text
 * @returns {string} The scalar
 */
const quoted = (value) => JSON.stringify(value);

/**
 * Join what is there, dropping what is not, so a section a fact turned off
 * leaves no blank line behind
 *
 * @param {Array<?string>} list The lines
 * @returns {string} The block
 */
const lines = (list) => list.filter(Boolean).join('\n');

/**
 * The MCP tools, named only when the application actually has the server.
 * An application without `@usehenri/mcp` gets the command line instead --
 * telling an agent to ask a tool that is not there is worse than saying
 * nothing.
 *
 * @param {object} facts What describe() read
 * @param {string} withTools What to say when the server is there
 * @param {string} without What to say when it is not
 * @returns {string} One of them
 */
const tools = (facts, withTools, without) => (facts.mcp ? withTools : without);

/**
 * What a schema change actually takes on this application's store. This is
 * the fact a generic procedure most needs and most often gets wrong: a
 * drizzle store has generated migrations, an mssql store has none at all,
 * and MongoDB does not have the question.
 *
 * @param {object} facts What describe() read
 * @returns {string} Markdown
 */
const migrationSection = (facts) => {
  if (facts.api === 'mongoose') {
    return `MongoDB takes the documents as they are, so there is no migration to run and nothing to commit. The cost is the other way round: a column you removed from the schema is still in every document that already has it, and a column you added is absent from all of them. Decide what reads those documents before you ship -- nothing will raise it later.`;
  }

  if (facts.api === 'sequelize') {
    return `This store has **no migrations** and is not getting any. A development boot runs \`sequelize.sync()\`, which creates the tables that are *missing*; it never alters one that already exists, and a production boot changes nothing at all.

So a column added to a model whose table exists needs the \`ALTER\` run by a person:

    henri db:status         # what the database and the models disagree about
    henri db:status --sql   # the DDL for that drift, to review and run

Run \`henri db:status\` before you commit, or the drift ships.`;
  }

  const mysql =
    facts.dialect === 'mysql'
      ? '\n\nOn mysql, `henri db:push` does **not** alter an existing table -- it creates the missing ones and reports the drifted ones. A mysql schema change is always `db:generate` then `db:migrate`.'
      : '';

  return `Migrations are generated files and they are committed:

    henri db:generate   # writes the SQL into db/migrations
    henri db:migrate    # applies it
    henri db:status     # where the database stands

**Read what \`db:generate\` wrote before you apply it.** henri scans the SQL and reports a dropped or renamed column or table, a \`NOT NULL\` column with no default, a type change, an index build and a \`DELETE\`/\`UPDATE\` with no \`WHERE\`. Those findings are not noise: in production \`db:migrate\` refuses the migration until its token is in \`config.migrations.approved\`, so the deploy is where you find out otherwise. \`henri docs guides/models\` and the \`errors\` tool on a \`HENRI_MIGRATION_*\` code have the rest.

\`henri db:push\` skips the files in development and \`henri db:rollback\` computes the inverse when it can -- it refuses one that dropped a table or a column, because there is nothing to put back.${mysql}`;
};

/**
 * The gate list of this application, in the order that fails cheapest
 * first. Every line is a command that will really run here.
 *
 * @param {object} facts What describe() read
 * @returns {Array<[string, string]>} The command and what it catches
 */
const gateList = (facts) => {
  const list = [
    [
      'henri doctor',
      'The conventions check: a stale `AGENTS.md`, a config key that will fail the boot, a missing dependency, a policy nothing asks. Cheapest, so first.',
    ],
  ];

  if (facts.api === 'drizzle') {
    list.push([
      'henri db:status',
      'Whether a model change still needs a migration generated, and whether one is waiting to be applied.',
    ]);
  }

  if (facts.api === 'sequelize') {
    list.push([
      'henri db:status',
      'What the database and the models disagree about. This store has no migrations, so this is the only thing that will tell you.',
    ]);
  }

  list.push(
    [
      'henri test',
      'The suite, with henri booted under `NODE_ENV=test`. A failure here is the one that matters.',
    ],
    [
      'eslint .',
      'The linter. The model globals are declared, so an undefined `Task` is a real mistake and not a false positive.',
    ],
    [
      'henri audit',
      "The security check, from this application's files. `--checks` says what it looks for; it reports what *this* application says, never henri's defaults.",
    ]
  );

  return list;
};

/**
 * A markdown table with its columns padded
 *
 * @param {Array<string>} headers The column headers
 * @param {Array<Array<string>>} rows The rows
 * @returns {string} The table
 */
const table = (headers, rows) => {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length))
  );
  const line = (cells) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;

  return [
    line(headers),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(line),
  ].join('\n');
};

/** The marks a model can carry, and the question each one answers */
const marksFor = (facts) =>
  lines([
    '- `personal: true` on every column that is about a person -- it is what henri masks in the logs, hands to `henri privacy:export` and removes in `henri privacy:erase`.',
    '- `encrypted: true` for a secret at rest. It implies `personal`, and a randomised one can never be queried.',
    '- `options: { paranoid: true }` when a delete should be recoverable.',
    '- `options: { versioned: true }` when who changed what has to be answerable later.',
    "- `options: { slug: 'title' }` when the url should carry the name instead of the uuid.",
    '- `options: { retention: ... }` when the rows must not be kept forever.',
    facts.tenancy
      ? '- `options: { tenant: true }` -- **decide this first.** This application is multi-tenant, so every model answers "whose rows are these?". A tenanted model refuses a query with no tenant in scope (`HENRI_TENANT_REQUIRED`); a shared one is a decision worth a comment.'
      : null,
  ]);

/**
 * The catalogue. Every entry is a **sequence** -- what to do, in what
 * order, with the commands this application has -- and never an
 * explanation, which is what `henri docs` is for.
 */
const SKILLS = [
  {
    body: (facts) => `# Add or change a model

henri reads the model file to decide what the migration says, what leaves the server, what a page renders and what \`henri privacy\` hands over. The marks *are* the design, so they are decided before the migration, not after it -- a mark added later is a second migration.

## 1. Look before you write

${tools(
  facts,
  "- `models` -- this application's models and the marks they already carry.\n- `schema` -- what the database really holds. The model files do not know the physical table and column names, so ask this before writing any SQL.",
  '- `henri console` -- the models, in a REPL with the application booted.\n- `henri db:schema` -- what the database really holds, which the model files do not know.'
)}

Follow the nearest existing model. Two conventions in one application is worse than either of them.

## 2. Generate the file

    henri generate model Invoice number:string! total:decimal status:string:enum=draft,sent

Types are \`string, text, number, integer, float, decimal, bigint, boolean, date, json, uuid\`; a trailing \`!\` makes the column required and \`:enum=a,b\` is the one setting a pair takes. \`decimal\` and \`bigint\` cross into JavaScript as **strings**, exactly -- henri ships no arithmetic for them.

## 3. Decide the marks now

${marksFor(facts)}

\`henri docs guides/models\` says what each one does; \`guides/privacy\` and \`guides/retention\` are the two with commands of their own.

## 4. Put the rules where every write sees them

What must be true of a record goes in \`validates\`, next to the schema, keyed by field. **Not** in the controller: \`params\` checks what a *request* sent, and a job, a seed and a console have no request. The schema's own \`required\` and \`enum\` are the same rules, so they mean one thing.

## 5. Migrate

${migrationSection(facts)}

## 6. Catch up what reads the model file

    henri types                                # .henri/types.d.ts: the new columns, for the editor and for you
    henri generate scaffold <Name> --force     # only if a mark changed: pages follow the model file
    henri generate agents                      # AGENTS.md carries the marks

## 7. Gates

\`henri doctor\`, then \`henri test\`. \`/henri-before-you-commit\` is the whole list.`,
    description:
      'Add a model to this henri application, or change one: the marks that decide how henri treats every row, where record rules go, and the migration commands this store actually has. Use for a new table, a new column, an enum, soft deletes, or a model holding personal data.',
    name: 'henri-add-a-model',
  },
  {
    body: (facts) => {
      const ext = facts.renderer === 'inertia' ? 'jsx' : 'js';

      return `# Add a resource, end to end

A resource is not finished when it renders. It is finished when a stranger cannot read another person's row, the request is checked at the boundary, and a test says so. This is that order.

## 1. Scaffold it

    henri generate scaffold Invoice number:string! total:decimal status:string:enum=draft,sent

That writes the model, the controller, the routes and the pages (\`.${ext}\`, this application's renderer) in one step. \`henri generate crud\` is the JSON-only half; \`henri destroy scaffold Invoice\` undoes either. Anything already there is skipped unless \`--force\`.

If the model needs marks, stop and do \`/henri-add-a-model\` first: the pages and the \`params\` block are generated **from the model file**, so a mark decided afterwards means regenerating them.

## 2. Write the policy before the page works

    henri generate policy Invoice ownerId

\`roles\` on a route says who may reach it; \`app/policies/<model>.js\` says who may act on one record. It fails closed -- no policy, no rule, a rule that threw and anything but the boolean \`true\` are all no -- so the page will start refusing until the rule is written. That is the right way round.

Then put \`policy: true\` on the route so henri asks at the gate too, and give the policy a \`scope(user)\`: it is what narrows an index, and a policy without one throws rather than quietly meaning "everything".

**Never write the ownership check as an \`if\` in the controller.** The policy is what \`paths\` and \`_links\` are filtered by, so a page stops offering a button the request would refuse -- an \`if\` gets none of that.

## 3. Declare what the action accepts

The scaffold writes a \`params\` block for \`create\` and \`update\` from the model file. Extend it rather than reading \`req.body\`: an undeclared key is dropped, a bad one is a 422 before the action runs, and \`req.permit()\` with no arguments hands back the whole declaration.

## 4. If it is a list, declare the filters

Nothing is filterable or sortable until \`filters\` says so, which is the point. \`req.filters()\` intersects the client's condition with \`policy.scope(user)\` using an \`and\`, so a filter can narrow a list and can never widen it.

## 5. If it answers JSON somebody assembled, declare the answer

\`res.resource()\` and \`res.collection()\` already publish the foreign keys and strip what is marked \`expose: false\`. A hand-built object from \`res.json()\` gets the same floor, but only a declared \`answers\` block says what is *allowed* out -- and what is not declared does not leave.

## 6. Test it

    henri generate test invoices

Records come from \`test/factories/<name>.js\`; whatever the test asserts on goes in the \`create()\` call and everything else in the factory. Write the refusal, not only the success: the test that matters is the one where somebody else's invoice answers 404.

## 7. Gates

\`henri doctor\` (it reports a policy nothing asks), then \`henri test\`, then \`/henri-before-you-commit\`.

Pages: \`henri docs guides/views\`. Policies: \`henri docs guides/policies\`. Filters: \`guides/filtering\`.`;
    },
    description:
      'Add a complete resource to this henri application: scaffold, policy, permitted params, filters, the answer, and the test, in the order that keeps each step honest. Use when adding a CRUD resource, an index page, a JSON endpoint, or authorization for records.',
    name: 'henri-add-a-resource',
  },
  {
    body: (facts) => `# Before you commit

Run these in this order. They are ordered by what they cost, so the cheapest thing that can fail does it first.

${table(
  ['Command', 'What it catches'],
  gateList(facts).map(([command, why]) => [`\`${command}\``, why])
)}

## The ones people skip, and what it costs

- **\`henri doctor\` after a generator.** The generators rewrite \`config/routes.js\`, and \`AGENTS.md\` and \`.henri/types.d.ts\` are generated from the application: doctor is what says they no longer describe it. An agent reading a stale \`AGENTS.md\` writes code this application cannot run.
- **\`henri audit\` when the change touched configuration.** It reports what *this* application weakened, never henri's own defaults, so a finding is always something somebody chose.
${
  facts.api === 'drizzle'
    ? '- **Reading the generated migration.** `henri db:generate` will write a statement that takes a production database down, and a production `db:migrate` refuses it until its token is approved. Reading it now is cheaper than reading it during a deploy.'
    : ''
}${
      facts.api === 'sequelize'
        ? '- **`henri db:status`.** This store has no migrations, so a model change that needs an `ALTER` is invisible until something reads the database back. This is that thing.'
        : ''
    }

## Do not

- Do not leave \`henri server\` running to "check it works" in a non-interactive session -- \`henri test\` is the check.
- Do not commit \`.env\`, \`.henri/\` or \`.backup/\`, and do not put a secret in \`config/*.json\`.
- Do not regenerate a snapshot to make a test pass unless the diff is explained by the change.

## When a gate fails

\`/henri-diagnose-a-failure\`. Any failure henri raises on its own behalf carries a \`HENRI_*\` code, and the code is the fastest way in.

What each gate is actually checking, when you need to argue with one: \`henri docs guides/security\` for the audit, \`guides/testing\` for the suite, and \`henri audit --checks\` for the catalogue itself.`,
    description:
      'The real pre-commit gate list for this henri application, in order, with what each one catches and which are safe to skip. Use before committing, before opening a pull request, or when a change is finished and needs verifying.',
    name: 'henri-before-you-commit',
  },
  {
    body: (facts) => `# Diagnose a failure

Every failure henri raises on its own behalf carries a code -- \`HENRI_<AREA>_<REASON>\`, one namespace across core, the adapters, the queue, the view engines, the command line and \`henri mcp\`. **Find the code first.** It is in the thrown error, the JSON error body, the \`--json\` output of any command and the log line, and it turns a guess into a lookup.

## 1. Read the code

${tools(
  facts,
  '- `errors` -- the catalogue entry for a code: what it means, what usually causes it, how to fix it.\n- `logs` -- what the running application actually logged, with the request id threaded through.',
  '- `henri docs reference/errors` -- the catalogue: what a code means, what usually causes it, how to fix it.'
)}

A code you cannot find is not henri's: it belongs to the ORM, the driver or a package, and the stack is where to look.

## 2. Ask what is actually configured

${tools(
  facts,
  '- `doctor` -- the conventions check, without booting.\n- `config` -- what this application is really configured with, masked.\n- `models`, `routes`, `controllers` -- what henri thinks exists.',
  '- `henri doctor --json` -- the conventions check, without booting.\n- `henri routes --json` and `henri console` -- what henri thinks exists.'
)}

Most \`HENRI_CONFIG_*\` and \`HENRI_BOOT_*\` failures are answered here without running anything: a boot that fails names the module that failed, what was still running and what never started.

## 3. Reproduce it small

- A failing request: \`henri test\` with one file, or ${tools(facts, 'the `request` tool against the running application.', '`henri console` and a call by hand.')}
- A failing boot: \`henri analyze\` prints the module order, the timings and the critical path.
- A failing query: ${tools(facts, '`schema` says what the database holds and `query` runs SQL against the development server.', '`henri db:schema` says what the database holds.')}

## 4. The three that mislead

- **A 404 that should be a 403.** A policy refusal answers 404 on purpose, and in production its message is dropped, so a refusal and a missing record look identical. Check \`henri.can()\` before assuming the record is gone.
- **A refusal that reads like a bug.** henri refuses rather than guessing in a lot of places -- an unknown option, a mass write on a versioned model, a tenanted model with no tenant in scope. The code says which, and the catalogue says the way through.
- **Documentation that describes another henri.** \`henri doctor\` reports \`docs.version\` when the pages that would be printed come from a different package than the \`@usehenri/core\` this application runs.

## 5. Still stuck

\`henri doctor\`, \`henri audit --checks\` and \`henri analyze\` each answer a different question, and none of them boots the application into a state that can hide the problem. Read the guide for the area the code names -- \`henri docs guides/<area>\` -- rather than the whole reference.`,
    description:
      'Work a henri failure back to its cause: from a HENRI_* error code to the catalogue, then doctor, the configuration and a small reproduction. Use when a boot fails, a request 500s or 404s unexpectedly, a migration or a query is refused, or a command exits non-zero.',
    name: 'henri-diagnose-a-failure',
  },
  {
    body: (facts) =>
      facts.mcp
        ? `# Drive the running application

The \`henri\` MCP server that \`.mcp.json\` starts answers about **this** application, and several of its tools answer about the one that is *running*. Asking is faster and more accurate than reading source, because source does not know what the database holds or what the last request did.

## Ask, do not read

| Ask | Instead of |
| --- | --- |
| \`routes\` | reading and mentally expanding \`config/routes.js\` |
| \`models\` | opening every file in \`app/models\` |
| \`schema\` | guessing the physical table and column names |
| \`config\` | reading \`config/*.json\` and the environment |
| \`openapi\` | working out what an endpoint answers |
| \`types\` | guessing what a column is called |
| \`guide\` | recalling henri (this serves the version installed here) |
| \`errors\` | guessing what a \`HENRI_*\` code means |

## The live half

\`schema\`, \`query\`, \`records\`, \`runtime_routes\`, \`logs\` and \`request\` talk to a **development** server. If none is answering, one is started for you on the loopback interface. Two things follow, and both are deliberate:

- **They refuse a production application.** henri mounts no runtime endpoint outside development, and \`NODE_ENV=production\` is refused before anything is tried. There is no flag for it.
- **They are loopback only.** Nothing here is a way to reach a deployed application, and it is not meant to be.

Use them when the question is about *state*: what is in the table, what the last request answered, what the server logged. Use the file-reading tools when the question is about *code*.

## Change it through the generators

\`generate\` and \`destroy\` are tools too, and \`test\`, \`lint\` and \`doctor\` are the gates. Prefer them over hand-writing a file the generators own: they rewrite \`config/routes.js\` through prettier and they write the \`params\` block and the pages from the model file, which a hand edit gets wrong quietly.

## Do not

- Do not leave a development server running in a non-interactive session; the tools start and manage their own.
- Do not use \`query\` to change data you then assert on -- a test with a factory is the repeatable version.
- Do not treat what \`logs\` returns as the whole truth: the personal fields and the \`filterParameters\` are masked there on purpose.`
        : `# Drive the running application

This application does **not** have \`@usehenri/mcp\` installed, so there is no MCP server to ask and the command line is the whole surface. Install it (\`${facts.packages.length > 0 ? 'pnpm' : 'pnpm'} add -D @usehenri/mcp\`) and rerun \`henri generate skills\` to get the version of this procedure that uses it.

## Ask, do not guess

    henri routes --json        # the expanded routes, the helpers, the guards
    henri console              # the models, booted, in a REPL
    henri db:schema            # what the database really holds
    henri docs <page>          # the documentation at the version installed here
    henri doctor --json        # the conventions check, without booting
    henri analyze              # the module order, the timings, the critical path

## Change it through the generators

\`henri generate\` and \`henri destroy\` own \`config/routes.js\`, the pages and the controller's \`params\` block, and they write them from the model file. A hand edit gets that wrong quietly; \`--force\` is how a generated file catches up.

## Do not

- Do not leave \`henri server\` running in a non-interactive session -- \`henri test\` is how a change is verified.
- Do not read \`config/*.json\` and conclude that is the configuration: the environment is applied over it, and \`henri doctor\` reads both.`,
    description:
      'Use the henri MCP server and CLI to ask the running application what it is doing, rather than inferring it from source: routes, models, schema, config, logs and the last request. Use when you need the live state, the real table names, or what an endpoint actually answers.',
    name: 'henri-drive-the-app',
  },
];

/**
 * Everything a skill is, for one application: where it goes, what its
 * frontmatter says and what its region holds.
 *
 * @param {object} facts What describe() read
 * @param {string} [layout=DEFAULT_LAYOUT] The vendor
 * @returns {Array<object>} The skills
 */
const skillsFor = (facts, layout = DEFAULT_LAYOUT) => {
  const writer = LAYOUTS[layout];

  return SKILLS.map((skill) => ({
    description: skill.description,
    file: writer.file(skill.name),
    name: skill.name,
    prefix: writer.prefix({
      description: skill.description,
      name: skill.name,
    }),
    rendered: skill
      .body(facts)
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n'),
  }));
};

/**
 * The whole generated region of one skill, markers included
 *
 * @param {object} facts What describe() read
 * @param {object} skill What skillsFor() built
 * @returns {string} The region
 */
const region = (facts, skill) => MARKED.region(facts, skill.rendered);

/**
 * What writing the skills of an application would do, without doing any of
 * it. `henri doctor` asks this -- a check must never write -- and
 * `writeSkillFiles` is this plus the writing, so what doctor reports and
 * what the generator does can never be two different answers.
 *
 * @param {string} dir The application directory
 * @param {object} [options] Options
 * @param {boolean} [options.force=false] Overwrite what would be kept
 * @param {string} [options.layout=DEFAULT_LAYOUT] The vendor
 * @returns {Array<{action: string, content: ?string, file: string, reason: ?string}>} One entry per skill
 */
const plan = (dir, { force = false, layout = DEFAULT_LAYOUT } = {}) => {
  const facts = factsFor(dir);

  return skillsFor(facts, layout).map((skill) => {
    const location = path.join(dir, skill.file);
    const existing = fs.existsSync(location)
      ? fs.readFileSync(location, 'utf8')
      : null;
    const { action, content, reason } = MARKED.merge(existing, {
      facts,
      force,
      prefix: skill.prefix,
      rendered: skill.rendered,
    });

    return { action, content, file: skill.file, reason };
  });
};

/**
 * Write the skills of an application.
 *
 * The directory is the only input that decides the content, exactly as it
 * is for `AGENTS.md`: `henri new` calls this once the application is on
 * disk and `henri generate skills` calls it later, so a scaffolded skill
 * and a regenerated one are the same bytes.
 *
 * @param {string} dir The application directory
 * @param {object} [options] Options
 * @param {boolean} [options.force=false] Overwrite what would be kept
 * @param {string} [options.layout=DEFAULT_LAYOUT] The vendor
 * @returns {{created: Array<string>, updated: Array<string>, skipped: Array<object>}} What was written
 */
const writeSkillFiles = (dir, options = {}) => {
  const done = { created: [], skipped: [], updated: [] };

  for (const { action, content, file, reason } of plan(dir, options)) {
    if (content === null) {
      done.skipped.push({ file, reason });
      continue;
    }

    fs.outputFileSync(path.join(dir, file), content);
    done[action].push(file);
  }

  return done;
};

/**
 * What a generated region claims the application was, for `henri doctor`
 *
 * @param {string} source The skill content
 * @returns {?{app: string, format: number, gen: string}} The claim, or null
 */
const markerOf = (source) => MARKED.markerOf(source);

/**
 * The digest of what an application is now, in the format a marker carries
 *
 * @param {string} dir The application directory
 * @returns {{app: string, format: number}} The digest and its format
 */
const fingerprint = (dir) => ({
  app: digest(JSON.stringify(factsFor(dir))),
  format: FORMAT,
});

/**
 * Where the skills of an application live, without describing it. `henri
 * doctor` asks this: it needs the paths, not the content.
 *
 * @param {string} [layout=DEFAULT_LAYOUT] The vendor
 * @returns {Array<{file: string, name: string}>} The files
 */
const skillFiles = (layout = DEFAULT_LAYOUT) =>
  SKILLS.map((skill) => ({
    file: LAYOUTS[layout].file(skill.name),
    name: skill.name,
  }));

module.exports = {
  BUDGET,
  DEFAULT_LAYOUT,
  DESCRIPTION,
  FORMAT,
  LAYOUTS,
  SKILLS,
  fingerprint,
  markerOf,
  plan,
  region,
  skillFiles,
  skillsFor,
  writeSkillFiles,
};
