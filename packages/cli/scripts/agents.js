const fs = require('fs-extra');
const path = require('path');
const handlebars = require('handlebars');

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
 * @returns {string} Markdown
 */
const renderAgents = ({ name, renderer = 'react' }) => {
  const source = fs.readFileSync(path.join(TEMPLATE_DIR, 'AGENTS.md'), 'utf8');
  const template = handlebars.compile(source, { noEscape: true });
  const which = RENDERERS.includes(renderer) ? renderer : 'react';

  return template({
    inertia: which === 'inertia',
    name,
    react: which === 'react',
    renderer: which,
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
 * @param {boolean} [options.force=false] Overwrite existing files
 * @returns {{created: Array<string>, skipped: Array<string>}} What was written
 */
const writeAgentFiles = (dir, { name, renderer = 'react', force = false }) => {
  const created = [];
  const skipped = [];

  for (const { source, target, template } of FILES) {
    const location = path.join(dir, target);

    if (fs.existsSync(location) && !force) {
      skipped.push(target);
      continue;
    }

    const content = template
      ? renderAgents({ name, renderer })
      : fs.readFileSync(path.join(TEMPLATE_DIR, source), 'utf8');

    fs.outputFileSync(location, content);
    created.push(target);
  }

  return { created, skipped };
};

module.exports = { FILES, renderAgents, writeAgentFiles };
