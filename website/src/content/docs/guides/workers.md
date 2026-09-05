---
title: Workers
description: Background jobs under app/workers with start and stop hooks.
sidebar:
  order: 7
---

Files under `app/workers` are autoloaded, watched and reloaded. If a worker exports `start()` and `stop()`, they are called when the application boots, reloads and shuts down.

```js
// app/workers/heartbeat.js

let timer;

const start = (henri) => {
  henri.pen.info('heartbeat', 'worker started');
  timer = setInterval(() => henri.pen.warn('heartbeat', 'still alive'), 5000);
};

const stop = () => clearInterval(timer);

module.exports = { start, stop };
```

Both hooks receive the `henri` instance. `henri server --skip-workers` (or `SKIP_WORKERS=1`) boots without them, which is handy when a worker talks to an external service you do not want to hit while developing.
