#!/bin/sh
#
# Writes showcase/config/production.json from the environment, then runs the
# given command. @usehenri/core reads config/<NODE_ENV>.json and expands no
# environment variable, so a container writes the file at start time.
#
#   DATABASE_URL   PostgreSQL connection string (required)
#   HENRI_SECRET   session and token secret (required)
#   PORT           listening port, 3000 by default
#   HENRI_MIGRATE  "false" to stop the boot from applying db/migrations
#   HENRI_SEED     "true" to run db/seeds.js before starting
set -eu

: "${PORT:=3000}"
: "${HENRI_MIGRATE:=true}"
: "${HENRI_SEED:=false}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "lineup: DATABASE_URL is not set" >&2
  exit 1
fi

if [ -z "${HENRI_SECRET:-}" ]; then
  echo "lineup: HENRI_SECRET is not set; refusing to start with a throwaway secret" >&2
  exit 1
fi

node - <<'EOF'
const fs = require('fs');
const env = process.env;

const config = {
  api: { maxPerPage: 50, perPage: 12, strict: true },
  baseRole: 'speaker',
  host: '0.0.0.0',
  inertia: { ssr: true },
  port: Number(env.PORT),
  renderer: 'inertia',
  secret: env.HENRI_SECRET,
  stores: {
    default: {
      adapter: 'drizzle',
      dialect: 'postgres',
      // The production boot applies db/migrations when this is true
      migrate: env.HENRI_MIGRATE !== 'false',
      url: env.DATABASE_URL,
    },
  },
  user: {
    afterLogin: '/proposals/mine',
    loginPath: '/login',
    model: 'user',
    public: ['name', 'company'],
  },
};

fs.mkdirSync('config', { recursive: true });
fs.writeFileSync(
  'config/production.json',
  `${JSON.stringify(config, null, 2)}\n`
);
EOF

if [ "$HENRI_SEED" = "true" ]; then
  echo "lineup: seeding"
  node_modules/.bin/henri db:seed --production
fi

exec "$@"
