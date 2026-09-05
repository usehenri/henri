---
title: Workers
description: Background jobs under app/workers with start and stop hooks.
sidebar:
  order: 8
---

Files under `app/workers` (subdirectories included) are loaded when the application boots, in alphabetical order, and reloaded when they change. A worker exports `start(henri)` and `stop(henri)`; `start` is awaited before the next worker starts, `stop` is called on reload and on shutdown. A `name` is used in the logs instead of the file name.

```bash
henri generate worker heartbeat   # writes app/workers/heartbeat.js
henri destroy worker heartbeat
```

```js
// app/workers/heartbeat.js
let timer = null;

module.exports = {
  name: 'heartbeat',

  start: async (henri) => {
    henri.pen.info('heartbeat', 'started');
    timer = setInterval(() => henri.pen.info('heartbeat', 'tick'), 60000);
  },

  stop: async (henri) => {
    clearInterval(timer);
    timer = null;
    henri.pen.info('heartbeat', 'stopped');
  },
};
```

A worker without a `start` function is loaded and reported, not started. A `stop` that throws is logged and does not prevent the others from stopping.

`henri server --skip-workers` (or `SKIP_WORKERS=1`) boots without them, which is handy when a worker talks to an external service you do not want to hit while developing. `@usehenri/testing` skips them too unless `setup({ workers: true })` is called.
