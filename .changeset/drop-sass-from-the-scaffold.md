---
'@usehenri/inertia': patch
'@usehenri/react': patch
'@usehenri/cli': patch
---

Both view engines warned at every boot that `sass` was missing, whether or not the application had any `.scss` to compile. Since the scaffold styles with Tailwind and writes no Sass, a new app carried the dependency only to silence that warning. The engines now look for an authored `.scss` under `app/views` first, skipping build output, and `henri new` no longer adds `sass`. An app that writes Sass keeps working and still gets the warning when the package is missing.
