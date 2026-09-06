#!/bin/sh
#
# Lineup in a container. Nothing is written at start time: config/production.json
# is committed and henri applies the environment over it, so this script only
# checks what the application cannot start without, maps the two names the
# platform owns to henri's configuration keys, and runs the optional seed.
#
#   DATABASE_URL   PostgreSQL connection string (required, stores.default.url)
#   HENRI_SECRET   session and token secret (required)
#   PORT           listening port, 3000 by default (HENRI_CONFIG__port)
#   HENRI_MIGRATE  "false" stops the boot from applying db/migrations
#   HENRI_SEED     "true" runs db/seeds.js before starting
#
# Every other key is reachable as HENRI_CONFIG__<key>, no shim needed:
#   -e HENRI_CONFIG__api__perPage=25 -e HENRI_CONFIG_JSON__inertia='{"ssr":false}'
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "lineup: DATABASE_URL is not set" >&2
  exit 1
fi

if [ -z "${HENRI_SECRET:-}" ]; then
  echo "lineup: HENRI_SECRET is not set; refusing to start with a throwaway secret" >&2
  exit 1
fi

if [ -n "${PORT:-}" ]; then
  HENRI_CONFIG__port="$PORT"
  export HENRI_CONFIG__port
fi

if [ "${HENRI_MIGRATE:-true}" = "false" ]; then
  HENRI_CONFIG__stores__default__migrate=false
  export HENRI_CONFIG__stores__default__migrate
fi

if [ "${HENRI_SEED:-false}" = "true" ]; then
  echo "lineup: seeding"
  node_modules/.bin/henri db:seed --production
fi

exec "$@"
