---
'@usehenri/core': minor
'@usehenri/cli': minor
---

Modules order themselves by name, and the boot is introspectable

henri booted like SysV init: eight fixed run levels, every module hardcoding a number, each level starting together and waiting for the whole of the previous one. A module now says where it goes and henri computes the order.

- **`needs`** names the modules it cannot work without: they must be registered, and they finish before it starts. **`after`** and **`before`** order it without requiring anything, which is the half a dependency cannot express — `before: ['router']` is how a module registers a middleware in time. Everything the graph does not separate starts at the same time.
- **`runlevel` keeps working**, as a supported way to pin and not a shim: a module that names nothing is ordered by its number alone, after every module of a lower level and before every module of a higher one, exactly as before. The number also stays the module's slot, which is what `new Henri({ runlevel })` and other people's numeric pins are measured against.
- **The graph is built before anything starts.** A name nobody provides, a dependency the boot ceiling left out, or a cycle fails the boot with the modules named, the loaded modules listed and a suggestion for a typo. A boot that fails halfway names the module that threw, what was still running and what never started.
- **Applications and packages join the boot** through `config/modules.js`, which lists module instances, module classes or the names of packages exporting one (issue #54). They take part in reload and shutdown like henri's own.
- **`henri analyze`** (and `henri.analyze()`) prints what the boot did: the order, how long each module took, what it waited on and why, which dependency actually held it up, the critical path and the level chart. `henri analyze <module>` answers it for one module, `--json` for a script, `--level` for a partial boot.
- **A reload is ordered by the same graph**, and modules can implement `release()`: it is called on every module that has one, backwards, before anything rebuilds under it. A module implementing neither `reload()` nor `release()` sees no difference.
- **Shutdown is the reverse of the graph** rather than a fold over the levels, so a module always stops before the ones it depends on — the HTTP server now closes before the stores it talks to. It still continues past a module that throws and reports every error.
- The legacy `tests` module (level 7) is removed: `henri test` runs Vitest and `@usehenri/testing` boots the application. The levels now go from 0 to 6.
