const { CliError } = require('./errors');
const { detectPackageManager, resolveFrom, validInstall } = require('./utils');

/**
 * Start the MCP server of @usehenri/mcp (stdio) for the application in the
 * current directory. Coding agents connect to it through .mcp.json
 * (Claude Code) or .cursor/mcp.json (Cursor).
 *
 * @returns {Promise<void>} Resolves when the server has stopped
 * @throws {CliError} NOT_INSTALLED when @usehenri/mcp is not in the project
 */
const main = async () => {
  validInstall({ fatal: true });

  const cwd = process.cwd();
  let mcp;

  try {
    mcp = require(resolveFrom('@usehenri/mcp', cwd));
  } catch (error) {
    const pm = detectPackageManager(cwd);
    const add = pm === 'npm' ? 'npm install --save-dev' : `${pm} add -D`;

    throw new CliError(
      'NOT_INSTALLED',
      '@usehenri/mcp is not installed in this project',
      { cause: error, hint: `Install it with: ${add} @usehenri/mcp` }
    );
  }

  await mcp.serve({ cwd });
};

module.exports = main;
