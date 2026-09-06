const { expand } = require('./routing');
const { readRoutes, validInstall } = require('./utils');

/**
 * Format the routes as a table, one route per line
 *
 * @param {Array<object>} routes Expanded routes
 * @returns {string} The table
 */
const table = (routes) => {
  const hasRoles = routes.some((route) => route.roles);
  const hasPolicies = routes.some((route) => route.policy);
  const headers = ['Verb', 'Path', 'Controller', 'Helper'];
  const rows = routes.map((route) => [
    route.verb.toUpperCase(),
    route.route,
    route.controller,
    route.path,
  ]);

  if (hasRoles) {
    headers.push('Roles');
    routes.forEach((route, index) =>
      rows[index].push(route.roles ? [].concat(route.roles).join(', ') : '')
    );
  }

  // The two guards are printed apart because they answer different
  // questions: the roles say who may reach the route, the policy who may
  // act on the record behind it
  if (hasPolicies) {
    headers.push('Policy');
    routes.forEach((route, index) =>
      rows[index].push(
        route.policy === true
          ? route.controller.split('#')[0]
          : String(route.policy || '')
      )
    );
  }

  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length))
  );
  const line = (cells) =>
    cells
      .map((cell, column) =>
        column === cells.length - 1 ? cell : cell.padEnd(widths[column])
      )
      .join('  ');

  return [line(headers), ...rows.map(line)].join('\n');
};

/**
 * Print the routes table from config/routes.js without booting the server
 *
 * @param {object} [args] CLI arguments (--json prints the routes as JSON)
 * @returns {Promise<void>} Resolves when printed
 */
const main = async (args = {}) => {
  validInstall({ fatal: true });

  const routes = expand(readRoutes(process.cwd()));

  if (args.json) {
    console.log(JSON.stringify(routes, null, 2));

    return;
  }

  if (routes.length === 0) {
    console.log('No routes found in config/routes.js');

    return;
  }

  console.log('');
  console.log(table(routes));
  console.log('');
  console.log(`${routes.length} route${routes.length > 1 ? 's' : ''}`);
};

module.exports = main;
module.exports.table = table;
