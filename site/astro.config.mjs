// @ts-check

import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://kass.mrgnhnt.com',
  integrations: [
    starlight({
      title: 'Kass',
      // The 404 page is src/pages/404.astro.
      disable404Route: true,
      description: 'Private, local dictation for Apple Silicon Macs.',
      logo: { src: './src/assets/icon.png', alt: '' },
      favicon: '/favicon.svg',
      head: [{ tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } }],
      customCss: ['./src/styles/docs.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/mrgnhnt96/kass' }],
      editLink: { baseUrl: 'https://github.com/mrgnhnt96/kass/edit/main/site/' },
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Overview', slug: 'docs' },
            { label: 'Install', slug: 'docs/install' },
            { label: 'Your first dictation', slug: 'docs/first-dictation' },
          ],
        },
        {
          label: 'Using Kass',
          items: [
            { label: 'Hotkeys', slug: 'docs/hotkeys' },
            { label: 'Spoken commands', slug: 'docs/spoken-commands' },
            { label: 'Writing styles', slug: 'docs/writing-styles' },
            { label: 'Dictionary', slug: 'docs/dictionary' },
            { label: 'Command Mode', slug: 'docs/command-mode' },
            { label: 'Captures and corrections', slug: 'docs/captures' },
          ],
        },
        {
          label: 'Setup',
          items: [
            { label: 'Models', slug: 'docs/models' },
            { label: 'Settings', slug: 'docs/settings' },
            { label: 'Privacy', slug: 'docs/privacy' },
            { label: 'Troubleshooting', slug: 'docs/troubleshooting' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Local API', slug: 'docs/api' },
            { label: 'Build from source', slug: 'docs/build-from-source' },
            { label: 'Changelog', link: '/changelog/' },
            {
              label: 'Report an issue',
              link: 'https://github.com/mrgnhnt96/kass/issues/new/choose',
              attrs: { target: '_blank' },
            },
          ],
        },
      ],
    }),
  ],
});
