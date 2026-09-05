// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://usehenri.io',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'henri',
      description:
        'henri is an easy to learn, rails-like, server-side rendered JavaScript framework with real ORMs.',
      logo: {
        src: './src/assets/henri.png',
        alt: 'henri',
      },
      favicon: '/favicon.png',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/usehenri/henri',
        },
        {
          icon: 'npm',
          label: 'npm',
          href: 'https://www.npmjs.com/package/henri',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/usehenri/henri/edit/master/website/',
      },
      lastUpdated: true,
      customCss: ['./src/styles/custom.css'],
      head: [
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: 'https://usehenri.io/henri.png',
          },
        },
      ],
      sidebar: [
        {
          label: 'Start here',
          items: ['getting-started', 'configuration'],
        },
        {
          label: 'Guides',
          items: [{ autogenerate: { directory: 'guides' } }],
        },
        {
          label: 'Reference',
          items: [{ autogenerate: { directory: 'reference' } }],
        },
      ],
    }),
    sitemap(),
  ],
});
