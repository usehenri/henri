---
title: Duplicate module
description: Two modules tried to register under the same name.
sidebar:
  hidden: true
pagefind: false
---

```text
modules => duplicate <name> ...
you have a module trying to load over another...
```

henri exposes every module as `henri.<name>`, so module names must be unique. This error stops the boot when:

- two modules declare the same `name`, or
- a module's `name` collides with an existing property of the `henri` instance (`config`, `pen`, `model`, `router`, `utils`, `validator`, ...).

The two log lines before the error give the file and line where each module was registered.

## Fix

Rename one of the modules, or make sure you only call `henri.modules.add()` once per module. If the collision comes from a package you installed, check that you are not adding the same package twice, for example once from your code and once from a plugin.

See [Under the hood](/reference/under-the-hood/) for how modules are registered.
