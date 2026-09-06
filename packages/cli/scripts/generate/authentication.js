// The files `henri generate authentication` writes into an application: the
// pages of the three account flows, the controller that renders them, the
// mailer and its views, the user model when there is none, and a test suite
// covering the security properties rather than the happy path.
//
// The endpoints themselves are henri's (`config.user.signup`,
// `passwordReset` and `confirmation`, see base/accounts.js in @usehenri/core),
// so nothing generated here reimplements a token, a hash or a session. The
// forms below post to them as plain browser forms, which is why the same page
// body works under both renderers.

/** The class names of the generated pages */
const TOKENS = `const primary =
  'inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200';
const card =
  'rounded-xl border border-zinc-200 p-6 dark:border-zinc-800';
const notice =
  'rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900';
const problem =
  'rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200';`;

/** The two a form needs, and the input that uses them */
const FIELD = `const field =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10';
const label = 'text-sm font-medium';`;

/** The labelled input the pages with a form share */
const INPUT = `/**
 * One labelled input, with the error the server sent under it
 *
 * @param {object} props The props
 * @returns {React.ReactElement} The field
 */
function Field({ errors = {}, name, title, ...rest }) {
  return (
    <div className="mt-4">
      <label className={label} htmlFor={name}>
        {title}
      </label>
      <input className={\`\${field} mt-1\`} id={name} name={name} {...rest} />
      {errors[name] && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">
          {errors[name]}
        </p>
      )}
    </div>
  );
}`;

/**
 * The styles a page needs.
 *
 * A page with no form gets neither the `Field` component nor the two class
 * names only it uses: a scaffolded application lints what it was given, and
 * an unused const is an error there.
 *
 * @param {string} body The body of the page
 * @returns {string} The declarations above it
 */
const styles = (body) =>
  body.includes('<Field')
    ? `${FIELD}\n${TOKENS}\n\n${INPUT}`
    : TOKENS;

/** How a prop is declared when a page asks for it */
const PROPS = {
  csrf: 'csrf',
  data: 'data = {}',
  errors: 'errors',
  flash: 'flash = {}',
  query: 'query = {}',
};

/**
 * Wraps a page body in the idiom of a renderer.
 *
 * Both get the same values: henri hands `csrf`, `data`, `errors`, `flash` and
 * `query` to a page whichever engine renders it, as props under the React
 * renderer and through `useHenri()` under Inertia. A page only names the ones
 * it uses, because the linter of a scaffolded application says so.
 *
 * @param {object} options { body, name, props, renderer }
 * @returns {string} The page
 */
const page = ({ body, name, props, renderer }) => {
  const inertia = renderer === 'inertia';
  const taken = props.map((prop) => PROPS[prop]).join(', ');
  const header = inertia
    ? `import { useHenri } from '@usehenri/inertia';`
    : `import withHenri from '@usehenri/react';`;
  const open = inertia
    ? `export default function ${name}() {
  const { ${taken} } = useHenri();
`
    : `function ${name}({ ${taken} }) {
`;
  const close = inertia ? `}` : `}

export default withHenri(${name});`;

  return `${header}

${styles(body)}

${open}${body}
${close}
`;
};

/**
 * The messages a redirect left behind, rendered above a form
 *
 * `flash.notice` and `flash.alert` are lists (one message may be queued more
 * than once between two renders).
 */
const MESSAGES = `      {(flash.notice || []).map((message) => (
        <p className={\`\${notice} mt-6\`} key={message}>
          {message}
        </p>
      ))}
      {(flash.alert || []).map((message) => (
        <p className={\`\${problem} mt-6\`} key={message}>
          {message}
        </p>
      ))}`;

/**
 * The hidden field the double submit csrf check reads
 */
const CSRF = `        {csrf && <input name="_csrf" type="hidden" value={csrf} />}`;

/**
 * The buttons of the identity providers, rendered from what the controller
 * read out of the configuration.
 *
 * Each is a form and not a link, because leaving for a provider is a `POST`:
 * henri answers 405 to a `GET`, so a third-party page cannot make a
 * visitor's browser start an authentication. Only a provider that may open a
 * session on its own is here; one declared `allows: "verify"` is linked from
 * the connections page and never signs anybody in.
 */
