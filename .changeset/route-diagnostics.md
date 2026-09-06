---
'@usehenri/core': patch
---

Two things the routes file used to do quietly.

A route declared twice now warns at boot when the later entry points at a different controller, naming both entries and both controllers. Later still wins, which is what lets a line correct a `resources` block above it, and repeating the same entry stays silent.

A controller name is now checked where it is written. `{ controller: 'ship ' }` used to travel all the way to the loader and surface as a missing controller, sending you to look for a file that was right there; it now fails at boot naming the route and saying what a controller name may contain. The same applies to the action after the `#`.
