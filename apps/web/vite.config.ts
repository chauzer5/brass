import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync } from 'node:fs';

/** The rulebook PDF, if one has been added to public/: the menus only offer it then. */
const RULEBOOK = 'rulebook.pdf';
const hasRulebook = existsSync(new URL(`./public/${RULEBOOK}`, import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    // A service worker that keeps a copy of the whole app on the device, so it starts without a
    // connection. New versions download in the background and wait for the player to reload.
    VitePWA({
      registerType: 'prompt',
      // The manifest lives in public/ and is linked from index.html.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webp,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // The rulebook is big, so it isn't downloaded up front: once opened, it's kept for offline reading.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname === `/${RULEBOOK}`,
            handler: 'CacheFirst',
            options: { cacheName: 'rulebook', expiration: { maxEntries: 1 } },
          },
        ],
        navigateFallbackDenylist: [/\.pdf$/],
      },
    }),
  ],
  define: { __RULEBOOK__: JSON.stringify(hasRulebook ? `/${RULEBOOK}` : null) },
  server: { host: true },
  worker: { format: 'es' },
});
