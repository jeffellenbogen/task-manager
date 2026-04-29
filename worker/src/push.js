// Base64url helpers
function b64Decode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

function b64Encode(buf) {
  const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer || buf);
  let str = '';
  bytes.forEach(b => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function concat(...arrays) {
  const len = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let i = 0;
  for (const a of arrays) { out.set(a, i); i += a.length; }
  return out;
}

// HKDF-Extract: PRK = HMAC-SHA256(salt, ikm)
async function hkdfExtract(salt, ikm) {
  const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, ikm));
}

// HKDF-Expand: T(1) = HMAC-SHA256(PRK, info || 0x01), return first `len` bytes
async function hkdfExpand(prk, info, len) {
  const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const t = new Uint8Array(await crypto.subtle.sign('HMAC', key, concat(info, new Uint8Array([1]))));
  return t.slice(0, len);
}

// Build a VAPID JWT signed with the EC P-256 private key (stored as JWK)
async function makeVapidJwt(privateJwk, audience, subject) {
  const enc = obj => b64Encode(new TextEncoder().encode(JSON.stringify(obj)));
  const header = enc({ typ: 'JWT', alg: 'ES256' });
  const payload = enc({ aud: audience, exp: Math.floor(Date.now() / 1000) + 43200, sub: subject });
  const unsigned = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    'jwk',
    typeof privateJwk === 'string' ? JSON.parse(privateJwk) : privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  );
  return `${unsigned}.${b64Encode(sig)}`;
}

// Encrypt payload with RFC 8291 (aes128gcm content encoding)
async function encryptPayload(subscription, payloadText) {
  const uaPublic = b64Decode(subscription.keys.p256dh);
  const authSecret = b64Decode(subscription.keys.auth);
  const plaintext = new TextEncoder().encode(payloadText);

  // Ephemeral server key pair for ECDH
  const serverPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverPair.publicKey));

  // ECDH shared secret
  const clientKey = await crypto.subtle.importKey(
    'raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const dh = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey }, serverPair.privateKey, 256
  ));

  // RFC 8291 key derivation
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prkKey = await hkdfExtract(authSecret, dh);
  const keyInfo = concat(new TextEncoder().encode('WebPush: info\0'), uaPublic, serverPublic);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  // Encrypt: plaintext + 0x02 delimiter (last-record marker per RFC 8188)
  const padded = concat(plaintext, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded)
  );

  // aes128gcm content header: salt(16) | rs(4, big-endian) | idlen(1) | keyid(idlen)
  const rs = 4096;
  const hdr = new Uint8Array(21 + serverPublic.length);
  hdr.set(salt, 0);
  new DataView(hdr.buffer).setUint32(16, rs, false);
  hdr[20] = serverPublic.length;
  hdr.set(serverPublic, 21);

  return concat(hdr, ciphertext);
}

// Send a Web Push notification to a subscription
export async function sendWebPush(subscription, title, body, env) {
  const { endpoint } = subscription;
  const origin = new URL(endpoint).origin;

  const jwt = await makeVapidJwt(env.VAPID_PRIVATE_KEY, origin, env.VAPID_SUBJECT);
  const encrypted = await encryptPayload(subscription, JSON.stringify({ title, body }));

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
    },
    body: encrypted,
  });

  if (!res.ok) {
    console.error(`Push failed for ${endpoint}: ${res.status} ${await res.text()}`);
  }
  return res;
}
