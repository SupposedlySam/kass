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
      head: [
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
        // Amplitude Browser SDK — Analytics autocapture. Public ingestion-scoped project API key.
        { tag: 'script', attrs: { src: 'https://cdn.amplitude.com/script/15288b16e4a64d54978fa9d86adddad1.js' } },
        {
          tag: 'script',
          content:
            "window.amplitude.init('15288b16e4a64d54978fa9d86adddad1', { serverZone: 'US', autocapture: true });",
        },
        // Docs search-term tracking. Pagefind creates its search input lazily when the
        // search modal opens, so we delegate from the document and match the Pagefind
        // UI input (class `pagefind-ui__search-input`). Each settled query (debounced
        // ~800ms, >= 2 chars, deduped against the last-sent term) emits one
        // `docs_search` Amplitude event so we can chart top search terms later.
        {
          tag: 'script',
          content: [
            '(function () {',
            "  var SELECTOR = '.pagefind-ui__search-input';",
            '  var DEBOUNCE_MS = 800;',
            '  var lastSent = null;',
            '  var timer = null;',
            "  document.addEventListener('input', function (event) {",
            '    var target = event.target;',
            '    if (!target || typeof target.matches !== "function" || !target.matches(SELECTOR)) return;',
            "    var query = (target.value || '').trim();",
            '    if (timer) clearTimeout(timer);',
            '    timer = setTimeout(function () {',
            '      if (query.length < 2) return;',
            '      if (query === lastSent) return;',
            "      if (!window.amplitude || typeof window.amplitude.track !== 'function') return;",
            '      lastSent = query;',
            "      window.amplitude.track('docs_search', { search_term: query });",
            '    }, DEBOUNCE_MS);',
            '  }, true);',
            '})();',
          ].join('\n'),
        },
      ],
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
            { label: 'Read Aloud', slug: 'docs/read-aloud' },
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