const PROVIDERS = `      {(data.providers || []).length > 0 && (
        <div className="mt-8">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Or continue with
          </p>
          {(data.providers || []).map((provider) => (
            <form
              action={\`/auth/\${provider.name}\`}
              className="mt-2"
              key={provider.name}
              method="post"
            >
              {csrf && <input name="_csrf" type="hidden" value={csrf} />}
              <button className={\`\${primary} w-full\`} type="submit">
                {provider.label}
              </button>
            </form>
          ))}
        </div>
      )}`;

/** The sign in page: the form henri's own POST /login answers */
const login = () => `  const failed = query.error === 'invalid';
  const unconfirmed = query.error === 'unconfirmed';
  const refused = data.messages[query.error];

  return (
    <main className="mx-auto w-full max-w-md px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
${MESSAGES}
      {failed && (
        <p className={\`\${problem} mt-6\`}>
          That email and password did not match.
        </p>
      )}
      {unconfirmed && (
        <p className={\`\${problem} mt-6\`}>
          Confirm your email address before signing in. Ask for the message
          again on the <a className="underline" href="/confirm">confirmation page</a>.
        </p>
      )}
      {refused && <p className={\`\${problem} mt-6\`}>{refused}</p>}

      <form action="/login" className={\`\${card} mt-6\`} method="post">
${CSRF}
        <Field
          autoComplete="username"
          name="email"
          required
          title="Email"
          type="email"
        />
        <Field
          autoComplete="current-password"
          name="password"
          required
          title="Password"
          type="password"
        />
        <button className={\`\${primary} mt-6 w-full\`} type="submit">
          Sign in
        </button>
      </form>

${PROVIDERS}

      <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
        <a className="underline" href="/signup">Create an account</a>
        {' · '}
        <a className="underline" href="/password/forgot">Forgot your password?</a>
      </p>
    </main>
  );`;

/** The registration page */
const signup = () => `  const values = (flash.values && flash.values[0]) || {};
  const fields = data.fields || [];

  return (
    <main className="mx-auto w-full max-w-md px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Create an account</h1>
${MESSAGES}

      <form action="/signup" className={\`\${card} mt-6\`} method="post">
${CSRF}
        {fields.map((name) => (
          <Field
            defaultValue={values[name] || ''}
            errors={errors || {}}
            key={name}
            name={name}
            title={name.charAt(0).toUpperCase() + name.slice(1)}
          />
        ))}
        <Field
          autoComplete="email"
          defaultValue={values.email || ''}
          errors={errors || {}}
          name="email"
          required
          title="Email"
          type="email"
        />
        <Field
          autoComplete="new-password"
          errors={errors || {}}
          minLength={data.minLength}
          name="password"
          required
          title={\`Password (\${data.minLength} characters or more)\`}
          type="password"
        />
        <button className={\`\${primary} mt-6 w-full\`} type="submit">
          Sign up
        </button>
      </form>

      <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
        Already have one? <a className="underline" href="/login">Sign in</a>.
      </p>
    </main>
  );`;

/** The "I forgot my password" page */
const forgot = () => `  return (
    <main className="mx-auto w-full max-w-md px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Tell us the address of the account and we will send a link to it. The
        answer is the same whether or not the address is registered, on
        purpose.
      </p>
${MESSAGES}

      <form action="/password/forgot" className={\`\${card} mt-6\`} method="post">
${CSRF}
        <Field
          autoComplete="email"
          errors={errors || {}}
          name="email"
          required
          title="Email"
          type="email"
        />
        <button className={\`\${primary} mt-6 w-full\`} type="submit">
          Send the link
        </button>
      </form>

      <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
        <a className="underline" href="/login">Back to sign in</a>
      </p>
    </main>
  );`;

/**
 * The "choose a new password" page.
 *
 * The token is not in this url: henri took it out of the link, checked it and
 * put it in the session, so it cannot leak through a `Referer` or the
 * browser history.
 */
const reset = () => `  return (
    <main className="mx-auto w-full max-w-md px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Everything else signed in to this account is signed out when you save.
      </p>
${MESSAGES}

      <form action="/password/reset" className={\`\${card} mt-6\`} method="post">
${CSRF}
        <Field
          autoComplete="new-password"
          errors={errors || {}}
          minLength={data.minLength}
          name="password"
          required
          title={\`New password (\${data.minLength} characters or more)\`}
          type="password"
        />
        <button className={\`\${primary} mt-6 w-full\`} type="submit">
          Save it
        </button>
      </form>
    </main>
  );`;

