/*
 * Notifications from the game server (pulled into the app's service worker).
 * Each one is about a game: tapping it opens the app on that game.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Brass', {
      body: data.body || '',
      tag: data.tag,
      renotify: !!data.tag,
      icon: '/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      // Reuse the app if it's open (taking it to the game), else open it.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        try {
          await client.focus();
          if ('navigate' in client) await client.navigate(url);
          return;
        } catch {
          // Not this one: try the next, or open a new window.
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
