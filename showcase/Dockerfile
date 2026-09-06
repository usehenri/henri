# syntax=docker/dockerfile:1
#
# Lineup, the henri showcase, in production mode.
#
# The application depends on the workspace packages (`workspace:^`), so the
# build context is the repository root, not this directory:
#
#   docker build -f showcase/Dockerfile -t lineup .
#   docker run --rm -p 3000:3000 \
#     -e DATABASE_URL=postgres://henri:henri@host.docker.internal:5432/henri_showcase \
#     -e HENRI_SECRET=$(openssl rand -hex 32) \
#     lineup
#
# Nothing is written at start time: config/production.json is committed and
# henri applies the environment over it (DATABASE_URL, HENRI_SECRET and any
# HENRI_CONFIG__<key>). The boot applies db/migrations; see
# docker-entrypoint.sh for the handful of names it maps.

ARG NODE_IMAGE=node:24-bookworm-slim
ARG PNPM_VERSION=11.25.0

# ---- build: install the workspace and build the Vite bundles ---------------
FROM ${NODE_IMAGE} AS build

ARG PNPM_VERSION

# NODE_ENV=production skips the devDependencies; the MongoDB binary of
# @usehenri/disk is not part of this application and is not downloaded
ENV CI=true \
  HUSKY=0 \
  NODE_ENV=production \
  MONGOMS_DISABLE_POSTINSTALL=1 \
  PNPM_HOME=/usr/local/share/pnpm \
  PATH=/usr/local/share/pnpm:$PATH

RUN npm install --global "pnpm@${PNPM_VERSION}"

WORKDIR /srv
COPY . .

# `...` installs the workspace packages the showcase depends on as well.
# Not --prod: pnpm links strictly, and the Vite plugins @usehenri/inertia
# imports are peer dependencies its own devDependencies provide.
# --ignore-scripts skips the native builds of the packages this application
# never loads (better-sqlite3 and sqlite3 belong to the sqlite dialects of the
# other adapters); esbuild ships its linux binary as a platform package, so
# Vite still runs.
RUN pnpm install --frozen-lockfile --ignore-scripts \
  --filter @usehenri/showcase...

# `henri build` runs the client and server Vite builds without booting henri,
# so the image builds with no database in sight
WORKDIR /srv/showcase
RUN node_modules/.bin/henri build

# ---- runtime ---------------------------------------------------------------
FROM ${NODE_IMAGE}

ENV NODE_ENV=production \
  PORT=3000

# tini forwards SIGTERM to node (henri installs no signal handler)
RUN apt-get update \
  && apt-get install --yes --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /srv /srv
COPY --chown=node:node showcase/docker-entrypoint.sh /usr/local/bin/lineup-entrypoint
RUN chmod +x /usr/local/bin/lineup-entrypoint

WORKDIR /srv/showcase
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--", "lineup-entrypoint"]
CMD ["node_modules/.bin/henri", "server", "--production"]
