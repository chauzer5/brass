/*
 * Web Push from a Worker, with nothing but WebCrypto: the message is
 * encrypted for the phone (RFC 8291, aes128gcm) and the request signed with
 * this server's VAPID key (RFC 8292), then posted to the phone's push service.
 */

/** A phone's push subscription, as the browser gives it (PushSubscription.toJSON()). */
export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** What the app's service worker shows. */
export interface PushMessage {
  title: string;
  body: string;
  /** Notifications with the same tag replace each other (one per game). */
  tag: string;
  /** Opened when the notification is tapped. */
  url: string;
}

/** The VAPID key pair, as a JWK with its private part (kept as a Worker secret). */
export type VapidKey = JsonWebKey & { x: string; y: string; d: string };

const enc = new TextEncoder();

export const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** The public key as the uncompressed point (0x04 ‖ x ‖ y) push services and browsers use. */
export const vapidPublicKey = (key: VapidKey) => concat(new Uint8Array([4]), fromB64url(key.x), fromB64url(key.y));

/**
 * Encrypts a message for one subscription (RFC 8291). `salt` and `local` are only passed in by tests
 * (to check against the RFC's worked example); normally they're fresh each time.
 */
export async function encrypt(
  sub: PushSub,
  plaintext: Uint8Array,
  test?: { salt: Uint8Array; local: CryptoKeyPair },
): Promise<Uint8Array> {
  const uaPublic = fromB64url(sub.keys.p256dh);
  const authSecret = fromB64url(sub.keys.auth);
  const local = test?.local ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // (`public` is the standard name; Workers' types call it `$public`.)
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0];
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, local.privateKey, 256));

  // IKM = HKDF(auth, ecdh, "WebPush: info" ‖ 0 ‖ ua_public ‖ as_public, 32)
  const prkKey = await hmac(authSecret, ecdhSecret);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  // CEK and nonce from the salt.
  const salt = test?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, enc.encode('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16);
  const nonce = (await hmac(prk, enc.encode('Content-Encoding: nonce\0\x01'))).slice(0, 12);

  // One record: the message, then the last-record delimiter.
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  // Header: salt ‖ record size ‖ key id length ‖ key id (the sender's public key).
  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** The VAPID Authorization header for a push service (a JWT signed with ES256). */
export async function vapidAuth(endpoint: string, key: VapidKey, subject: string): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })),
  );
  const signing = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: key.x, y: key.y, d: key.d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signing, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${b64url(vapidPublicKey(key))}`;
}

/**
 * Sends one notification. Returns false when the subscription is gone for good (the phone
 * unsubscribed, or the app was removed), so it can be forgotten.
 */
export async function sendPush(sub: PushSub, message: PushMessage, key: VapidKey, subject: string): Promise<boolean> {
  const body = await encrypt(sub, enc.encode(JSON.stringify(message)));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(sub.endpoint, key, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // Kept a day if the phone is off; a turn notification after that isn't much use.
      TTL: String(24 * 3600),
      Urgency: 'high',
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return false;
  if (!res.ok) console.error(`Push to ${new URL(sub.endpoint).host} failed: ${res.status} ${await res.text().catch(() => '')}`);
  return true;
}

/** Checks a subscription sent by a phone looks like one. */
export function isPushSub(x: unknown): x is PushSub {
  const s = x as PushSub;
  return (
    !!s &&
    typeof s.endpoint === 'string' &&
    s.endpoint.startsWith('https://') &&
    s.endpoint.length < 1000 &&
    typeof s.keys?.p256dh === 'string' &&
    typeof s.keys?.auth === 'string' &&
    s.keys.p256dh.length < 200 &&
    s.keys.auth.length < 100
  );
}
