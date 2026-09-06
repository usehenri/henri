// The declarations of @usehenri/react, @usehenri/inertia and
// @usehenri/testing, checked. See core.test-d.ts for how `@ts-expect-error`
// is used here.

import withHenri, {
  RequestError,
  request,
  useHenri,
  type HenriView,
  type PathHelper,
} from '@usehenri/react';
import {
  Button,
  Form,
  FormError,
  Input,
  Radio,
  Select,
  messageFor,
  sanitize,
  useForm,
  type FormState,
} from '@usehenri/react/forms';
import { build, type BuildResult } from '@usehenri/react/engine';
import {
  createTranslator,
  useTranslation,
  type Translate,
} from '@usehenri/react/i18n';
import {
  Link,
  pathFor,
  resolvePage,
  useHenri as useInertiaHenri,
  useTranslation as useInertiaTranslation,
  Form as InertiaForm,
  request as inertiaRequest,
  type ViewLocale,
} from '@usehenri/inertia';
import { henriViteConfig } from '@usehenri/inertia/vite';
import InertiaEngine from '@usehenri/inertia/engine';
import withHenriSubpath from '@usehenri/react/withHenri';
import bindTestServersToLoopback from '@usehenri/testing/loopback';
import globalSetup from '@usehenri/testing/global-setup';
import '@usehenri/testing/setup-file';
import {
  agent,
  build as buildRecord,
  create,
  createList,
  defineFactory,
  request as testRequest,
  resetFactories,
  setup,
  teardown,
  type FactoryAttributes,
  type FactoryContext,
} from '@usehenri/testing';
import type { Henri } from '@usehenri/core';

/** Asserts that `Actual` and `Expected` are the same type. */
declare function expectType<Expected>(value: Expected): void;

// --- @usehenri/react --------------------------------------------------------

const Tasks = ({ data, pathFor: pathForProp, user }: any) => (
  <a href={String(pathForProp('index_tasks_path', {}))}>
    {user ? user.email : 'anonymous'} {String(data.count)}
  </a>
);

export default withHenri(Tasks);

declare const view: HenriView;
expectType<string | null>(view.csrf);
expectType<Record<string, any>>(view.data);
expectType<PathHelper | string | undefined>(
  view.pathFor('show_tasks_path', '1')
);
expectType<string>(view.getRoute('index_tasks_path'));
expectType<Promise<any | null>>(view.hydrate());
expectType<HenriView>(useHenri());
expectType<Promise<any>>(
  request({ route: '/tasks', method: 'post', body: {} })
);

declare const requestError: RequestError;
expectType<number>(requestError.status);
expectType<number>(requestError.statusCode);
expectType<string | null>(requestError.error);

// @ts-expect-error `useHenri()` has no `query` (that is the Inertia one)
view.query;

// @ts-expect-error `request()` takes an options object, not a path
request('/tasks');

// --- @usehenri/react/forms --------------------------------------------------

declare const form: FormState;
expectType<Record<string, any>>(form.data);
expectType<boolean>(form.disabled);
expectType<string | true | null>(form.error);
expectType<Record<string, string | null>>(form.errors);
expectType<FormState>(useForm());
expectType<Record<string, any>>(
  sanitize({ title: ' a ' }, { title: { trim: true } })
);
expectType<string>(messageFor({ isEmail: 'not an email' }, 'isEmail'));

export const NewTask = () => (
  <Form action="/tasks" method="post" data={{ title: '' }} onFail="Try again">
    <Input name="title" required validation={{ isLength: { min: 3 } }} />
    <Select name="status" choices={['todo', 'done']} placeholder="Pick one" />
    <Radio name="high" group="priority" label="High" />
    <FormError />
    <Button label="Save" />
  </Form>
);

// @ts-expect-error `Input` needs a `name`
export const NamelessInput = () => <Input required />;

// @ts-expect-error a radio button belongs to a `group`
export const GrouplessRadio = () => <Radio name="high" />;

// @ts-expect-error `choices` is a list
export const BadSelect = () => <Select name="status" choices="todo" />;

