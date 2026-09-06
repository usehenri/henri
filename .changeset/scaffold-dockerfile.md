---
'@usehenri/cli': minor
---

`henri new` writes a Dockerfile, and the CLI becomes a dependency of the application

An application scaffolded with henri had no way to be deployed that henri had an opinion about, so everybody wrote the same forty lines. Rails has shipped one since 7.1.

The generated `Dockerfile` is a two stage build: install the production dependencies, compile the views with `henri build` (which needs no database), then a runtime image that runs as the `node` user with a health check on `/readyz` and no package manager left in it. `.dockerignore` keeps `node_modules`, `.env`, the credentials keys, `.henri` and the build output out of the context.

It is written for the application it belongs to. The install line matches the package manager `henri new` picked. An application on a store with a native driver gets a build toolchain in the build stage and only there, because `better-sqlite3` has no prebuilt binary for every node and platform pair. And an application on the zero-config store is told, at the top of the file, that this store runs a MongoDB inside the process and is not what an image runs on, with the two flags that pick a real one.

**`henri` moves from the development dependencies to the dependencies.** `henri server` is how the application runs, not a tool used to build it, so an image built with a production-only install has to have it, and `npm i -g henri` being present on whatever deploys is not something to rely on. Existing applications are unaffected; add `henri` to your `dependencies` if you deploy with `--omit=dev` or `--prod`.

Verified by building and running the generated image rather than by reading it: `docker build`, then `docker run`, then the endpoints. Two things it found on the way, both fixed here: the copied directory belonged to root so a store that writes beside the code could not start, and the sqlite driver needed a compiler the slim image does not carry.
