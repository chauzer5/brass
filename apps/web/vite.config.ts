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

/**
 * The page invite links open (/invite/?join=CODE). It's only there for its preview: messaging apps
 * show its title, description and picture instead of a bare link. It sends people straight on to the
 * game's join page. (In the installed app, which serves every page itself, the app reads the code
 * from the address the same way.) Previews need the picture's full address: the site's own, which
 * Vercel provides when it builds.
 */
const site = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
const INVITE_TITLE = "You've been invited to a game of Brass: Birmingham!";
const INVITE_TEXT = 'Tap to join the game.';
const invitePage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${INVITE_TITLE}</title>
    <meta name="description" content="${INVITE_TEXT}" />
    <meta property="og:title" content="${INVITE_TITLE}" />
    <meta property="og:description" content="${INVITE_TEXT}" />
    <meta property="og:site_name" content="Brass" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="${site ? `https://${site}` : ''}/invite-card.jpg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="theme-color" content="#2b1d14" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <script>
      location.replace('/' + location.search);
    </script>
  </head>
  <body style="margin: 0; min-height: 100vh; background: #1f140c url(/board-bg.webp) center / cover"></body>
</html>
`;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'invite-page',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'invite/index.html', source: invitePage });
      },
    },
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
        // Notifications (public/push-sw.js).
        importScripts: ['push-sw.js'],
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
