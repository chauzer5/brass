import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
      },
    }),
  ],
  server: { host: true },
  worker: { format: 'es' },
});
