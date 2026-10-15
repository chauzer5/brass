import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync, readdirSync } from 'node:fs';

/**
 * The rulebook's pages, as images in public/rulebook/ (page-1.jpg, …): drawn
 * from the PDF ahead of time, since phones' PDF rendering mangles its
 * transparency. The menus only offer the rulebook when they're there.
 */
const rulebookDir = new URL('./public/rulebook/', import.meta.url);
const rulebookPages = existsSync(rulebookDir) ? readdirSync(rulebookDir).filter((f) => /^page-\d+\.jpg$/.test(f)).length : 0;

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
        globPatterns: ['**/*.{js,css,html,svg,png,webp,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // A new version, once told to take over, takes over open pages too (even ones it wasn't serving).
        clientsClaim: true,
        // The rulebook is big, so it isn't downloaded up front: each page, once seen, is kept for offline reading.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/rulebook/'),
            handler: 'CacheFirst',
            options: { cacheName: 'rulebook', expiration: { maxEntries: 40 } },
          },
        ],
      },
    }),
  ],
  define: { __RULEBOOK__: JSON.stringify(rulebookPages > 0 ? rulebookPages : null) },
  server: { host: true },
  worker: { format: 'es' },
});
