import type { APIRoute } from 'astro';

import { SITE, SUMMARY, sections, urlOf } from '../llms';

/**
 * `/llms-full.txt`: every page of this documentation, as markdown, in one
 * file, so an agent reads the whole thing in one fetch instead of crawling
 * the site. `/llms.txt` is the index that points here.
 *
 * The version-matched copy of the same pages ships inside the npm package
 * (`@usehenri/core/docs`, `henri docs`), which is what an application
 * should read: this file is what the deployed website says.
 */
export const GET: APIRoute = async () => {
  const groups = await sections();
  const parts = [
    '# henri',
    '',
    `> ${SUMMARY}`,
    '',
    `Every documentation page of ${SITE}, concatenated. The index is at ${SITE}/llms.txt. The same pages ship with the framework (\`henri docs\`), where they match the version of the application reading them.`,
    '',
  ];

  for (const group of groups) {
    for (const page of group.pages) {
      parts.push(
        '---',
        '',
        `# ${page.title}`,
        '',
        `Source: ${urlOf(page.slug)}`,
        page.description ? `\n${page.description}` : '',
        '',
        page.body.trim(),
        ''
      );
    }
  }

  return new Response(parts.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
