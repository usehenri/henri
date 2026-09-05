const fs = require('fs-extra');
const path = require('path');
const handlebars = require('handlebars');

const { APIS, DEFAULT_ADAPTER } = require('./adapters');

/**
 * The files that make an application readable by coding agents, all from
 * template/default: AGENTS.md (the conventions, with the application name
 * and renderer filled in), CLAUDE.md (a pointer to AGENTS.md) and .mcp.json
 * (Claude Code's project MCP configuration, starting `henri mcp`).
 */
const TEMPLATE_DIR = path.resolve(__dirname, '../template/default');

const FILES = [
  { source: 'AGENTS.md', target: 'AGENTS.md', template: true },
  { source: 'CLAUDE.md', target: 'CLAUDE.md', template: false },
  { source: 'mcp.json', target: '.mcp.json', template: false },
];

const RENDERERS = ['react', 'inertia'];

/**
 * Render AGENTS.md for an application
 *
 * @param {object} options Options
 * @param {string} options.name The application name
 * @param {string} [options.renderer='react'] react or inertia
 * @param {string} [options.adapter='disk'] The adapter of the default store
 * @returns {string} Markdown
 */
const renderAgents = ({
  adapter = DEFAULT_ADAPTER,
  name,
  renderer = 'react',
}) => {
  const source = fs.readFileSync(path.join(TEMPLATE_DIR, 'AGENTS.md'), 'utf8');
  const template = handlebars.compile(source, { noEscape: true });
  const which = RENDERERS.includes(renderer) ? renderer : 'react';
  const store = APIS[adapter] ? adapter : DEFAULT_ADAPTER;
  const api = APIS[store];

  return template({
    adapter: store,
    drizzle: api === 'drizzle',
    inertia: which === 'inertia',
    mongoose: api === 'mongoose',
    name,
    react: which === 'react',
    renderer: which,
    sequelize: api === 'sequelize',
  })
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
};

/**
 * Write AGENTS.md, CLAUDE.md and .mcp.json in an application directory
 *
 * @param {string} dir The application directory
 * @param {object} options Options
 * @param {string} options.name The application name
 * @param {string} [options.renderer='react'] react or inertia
 * @param {string} [options.adapter='disk'] The adapter of the default store
 * @param {boolean} [options.force=false] Overwrite existing files
 * @returns {{created: Array<string>, skipped: Array<string>}} What was written
 */
const writeAgentFiles = (
  dir,
  { adapter = DEFAULT_ADAPTER, name, renderer = 'react', force = false }
) => {
  const created = [];
  const skipped = [];

  for (const { source, target, template } of FILES) {
    const location = path.join(dir, target);

    if (fs.existsSync(location) && !force) {
      skipped.push(target);
      continue;
    }

    const content = template
      ? renderAgents({ adapter, name, renderer })
      : fs.readFileSync(path.join(TEMPLATE_DIR, source), 'utf8');

    fs.outputFileSync(location, content);
    created.push(target);
  }

  return { created, skipped };
};

module.exports = { FILES, renderAgents, writeAgentFiles };