expectType<Promise<BuildResult | null>>(
  build({ cwd: '/app', config: { renderer: 'react' } })
);

// --- @usehenri/inertia ------------------------------------------------------

const inertiaView = useInertiaHenri();
expectType<Record<string, any>>(inertiaView.query);
expectType<Record<string, any>>(inertiaView.errors);
expectType<Promise<any>>(
  inertiaRequest('/tasks', { method: 'post', data: {} })
);
expectType<Promise<any> | any>(
  resolvePage({}, 'tasks/index', { dir: './pages' })
);
expectType<PathHelper | string | undefined>(
  pathFor({}, 'show_tasks_path', '1')
);

export const InertiaPage = () => (
  <InertiaForm action={pathFor({}, 'create_tasks_path')} method="post">
    <Link href="/tasks">Back</Link>
  </InertiaForm>
);

// @ts-expect-error the Inertia view has no `error` key, a failed request throws
inertiaView.error;

// @ts-expect-error `henriViteConfig` takes options, not a path
henriViteConfig('app/views');

// --- the client half of i18n ------------------------------------------------

const { locale, ready, t } = useTranslation();

expectType<string>(locale);
expectType<boolean>(ready);
expectType<string>(t('greeting', { name: 'Ada' }));
expectType<string>(t('notes', { count: 2 }, { ordinal: false }));
expectType<string>(t('nav.home', {}, { default: 'Home' }));
expectType<Translate>(createTranslator({ locale: 'fr', messages: {} }));

// @ts-expect-error a key is a string, and the values come second
t(42);

const inertiaTranslation = useInertiaTranslation();

expectType<string>(inertiaTranslation.t('greeting'));
expectType<ViewLocale | null>(inertiaView.i18n);

// @ts-expect-error the catalogue is what the page carries, not a promise
const badLocale: ViewLocale = { locale: 'fr', messages: 1, source: 'query' };

// --- @usehenri/testing ------------------------------------------------------

expectType<Promise<Henri>>(setup());
expectType<Promise<Henri>>(setup({ workers: true }));
expectType<Promise<boolean>>(teardown());
expectType<Promise<unknown>>(testRequest().get('/tasks').expect(200));
expectType<Promise<unknown>>(
  agent().post('/login').send({ email: 'a@b.co', password: 'secret' })
);

// @ts-expect-error `setup()` only knows about `workers`
setup({ port: 3000 });

// @ts-expect-error `teardown()` takes nothing
teardown(true);

expectType<Promise<FactoryAttributes>>(buildRecord('proposal'));
expectType<Promise<unknown>>(create('proposal'));
expectType<Promise<unknown>>(
  create('proposal', 'accepted', { title: 'A talk' })
);
expectType<Promise<unknown[]>>(createList('proposal', 3, 'accepted'));
expectType<void>(resetFactories());
defineFactory('proposal', {
  after: async (record: { id: number }, { traits }: FactoryContext) =>
    traits.length > 0 ? record : undefined,
  attributes: {
    speakerId: async ({ create: nested }: FactoryContext) =>
      (await nested('user')).id,
    title: ({ sequence }: FactoryContext) => `A proposal ${sequence}`,
  },
  model: 'Proposal',
  traits: { accepted: { state: 'accepted' } },
});

// @ts-expect-error a factory needs its `attributes`
defineFactory('proposal', { model: 'Proposal' });

// @ts-expect-error `createList()` counts with a number
createList('proposal', 'three');

// --- the subpaths, so that every shipped declaration is compiled -----------

expectType<typeof withHenri>(withHenriSubpath);
expectType<boolean>(bindTestServersToLoopback());
expectType<Promise<() => Promise<boolean>>>(globalSetup());
expectType<string>(InertiaEngine.componentName('/tasks/'));
expectType<Promise<{ client: string; duration: number; ssr: string | null }>>(
  InertiaEngine.build({ cwd: '/app' })
);
expectType<boolean>(InertiaEngine.DEFAULTS.ssr);
