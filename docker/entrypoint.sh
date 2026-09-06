#!/bin/sh
#
# Writes config/production.json from the environment (the variables are
# documented in the Dockerfile), then runs the given command. From
# @usehenri/core 1.2 an application reads the environment itself and this file
# is only needed by the images that install an older henri from npm.
set -eu

node - <<'EOF'
const fs = require('fs');
const crypto = require('crypto');

const env = process.env;
const config = {
  baseRole: 'guest',
  port: Number(env.PORT || 3000),
  renderer: 'react',
  secret: env.HENRI_SECRET || crypto.randomBytes(48).toString('hex'),
  user: 'user',
};

if (!env.HENRI_SECRET) {
  console.warn('henri: HENRI_SECRET is not set, sessions will not survive a restart');
}

if (env.HENRI_STORE_URL) {
  config.stores = {
    default: {
      adapter: env.HENRI_STORE_ADAPTER || 'mongoose',
      url: env.HENRI_STORE_URL,
    },
  };
} else {
  console.warn('henri: HENRI_STORE_URL is not set, starting without a store');
}

fs.mkdirSync('config', { recursive: true });
fs.writeFileSync('config/production.json', `${JSON.stringify(config, null, 2)}\n`);
EOF

exec "$@"
