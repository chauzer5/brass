import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** How often an app left on screen checks for a new version (installed apps can stay open for days). */
const CHECK_EVERY_MS = 15 * 60 * 1000;
/** Coming back to the app checks too, but not more often than this. */
const MIN_GAP_MS = 60 * 1000;

/**
 * Browsers only look for a new version when a page loads (or about once a day). An installed app
 * isn't reloaded when it comes back from the background, and phones pause timers while it's away, so
 * without this a new version was only noticed after closing the app completely. So: check whenever
 * the app comes back on screen or back online, and every so often while it's open.
 */
function watchForUpdates(registration: ServiceWorkerRegistration) {
  let last = Date.now();
  const check = (force = false) => {
    if (!force && Date.now() - last < MIN_GAP_MS) return;
    last = Date.now();
    registration.update().catch(() => {});
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('online', () => check(true));
  window.setInterval(() => {
    if (document.visibilityState === 'visible') check(true);
  }, CHECK_EVERY_MS);
}

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
      if (registration) watchForUpdates(registration);
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
