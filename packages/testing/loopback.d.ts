/**
 * Binds every test server to the loopback address rather than the wildcard, so
 * that no other process on the machine can answer a test's requests. Importing
 * the module applies it; calling it again answers `false`.
 */
declare function bindTestServersToLoopback(): boolean;

declare namespace bindTestServersToLoopback {
  const bindTestServersToLoopback: () => boolean;
}

export = bindTestServersToLoopback;
