#!/usr/bin/env node

// Starts the henri MCP server (stdio) for the application in the current
// directory. `henri mcp` does the same through the henri command line.
const { serve } = require('../src/server');

serve({ cwd: process.cwd() }).catch((error) => {
  process.stderr.write(`henri-mcp: ${error.message}\n`);
  process.exit(1);
});
