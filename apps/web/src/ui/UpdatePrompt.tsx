import { useRegisterSW } from 'virtual:pwa-register/react';

/** How often an open app checks for a new version (installed apps can stay open for days). */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Keeps the app on the device for offline play, and offers a reload when a new
 * version has downloaded. Nothing reloads on its own, so a game is never cut off.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => registration.update().catch(() => {}), CHECK_EVERY_MS);
    },
  });
  if (!needRefresh) return null;
  return (
    <div className="update-prompt" role="status">
      <span>New version ready</span>
      <button onClick={() => updateServiceWorker(true)}>Reload</button>
      <button className="close" onClick={() => setNeedRefresh(false)} aria-label="Later">
        ×
      </button>
    </div>
  );
}
