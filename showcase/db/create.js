// Creates the PostgreSQL database this application is configured for, the
// way `rails db:create` does. henri has no such command: `henri db:migrate`
// and `henri db:seed` connect to a database that already exists.
//
//   node db/create.js              the store of config/dev.json, else default
//   node db/create.js --env=test   the store of config/test.json
//
// DATABASE_URL wins over the file, exactly as it does when henri boots.
//
// It connects to the `postgres` maintenance database on the same server and
// issues a CREATE DATABASE when the one in the url is missing, so running it
// twice is harmless.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const env = (process.argv.find((arg) => arg.startsWith('--env=')) || '').slice(
  '--env='.length
);
const config = (name) => path.join(__dirname, '..', 'config', `${name}.json`);

// Henri reads config/dev.json before config/default.json in development, and
// that is where a local override of the port or the credentials goes: honour
// it here too, or the first step of the README fails on a machine where
// something else already holds 5432
const file = env
  ? config(env)
  : [config('dev'), config('default')].find((candidate) =>
      fs.existsSync(candidate)
    ) || config('default');

/**
 * The url of the default store of a configuration file
 *
 * @param {string} configFile Path of the configuration file
 * @returns {string} A postgres connection string
 * @throws {Error} When the file or the store is missing
 */
const storeUrl = (configFile) => {
  if (!fs.existsSync(configFile)) {
    throw new Error(`${path.basename(configFile)} does not exist`);
  }

  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const url =
    config.stores && config.stores.default && config.stores.default.url;

  if (!url) {
    throw new Error(`${path.basename(configFile)} has no stores.default.url`);
  }

  return url;
};

// DATABASE_URL is applied over stores.default.url by henri, so the database
// this creates is the one the application will connect to
const url = process.env.DATABASE_URL || storeUrl(file);

/**
 * Creates the database of a connection string when it does not exist yet
 *
 * @param {string} url The connection string of the application
 * @returns {Promise<void>} Resolves when the database is there
 */
const create = async (url) => {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ''));
  const maintenance = new URL(url);

  maintenance.pathname = '/postgres';

  const client = new Client({ connectionString: maintenance.href });

  await client.connect();

  try {
    const { rows } = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name]
    );

    if (rows.length > 0) {
      console.log(`database ${name} is already there`);

      return;
    }

    // CREATE DATABASE takes no parameters: the name is quoted instead
    await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    console.log(`created database ${name}`);
  } finally {
    await client.end();
  }
};

create(url).catch((error) => {
  console.error(`db/create.js failed: ${error.message}`);
  console.error(
    'is PostgreSQL running? `pnpm db:up` starts the one of compose.yaml'
  );
  process.exit(1);
});
