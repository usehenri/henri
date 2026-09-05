---
'@usehenri/testing': minor
'@usehenri/core': minor
'@usehenri/cli': minor
---

Tests run on Vitest. `henri test` spawns the app's Vitest with `NODE_ENV=test`
and exits with its code (extra arguments are passed through). `@usehenri/testing`
boots the app in-process and exports `setup`, `teardown`, `request`, `agent` and
`henri`, plus `@usehenri/testing/setup-file` for Vitest's `setupFiles` (henri and
the model globals are available in every test file). The core `tests` module no
longer loads jest at boot; jest is not a dependency anymore.