/** The "check your inbox" page, which also asks for the message again */
const confirm = () => `  return (
    <main className="mx-auto w-full max-w-md px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Confirm your address</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Follow the link in the message we sent. Nothing arrived? Ask for
        another one.
      </p>
${MESSAGES}

      <form action="/confirm" className={\`\${card} mt-6\`} method="post">
${CSRF}
        <Field
          autoComplete="email"
          defaultValue={data.email || ''}
          errors={errors || {}}
          name="email"
          required
          title="Email"
          type="email"
        />
        <button className={\`\${primary} mt-6 w-full\`} type="submit">
          Send it again
        </button>
      </form>
    </main>
  );`;

/**
 * The account page of the identity providers: what is linked, what can be,
 * and the one button that takes a link away.
 *
 * Linking is the same `POST /auth/:provider` the sign-in page uses. It
 * behaves differently only because there is a session: henri links the
 * provider to the account holding it, whatever address the provider
 * asserts, and that session is the consent -- which is why a callback with
 * no session and a known address is refused instead.
 */
const connections = () => `  const linked = data.linked || [];
  const available = data.available || [];

  return (
    <main className="mx-auto w-full max-w-md px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Sign-in methods</h1>
${MESSAGES}

      <div className={\`\${card} mt-6\`}>
        {linked.length === 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No provider is linked to this account.
          </p>
        )}
        {linked.map((entry) => (
          <form
            action={\`/auth/\${entry.provider}/unlink\`}
            className="flex items-center justify-between py-2"
            key={entry.provider}
            method="post"
          >
            {csrf && <input name="_csrf" type="hidden" value={csrf} />}
            <span className="text-sm">
              {entry.label}
              {entry.linkedAt && (
                <span className="text-zinc-500"> · linked {entry.linkedAt}</span>
              )}
            </span>
            <button className="text-sm underline" type="submit">
              Unlink
            </button>
          </form>
        ))}
      </div>

      {available.length > 0 && (
        <div className="mt-8">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Link another way to sign in
          </p>
          {available.map((provider) => (
            <form
              action={\`/auth/\${provider.name}\`}
              className="mt-2"
              key={provider.name}
              method="post"
            >
              {csrf && <input name="_csrf" type="hidden" value={csrf} />}
              <button className={\`\${primary} w-full\`} type="submit">
                {provider.label}
              </button>
            </form>
          ))}
        </div>
      )}

      {available.length === 0 && linked.length === 0 && (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          This application has no identity provider configured. Add one under
          config.user.identities.providers, and keep its client secret in the
          encrypted credentials (henri credentials:edit).
        </p>
      )}
    </main>
  );`;

/**
 * The pages, by the action of the controller that renders them: what the
 * component is called, what henri hands it, and its body
 */
const PAGES = {
  confirm: { body: confirm, name: 'Confirm', props: ['csrf', 'data', 'errors', 'flash'] },
  connections: { body: connections, name: 'Connections', props: ['csrf', 'data', 'flash'] },
  forgot: { body: forgot, name: 'Forgot', props: ['csrf', 'errors', 'flash'] },
  login: { body: login, name: 'Login', props: ['csrf', 'data', 'flash', 'query'] },
  new: { body: signup, name: 'Signup', props: ['csrf', 'data', 'errors', 'flash'] },
  reset: { body: reset, name: 'Reset', props: ['csrf', 'data', 'errors', 'flash'] },
};

/**
 * A page of the account flows
 *
 * @param {object} options { action, renderer }
 * @returns {string} The page
 */
const view = ({ action, renderer }) => {
  const { body, name, props } = PAGES[action];

  return page({ body: body(), name, props, renderer });
};

/**
 * The controller rendering those pages.
 *
 * It has no `create`, no `update` and no token handling: henri mounts
 * `POST /signup`, `POST /password/forgot`, `GET /password/reset/:token`,
 * `POST /password/reset`, `GET /confirm/:token`, `POST /confirm` and
 * `POST /account/email` itself. This is the part an application owns.
 *
 * @returns {string} The controller
 */
