import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** How often an open app checks for a new version (installed apps can stay open for days). */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Switches to the downloaded version and reloads. The plugin's own reload waits for the new version to
 * take control of the page, which never happens on some phones (a page opened before the app was first
 * stored offline, or a waiting version the plugin lost track of): so this tells whichever version is
 * waiting to take over directly, reloads as soon as it does, and reloads anyway after a moment.
 */
async function applyUpdate(viaPlugin: () => Promise<void>) {
  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  navigator.serviceWorker?.addEventListener('controllerchange', reload);
  window.setTimeout(reload, 2500);
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  } catch {
    // The fallback reload still happens.
  }
  void viaPlugin().catch(() => {});
}

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
  const [updating, setUpdating] = useState(false);
  if (!needRefresh) return null;
  return (
    <div className="update-prompt" role="status">
      <span>New version ready</span>
      <button
        disabled={updating}
        onClick={() => {
          setUpdating(true);
          void applyUpdate(() => updateServiceWorker(true));
        }}
      >
        {updating ? 'Updating…' : 'Reload'}
      </button>
      <button className="close" onClick={() => setNeedRefresh(false)} aria-label="Later">
        ×
      </button>
    </div>
  );
}
