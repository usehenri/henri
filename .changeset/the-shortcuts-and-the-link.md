---
'@usehenri/core': patch
---

The development server's shortcut list says Ctrl on every platform, and names the two it never mentioned

The listener reads the control characters stdin sends in raw mode -- 3, 14, 15
and 18 -- so `Cmd+R`, `Cmd+O` and `Cmd+C`, which is what it printed on macOS,
named shortcuts that could not work: a terminal never delivers Cmd as a
character. It also binds a plain `r` (the loaded routes) and a plain `u` (the
unknown ones), which the list left out entirely.

`HENRI_CONFIG_INVALID` pointed at a page that does not exist
(`/reference/configuration/` rather than `/configuration/`), so the failure
that fires when a configuration is wrong sent people to a 404.