const controller = () => `// The pages of the account flows. henri owns the endpoints behind them
// (config.user.signup, passwordReset and confirmation); an action here only
// says what its page needs to render.
//
// The whole service is on \`henri.accounts\` when you would rather answer
// these yourself: register(), requestPasswordReset(), resetPassword(),
// confirm(), requestConfirmation() and requestEmailChange().
//
// The same goes for the identity providers: henri mounts
// \`POST /auth/:provider\`, \`GET /auth/:provider/callback\` and
// \`POST /auth/:provider/unlink\`, and \`henri.identities\` is the service
// behind them. The pages here only read what is configured; nothing is
// mounted until config.user.identities names a provider.
module.exports = {
  before: {
    connections: [
      (req, res) => {
        if (!req.user) {
          return res.redirect('/login');
        }
      },
    ],
    'login,new': [
      (req, res) => {
        if (req.user) {
          return res.redirect('/');
        }
      },
    ],
  },

  confirm: (req) => ({ email: (req.user && req.user.email) || null }),

  // What is linked to this account and what could be. henri.identities
  // hands back the providers without their client secrets, and an identity
  // without the subject the provider issued: that subject is the credential
  // and a page has no use for it
  connections: async (req) => {
    const held = await henri.identities.forUser(req.user);
    const labels = new Map(
      henri.identities.providers().map((one) => [one.name, one.label])
    );

    return {
      available: henri.identities
        .providers()
        .filter((one) => !held.some((entry) => entry.provider === one.name)),
      linked: held.map((entry) => ({
        label: labels.get(entry.provider) || entry.provider,
        linkedAt: entry.linkedAt
          ? new Date(entry.linkedAt).toISOString().slice(0, 10)
          : null,
        provider: entry.provider,
      })),
    };
  },

  forgot: () => ({}),

  // The buttons of the sign-in page are whatever config.user.identities
  // names, and only the providers that may open a session on their own.
  // \`messages\` is what a refused callback comes back with in ?error=
  login: () => ({
    messages: {
      exists:
        'An account already exists for that address. Sign in, then link that provider from your account.',
      exchange: 'That provider could not be reached. Try again.',
      locked: 'Too many failed sign-in attempts. Try again later.',
      state: 'That sign-in took too long. Try again.',
      unverified:
        'That provider did not confirm your address. Sign in, then link it from your account.',
    },
    providers: henri.identities
      .providers()
      .filter((provider) => provider.allows === 'signin'),
  }),

  // The signup form asks for the fields config.user.signup.fields permits,
  // and shows the minimum length the password policy asks for
  new: () => ({
    fields: henri.accounts.settings.signup.fields,
    minLength: henri.accounts.policy().minLength,
  }),

  reset: () => ({ minLength: henri.accounts.policy().minLength }),
};
`;

/**
 * The user model, when the application has none yet
 *
 * @returns {string} The model
 */
const model = () => `// The store adds \`email\` (unique, lowercased), \`password\` (hashed, never
// selected), \`roles\` (never mass-assignable), \`confirmedAt\` and
// \`passwordChangedAt\`. Everything below is yours; list in
// config.user.signup.fields the ones a signup form may set.
//
// \`personal: true\` is what tells henri a field is about a person: it is
// masked in the logs, it is in what \`henri privacy:export\` hands back and
// it is erased by \`henri privacy:erase\`. Add it to every field that is.
// https://usehenri.io/guides/privacy/

/** @type {import('@usehenri/core').ModelFile} */
module.exports = {
  options: { timestamps: true },
  schema: {
    name: { personal: true, type: 'string' },
  },
  store: 'default',
};
`;

/**
 * The overridable copy of henri's account mailer
 *
 * @returns {string} The mailer
 */
const mailer = () => `// henri ships these three messages; this file replaces them. Delete an action
// and henri's own comes back, edit one and yours is used. Each receives the
// public user and the absolute url of the link.
//
// The views are app/views/mailers/auth/<action>.hbs, previewable on
// /_mailers in development.
module.exports = {
  confirm(user, url) {
    return {
      data: { url, user },
      subject: 'Confirm your email address',
      to: user.email,
    };
  },

  defaults: {
    // Or set it once in config.mailers.from
    from: 'no-reply@example.com',
  },

  emailChange(user, url) {
    return {
      data: { url, user },
      subject: 'Confirm your new email address',
      to: user.email,
    };
  },

  previews: {
    confirm: () => [
      { email: 'ada@example.com' },
      'https://example.com/confirm/h1.token.signature',
    ],
    emailChange: () => [
      { email: 'ada@example.com' },
      'https://example.com/confirm/h1.token.signature',
    ],
    reset: () => [
      { email: 'ada@example.com' },
      'https://example.com/password/reset/h1.token.signature',
    ],
  },

  reset(user, url) {
    return {
      data: { url, user },
      subject: 'Reset your password',
      to: user.email,
    };
  },
};
`;

