# syntax=docker/dockerfile:1
#
# A henri app in production mode, from a fresh `henri new` scaffold.
#
#   docker build -t henri-app docker
#   docker run --rm -p 3000:3000 \
#     -e HENRI_STORE_URL=mongodb://host.docker.internal:27017/app henri-app
#
# To containerize your own app, copy this file and entrypoint.sh to its root
# and replace the `henri new app --skip-install` step with `COPY . .` (keep
# the .dockerignore next to it).
#
# Runtime configuration. @usehenri/core reads config/<NODE_ENV>.json and does
# not expand environment variables, so entrypoint.sh writes
# config/production.json from these variables every time the container starts:
#
#   HENRI_STORE_URL      connection string of the default store, for example
#                        mongodb://mongo:27017/app or
#                        postgres://user:pass@db:5432/app. Without it the app
#                        starts without a store: fine for the scaffold page,
#                        not for an app with models.
#   HENRI_STORE_ADAPTER  adapter of the default store: mongoose (default),
#                        postgresql, mysql or mssql. The matching
#                        @usehenri/<adapter> package must be installed, see
#                        the HENRI_ADAPTER build argument.
#   HENRI_SECRET         secret for sessions and JWT. A random one is generated
#                        when unset, which logs everyone out on restart.
#   PORT                 listening port, 3000 by default.
#
# Build arguments:
#
#   HENRI_VERSION  henri version installed with npm for the scaffolding
#                  (default: latest); the app then pins its henri packages to
#                  that exact version
#   HENRI_ADAPTER  @usehenri/<adapter> added to the app (default: mongoose)
#   PNPM_VERSION   pnpm version (default: the one pinned in mise.toml)

ARG NODE_IMAGE=node:24-bookworm-slim

# ---- build: scaffold, install, next build ----------------------------------
FROM ${NODE_IMAGE} AS build

ARG HENRI_VERSION=latest
ARG HENRI_ADAPTER=mongoose
ARG PNPM_VERSION=11.25.0

# NODE_ENV=production skips the scaffold's devDependencies (eslint);
# MONGOMS_DISABLE_POSTINSTALL skips the MongoDB download of @usehenri/disk,
# which the image does not use.
ENV CI=true \
  NODE_ENV=production \
  MONGOMS_DISABLE_POSTINSTALL=1

RUN npm install -g "pnpm@${PNPM_VERSION}" "henri@${HENRI_VERSION}"

WORKDIR /srv
RUN henri new app --skip-install
WORKDIR /srv/app

# The scaffold depends on @usehenri/core, disk and react; add the CLI (used by
# CMD below) and the adapter of the real database. Exact version of the
# scaffold (package.json "henri"): pnpm 11 skips versions younger than a day
# when it resolves a tag or a range (minimumReleaseAge), which mixed 1.0.0 and
# 1.0.2 packages right after a release.
RUN version=$(node -p "require('./package.json').henri") \
  && pnpm add "henri@${version}" "@usehenri/${HENRI_ADAPTER}@${version}"

# next build at image time (henri server --production would otherwise build
# on first start). The build needs no database: the config written by the
# entrypoint has no store when HENRI_STORE_URL is unset.
COPY entrypoint.sh /usr/local/bin/henri-entrypoint
RUN henri-entrypoint henri build

# ---- runtime ------------------------------------------------------------------
FROM ${NODE_IMAGE}

ENV NODE_ENV=production \
  PORT=3000

# tini forwards SIGTERM to the node process (henri has no signal handler)
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/app
COPY --from=build --chown=node:node /srv/app ./
COPY entrypoint.sh /usr/local/bin/henri-entrypoint

USER node
EXPOSE 3000

ENTRYPOINT ["tini", "--", "henri-entrypoint"]
CMD ["node_modules/.bin/henri", "server", "--production"]
