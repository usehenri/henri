---
'@usehenri/react': patch
---

The published bundle no longer carries the development JSX runtime. `@babel/preset-react` 8 turns `development` on by default, which emitted `jsxDEV()` calls into the build, and a production `next build` of an application using the package then failed with `jsxDevRuntime.jsxDEV is not a function` while prerendering. The preset is now configured explicitly.