/** The mail views written next to the mailer, by action */
const MAIL_VIEWS = {
  confirm: `<h1>Confirm your address</h1>
<p>Hello,</p>
<p>Follow this link to confirm <b>{{user.email}}</b>.</p>
<p><a href="{{url}}">Confirm my address</a></p>
<p>If the link does not open, copy this address into your browser:</p>
<p>{{url}}</p>
`,
  emailChange: `<h1>Confirm your new address</h1>
<p>Hello,</p>
<p>
  Someone asked to use <b>{{user.email}}</b> for their account. The change
  takes effect when this link is followed, and not before.
</p>
<p><a href="{{url}}">Confirm this address</a></p>
<p>{{url}}</p>
`,
  reset: `<h1>Reset your password</h1>
<p>Hello,</p>
<p>
  Someone asked to reset the password of the account for <b>{{user.email}}</b>.
</p>
<p><a href="{{url}}">Choose a new password</a></p>
<p>{{url}}</p>
<p>The link works once and expires shortly.</p>
`,
};

/**
 * The suite covering the flows: the properties, not the happy path
 *
 * @returns {string} The test file
 */
const test = () => `// The account flows. henri owns the endpoints, so what is worth testing here
// is what a mistake in the configuration would break: that a form cannot
// grant itself a role, that a reset link works once, and that the answer to a
// reset request is the same for an address that exists and one that does not.
// \`henri\` is a global once setup() booted the application, like in any
// henri process
const { setup, teardown, request } = require('@usehenri/testing');

/** Every message the flows handed to the delivery handler */
const mails = [];

/** Pulls the signed token out of a message */
const TOKEN = /h1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/;

let count = 0;

/**
 * An address nobody used yet
 *
 * @returns {string} The address
 */
const address = () => {
  count += 1;

  return \`ada-\${count}@example.com\`;
};

/**
 * The token of the last message that was sent
 *
 * @returns {Promise<string>} The token
 */
const lastToken = async () => {
  await henri.accounts.drain();

  const last = mails[mails.length - 1];

  return TOKEN.exec(\`\${last.text}\\n\${last.html}\`)[0];
};

beforeAll(async () => {
  await setup();
  // The mails are read here instead of being delivered
  henri.mailers.onDeliverLater((message) => mails.push(message));
}, 60000);

afterAll(async () => {
  await teardown();
}, 60000);

beforeEach(() => {
  mails.length = 0;
});

test('registration creates an account and drops what it may not set', async () => {
  const email = address();
  const res = await request()
    .post('/signup')
    .send({ email, password: 'a-long-enough-password', roles: ['admin'] });

  expect(res.status).toBe(201);
  expect(res.body.user.email).toBe(email);
  expect(res.body.user.roles).not.toContain('admin');
});

test('the same address cannot be registered twice', async () => {
  const email = address();

  await request().post('/signup').send({ email, password: 'a-long-enough-password' });

  const res = await request()
    .post('/signup')
    .send({ email, password: 'a-long-enough-password' });

  expect(res.status).toBe(422);
  expect(res.body.data.errors.email).toBeTruthy();
});

test('a reset request answers the same for a known and an unknown address', async () => {
  const email = address();

  await request().post('/signup').send({ email, password: 'a-long-enough-password' });

  const known = await request().post('/password/forgot').send({ email });
  const unknown = await request()
    .post('/password/forgot')
    .send({ email: 'nobody@example.com' });

  expect(known.status).toBe(202);
  expect(unknown.status).toBe(known.status);
  expect(unknown.body).toEqual(known.body);
});

test('a reset link works once, and the new password is the one that works', async () => {
  const email = address();

  await request().post('/signup').send({ email, password: 'a-long-enough-password' });
  await request().post('/password/forgot').send({ email });

  const token = await lastToken();

  await request()
    .post('/password/reset')
    .send({ password: 'a-brand-new-password', token })
    .expect(200);

  const again = await request()
    .post('/password/reset')
    .send({ password: 'another-password-again', token });

  expect(again.status).toBe(400);

  await request()
    .post('/login')
    .send({ email, password: 'a-brand-new-password' })
    .expect(200);
});
`;

module.exports = {
  MAIL_VIEWS,
  controller,
  mailer,
  model,
  page,
  test,
  view,
};
