// `globalSetup: ['@usehenri/testing/global-setup']`: boots henri once in
// Vitest's main process and publishes its url through `HENRI_TEST_URL`, so the
// workers reach it over http but get no `henri` global.

/** Boots the application and returns Vitest's teardown callback. */
declare function globalSetup(): Promise<() => Promise<boolean>>;

export default globalSetup;
