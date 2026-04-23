# Background Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fire task reminder notifications on iOS even when the app is fully closed, using Cloudflare Workers as a Web Push server with a Cron Trigger that checks due reminders every minute.

**Architecture:** A Cloudflare Worker stores push subscriptions and reminder times in Workers KV. A Cron Trigger scans KV every minute, sends Web Push messages to due reminders, then deletes them. The app registers subscriptions and reminders with the Worker when tasks are saved, and cancels them when tasks are deleted. The existing in-app polling continues as a fallback when the app is open.

**Tech Stack:** Cloudflare Workers (ES modules), Workers KV, Web Push (RFC 8291, aes128gcm), Web Crypto API, Wrangler CLI, Vanilla JS, Service Worker API

---

## File Map

| File | Status | Purpose |
|------|--------|---------|
| `worker/wrangler.toml` | Create | Worker name, KV binding, cron schedule |
| `worker/index.js` | Create | HTTP routes (POST /subscribe, DELETE /reminder, OPTIONS) + scheduled handler |
| `worker/push.js` | Create | Web Push encryption and VAPID JWT (no npm dependencies) |
| `worker/.dev.vars` | Create (gitignored) | Local secrets for `wrangler dev` |
| `scripts/generate-vapid-keys.mjs` | Create | One-time script to generate VAPID keys in correct format |
| `.gitignore` | Modify | Add `.dev.vars` |
| `sw.js` | Modify | Add `push` event listener |
| `index.html` | Modify | Add VAPID public key constant, Worker URL, `initPush()`, `registerReminder()`, `cancelReminder()` |

---

## Task 1: Project scaffolding

**Files:**
- Modify: `.gitignore`
- Create: `worker/wrangler.toml`
- Create: `worker/.dev.vars`
- Create: `scripts/generate-vapid-keys.mjs`

- [ ] **Step 1: Update .gitignore**

Add to the bottom of `.gitignore` (create the file if it doesn't exist):

```
# Cloudflare Worker local secrets
.dev.vars
worker/.dev.vars
```

- [ ] **Step 2: Create worker/wrangler.toml**

```toml
name = "task-reminders"
main = "index.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "REMINDERS"
id = "PLACEHOLDER_REPLACE_IN_TASK_4"
preview_id = "PLACEHOLDER_REPLACE_IN_TASK_4"

[triggers]
crons = ["* * * * *"]
```

- [ ] **Step 3: Create worker/.dev.vars** (this file is gitignored — never commit it)

```
VAPID_PRIVATE_KEY={"kty":"EC","crv":"P-256","d":"PLACEHOLDER","x":"PLACEHOLDER","y":"PLACEHOLDER","key_ops":["sign"],"ext":true}
VAPID_PUBLIC_KEY=PLACEHOLDER
VAPID_SUBJECT=mailto:your-email@example.com
```

- [ ] **Step 4: Create scripts/generate-vapid-keys.mjs**

```javascript
// Run with: node scripts/generate-vapid-keys.mjs
// Requires Node.js 18+

const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
);

const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const b64url = buf => Buffer.from(buf).toString('base64url');

console.log('\n=== VAPID Keys — keep the private key secret! ===\n');
console.log('1. VAPID_PUBLIC_KEY (paste into index.html as VAPID_PUBLIC_KEY constant):');
console.log(b64url(publicRaw));
console.log('\n2. VAPID_PRIVATE_KEY (run `wrangler secret put VAPID_PRIVATE_KEY`, then paste this):');
console.log(JSON.stringify(privateJwk));
console.log('\n3. VAPID_SUBJECT (run `wrangler secret put VAPID_SUBJECT`, then paste your mailto):');
console.log('mailto:your-email@example.com');
console.log('\n================================================\n');
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore worker/wrangler.toml scripts/generate-vapid-keys.mjs
git commit -m "chore: scaffold Cloudflare Worker directory and key generation script"
```

---

## Task 2: Cloudflare account + Wrangler setup (manual steps)

These are one-time human steps. No code is written here.

- [ ] **Step 1: Create a free Cloudflare account**

Go to https://cloudflare.com → click **Sign Up** → choose the free plan. No credit card required.

- [ ] **Step 2: Install Wrangler CLI**

```bash
npm install -g wrangler
```

Verify:
```bash
wrangler --version
```
Expected output: `wrangler X.X.X`

- [ ] **Step 3: Log in to Cloudflare via Wrangler**

```bash
wrangler login
```

This opens a browser window. Authorize Wrangler. You'll see "Successfully logged in" in the terminal.

---

## Task 3: Generate VAPID keys

VAPID keys authenticate your push server to browser push services. Generate them once and store the private key in Cloudflare — never in code or git.

- [ ] **Step 1: Run the key generation script**

```bash
node scripts/generate-vapid-keys.mjs
```

Expected output (your values will differ):
```
=== VAPID Keys — keep the private key secret! ===

1. VAPID_PUBLIC_KEY (paste into index.html):
BN3abc...xyz

2. VAPID_PRIVATE_KEY (run `wrangler secret put VAPID_PRIVATE_KEY`, then paste):
{"kty":"EC","crv":"P-256","d":"abc...","x":"def...","y":"ghi...","key_ops":["sign"],"ext":true}

3. VAPID_SUBJECT:
mailto:your-email@example.com
```

Copy all three values to a temporary scratch document (not a file you'll commit).

- [ ] **Step 2: Store VAPID_PRIVATE_KEY in Cloudflare**

Run from inside the `worker/` directory:
```bash
cd worker
wrangler secret put VAPID_PRIVATE_KEY
```

Paste the full JSON string when prompted. Press Enter. You'll see "✅ Success! Uploaded secret VAPID_PRIVATE_KEY".

- [ ] **Step 3: Store VAPID_PUBLIC_KEY in Cloudflare**

```bash
wrangler secret put VAPID_PUBLIC_KEY
```

Paste the base64url public key string. Press Enter.

- [ ] **Step 4: Store VAPID_SUBJECT in Cloudflare**

```bash
wrangler secret put VAPID_SUBJECT
```

Paste `mailto:your-email@example.com` (use your real email). Press Enter.

- [ ] **Step 5: Update worker/.dev.vars with the real values**

Open `worker/.dev.vars` and replace the `PLACEHOLDER` values with the actual generated values. This file is only for local testing with `wrangler dev`. It is gitignored.

```
VAPID_PRIVATE_KEY={"kty":"EC","crv":"P-256","d":"<your-d-value>",...}
VAPID_PUBLIC_KEY=<your-base64url-public-key>
VAPID_SUBJECT=mailto:your-email@example.com
```

---

## Task 4: Set up Workers KV namespace

Workers KV is Cloudflare's key-value store. You'll create one namespace for reminder storage.

- [ ] **Step 1: Create the KV namespace** (run from `worker/` directory)

```bash
wrangler kv:namespace create REMINDERS
```

Expected output:
```
Add the following to your configuration file in your kv_namespaces array:
{ binding = "REMINDERS", id = "abc123def456..." }
```

Copy the `id` value.

- [ ] **Step 2: Create a preview namespace for local dev**

```bash
wrangler kv:namespace create REMINDERS --preview
```

Copy the `id` from this output too (it's a different ID).

- [ ] **Step 3: Update worker/wrangler.toml with the real namespace IDs**

Replace both `PLACEHOLDER_REPLACE_IN_TASK_4` values in `worker/wrangler.toml`:

```toml
name = "task-reminders"
main = "index.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "REMINDERS"
id = "<your-production-namespace-id>"
preview_id = "<your-preview-namespace-id>"

[triggers]
crons = ["* * * * *"]
```

- [ ] **Step 4: Commit wrangler.toml** (KV namespace IDs are not secrets)

```bash
cd ..
git add worker/wrangler.toml
git commit -m "chore: add Workers KV namespace IDs to wrangler.toml"
```

---

## Task 5: Implement push.js — Web Push encryption module

This module handles all the cryptography: VAPID JWT signing and RFC 8291 payload encryption. It uses only the Web Crypto API built into the Workers runtime — no npm packages needed.

**Files:**
- Create: `worker/push.js`

- [ ] **Step 1: Create worker/push.js**

```javascript
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
```

- [ ] **Step 2: Verify the file saved cleanly** (no test yet — push.js is exercised in Task 8)

```bash
wc -l worker/push.js
```
Expected: roughly 90 lines.

- [ ] **Step 3: Commit**

```bash
git add worker/push.js
git commit -m "feat: add Web Push encryption module (RFC 8291, aes128gcm)"
```

---

## Task 6: Implement Worker HTTP routes

The Worker handles three routes: `POST /subscribe` (store a reminder), `DELETE /reminder` (cancel a reminder), and `OPTIONS` (CORS preflight).

**Files:**
- Create: `worker/index.js`

- [ ] **Step 1: Create worker/index.js with HTTP handler**

```javascript
import { sendWebPush } from './push.js';

// Allow requests from GitHub Pages and local dev
const ALLOWED_ORIGINS = [
  'https://jeffellenbogen.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function handleRequest(request, env) {
  const origin = request.headers.get('Origin') || '';
  const { pathname } = new URL(request.url);

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // POST /subscribe — store or update a reminder in KV
  if (request.method === 'POST' && pathname === '/subscribe') {
    const { subscription, taskId, taskTitle, reminderMs } = await request.json();

    if (!subscription?.endpoint || !taskId || !reminderMs) {
      return new Response('Missing required fields', {
        status: 400,
        headers: corsHeaders(origin),
      });
    }

    const value = JSON.stringify({ subscription, taskTitle, reminderMs });
    await env.REMINDERS.put(`reminder:${taskId}`, value);

    return new Response('OK', { status: 200, headers: corsHeaders(origin) });
  }

  // DELETE /reminder — remove a reminder from KV
  if (request.method === 'DELETE' && pathname === '/reminder') {
    const { taskId } = await request.json();
    if (!taskId) {
      return new Response('Missing taskId', { status: 400, headers: corsHeaders(origin) });
    }
    await env.REMINDERS.delete(`reminder:${taskId}`);
    return new Response('OK', { status: 200, headers: corsHeaders(origin) });
  }

  return new Response('Not Found', { status: 404, headers: corsHeaders(origin) });
}

async function handleScheduled(env) {
  // Implemented in Task 7
}

export default {
  fetch: handleRequest,
  scheduled: (event, env) => handleScheduled(env),
};
```

- [ ] **Step 2: Commit**

```bash
git add worker/index.js
git commit -m "feat: add Worker HTTP routes for subscribe and cancel"
```

---

## Task 7: Implement the Cron Trigger

Add the scheduled handler to `worker/index.js`. This runs every minute, lists all KV entries, fires pushes for due reminders, and deletes them.

**Files:**
- Modify: `worker/index.js`

- [ ] **Step 1: Replace the `handleScheduled` stub in worker/index.js**

Find this block in `worker/index.js`:
```javascript
async function handleScheduled(env) {
  // Implemented in Task 7
}
```

Replace it with:
```javascript
async function handleScheduled(env) {
  const now = Date.now();
  const { keys } = await env.REMINDERS.list({ prefix: 'reminder:' });

  await Promise.all(keys.map(async ({ name }) => {
    const raw = await env.REMINDERS.get(name);
    if (!raw) return;

    const { subscription, taskTitle, reminderMs } = JSON.parse(raw);

    if (reminderMs > now) return; // not yet due

    // Due: send push and delete (delete even if push fails to avoid repeat fires)
    await env.REMINDERS.delete(name);
    await sendWebPush(subscription, 'Task Reminder', taskTitle, env);
  }));
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/index.js
git commit -m "feat: add cron trigger to fire due push reminders"
```

---

## Task 8: Deploy Worker and test endpoints

- [ ] **Step 1: Start Wrangler dev server** (run from `worker/` directory)

```bash
cd worker
wrangler dev
```

Expected output includes:
```
⎔ Starting local server...
[wrangler:info] Ready on http://localhost:8787
```

Leave this running in one terminal. Open a second terminal for the curl tests.

- [ ] **Step 2: Test CORS preflight**

```bash
curl -i -X OPTIONS http://localhost:8787/subscribe \
  -H "Origin: http://localhost:8080" \
  -H "Access-Control-Request-Method: POST"
```

Expected: `204 No Content` with `Access-Control-Allow-Origin: http://localhost:8080`

- [ ] **Step 3: Test POST /subscribe**

```bash
curl -i -X POST http://localhost:8787/subscribe \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:8080" \
  -d '{
    "subscription": {
      "endpoint": "https://example.com/push/fake",
      "keys": { "p256dh": "fake", "auth": "fake" }
    },
    "taskId": "test123",
    "taskTitle": "Buy milk",
    "reminderMs": 1000
  }'
```

Expected: `200 OK`

- [ ] **Step 4: Test DELETE /reminder**

```bash
curl -i -X DELETE http://localhost:8787/reminder \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:8080" \
  -d '{"taskId": "test123"}'
```

Expected: `200 OK`

- [ ] **Step 5: Test the scheduled handler manually**

In the wrangler dev terminal, press `Shift+D` to trigger the scheduled event (or use `wrangler dev --test-scheduled` and visit `http://localhost:8787/__scheduled`).

Expected: handler runs, no errors in console (the fake subscription from Step 3 was already deleted).

- [ ] **Step 6: Stop the local server** (Ctrl+C), then deploy to Cloudflare**

```bash
wrangler deploy
```

Expected output:
```
✅ Successfully published your Worker to https://task-reminders.<your-account>.workers.dev
```

Copy the Worker URL — you will need it in Task 10.

- [ ] **Step 7: Test the deployed endpoint**

```bash
curl -i -X POST https://task-reminders.<your-account>.workers.dev/subscribe \
  -H "Content-Type: application/json" \
  -H "Origin: https://jeffellenbogen.github.io" \
  -d '{
    "subscription": {"endpoint":"https://example.com/fake","keys":{"p256dh":"x","auth":"y"}},
    "taskId": "deploy-test",
    "taskTitle": "Deploy test",
    "reminderMs": 1
  }'
```

Expected: `200 OK`

- [ ] **Step 8: Clean up test entry from KV**

```bash
curl -i -X DELETE https://task-reminders.<your-account>.workers.dev/reminder \
  -H "Content-Type: application/json" \
  -H "Origin: https://jeffellenbogen.github.io" \
  -d '{"taskId": "deploy-test"}'
```

Expected: `200 OK`

---

## Task 9: Update sw.js — push event listener

When the Worker sends a push, the Service Worker receives a `push` event and shows the notification. This fires even when the app is closed.

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: Open sw.js**

Current content (full file):
```javascript
const CACHE = 'taskmanager-v4';
const ASSETS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', e => { ... });
self.addEventListener('activate', e => { ... });
self.addEventListener('fetch', e => { ... });
self.addEventListener('notificationclick', e => { ... });
```

- [ ] **Step 2: Add the `push` event listener before the `notificationclick` handler**

Open `sw.js` and add this block after the `fetch` listener, before `notificationclick`:

```javascript
self.addEventListener('push', e => {
  let title = 'Task Reminder';
  let body = 'You have a task reminder.';

  if (e.data) {
    try {
      const data = e.data.json();
      title = data.title || title;
      body = data.body || body;
    } catch (_) {}
  }

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'push-reminder',
    })
  );
});
```

- [ ] **Step 3: Bump the cache version** so installed PWAs pick up the new sw.js

Change line 1 of `sw.js`:
```javascript
const CACHE = 'taskmanager-v5';
```

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "feat: add push event listener to service worker"
```

---

## Task 10: Update index.html — push subscription and registration

This task wires the app to the Worker: subscribing to Web Push on load, registering reminders when tasks are saved, and cancelling them when tasks are deleted.

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the VAPID public key and Worker URL constants**

Find the opening of the `<script>` block near the bottom of `index.html`. Add these two constants at the very top of the script, before any existing variable declarations:

```javascript
const VAPID_PUBLIC_KEY = 'YOUR_BASE64URL_PUBLIC_KEY_FROM_TASK_3';
const WORKER_URL = 'https://task-reminders.<your-account>.workers.dev';
```

Replace both placeholder values with your real values from Tasks 3 and 8.

- [ ] **Step 2: Add a module-level variable for the push subscription**

Add this line near the other module-level variables (near `let filter = 'all'`):

```javascript
let pushSubscription = null;
```

- [ ] **Step 3: Add the push helper functions**

Add these functions right after the `scheduleReminders()` function (around line 528):

```javascript
// ── Web Push ────────────────────────────────────────────────────────
function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    pushSubscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  } catch (err) {
    console.warn('Push subscription failed:', err);
  }
}

async function registerReminder(task) {
  if (!pushSubscription) return;
  const ms = reminderMs(task);
  if (!ms) return;
  try {
    await fetch(`${WORKER_URL}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: pushSubscription.toJSON(),
        taskId: task.id,
        taskTitle: task.title,
        reminderMs: ms,
      }),
    });
  } catch (err) {
    console.warn('Failed to register reminder with Worker:', err);
  }
}

async function cancelReminder(taskId) {
  if (!pushSubscription) return;
  try {
    await fetch(`${WORKER_URL}/reminder`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });
  } catch (err) {
    console.warn('Failed to cancel reminder with Worker:', err);
  }
}
```

- [ ] **Step 4: Call `initPush()` on app load**

Find the bottom of `index.html` where initialization runs. It currently ends with:
```javascript
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
  scheduleReminders();
```

Add `initPush()` after `scheduleReminders()`:
```javascript
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
  scheduleReminders();
  initPush();
```

- [ ] **Step 5: Call `registerReminder()` when a task with a reminder is saved**

Find the section that saves a new task (the `addTask` function or equivalent `submit` handler, around the `save(); render();` call for new tasks). Look for where tasks are pushed to the `tasks` array. After the task is pushed to `tasks` and `save()` is called, add:

```javascript
if (task.reminder && task.reminder !== 'none') registerReminder(task);
```

Also find where an **edited/updated** task is saved (if such a path exists — per CLAUDE.md there's no edit mode, so only the new-task path matters).

- [ ] **Step 6: Call `cancelReminder()` when a task is soft-deleted**

Find the `softDelete` function (or wherever `tasks` items are moved to `trash`). After the deletion logic and before or after `save(); render();`, add:

```javascript
cancelReminder(deletedTask.id);
```

You'll need to capture the task reference before removing it. If the function receives a `taskId`, look up the task first:
```javascript
const deletedTask = tasks.find(t => t.id === taskId);
tasks = tasks.filter(t => t.id !== taskId);
trash.unshift(deletedTask);
save();
render();
cancelReminder(taskId);
```

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: integrate Web Push subscription and reminder registration with Worker"
```

---

## Task 11: End-to-end test and deploy to GitHub Pages

- [ ] **Step 1: Serve the app locally**

```bash
python3 -m http.server 8080
```

- [ ] **Step 2: Open http://localhost:8080 in Chrome (desktop) for initial verification**

Chrome has better push debugging tools than iOS Safari. Open DevTools → Application → Service Workers. Confirm the new sw.js (v5) is registered.

- [ ] **Step 3: Create a test task with a reminder 2 minutes from now**

In the app, add a task. Set a reminder to "At due time" and set the due date/time to 2 minutes from now. Save it.

- [ ] **Step 4: Verify the subscription was registered with the Worker**

Open DevTools → Network. You should see a `POST /subscribe` request to your Worker URL returning `200 OK`.

If the request fails: check the browser console for the "Failed to register reminder" warning. Common causes: VAPID public key is wrong (re-check the constant), or the Worker URL is wrong.

- [ ] **Step 5: Verify the KV entry was created**

```bash
cd worker
wrangler kv:key list --binding REMINDERS
```

Expected: a key starting with `reminder:` for your test task.

- [ ] **Step 6: Wait 2 minutes with localhost:8080 tab closed or backgrounded**

Close the `http://localhost:8080` tab (or navigate away). Wait for the reminder time to pass. The Worker's cron will fire within 60 seconds of the reminder time.

- [ ] **Step 7: Check that the notification appeared**

On desktop Chrome, check the notification tray. You should see "Task Reminder" with the task title as the body.

If no notification: check the Worker logs.
```bash
wrangler tail
```
Look for errors. Common cause: the push endpoint is a localhost Chrome subscription, which the Worker can reach. If this works on desktop, it will work on iOS once deployed.

- [ ] **Step 8: Push to GitHub and test on iOS**

```bash
git push origin main
```

Wait 1-2 minutes for GitHub Pages to deploy. Then on your iPhone:
1. Open the Task Manager app from your Home Screen
2. Create a task with a reminder 3 minutes from now
3. Close the app completely (swipe it away)
4. Wait for the reminder time
5. You should receive a notification even with the app closed

- [ ] **Step 9: Clean up test tasks**

Delete the test task in the app.

- [ ] **Step 10: Final commit if any last-minute fixes were made**

```bash
git add -p  # review any remaining changes
git commit -m "fix: <describe any final fixes>"
git push origin main
```

---

## Troubleshooting Reference

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `POST /subscribe` returns 400 | Missing fields in request body | Check that `reminderMs` is a number and `subscription.keys` exists |
| Push subscription fails in browser | VAPID public key format wrong | Ensure the key is the raw base64url-encoded 65-byte P-256 point, not a JWK |
| Worker sends push but notification doesn't appear on iOS | App not installed to Home Screen, or iOS < 16.4 | Install via Share → Add to Home Screen |
| Cron fires but push fails with 401 | VAPID private key JWK malformed in Cloudflare secrets | Re-run `wrangler secret put VAPID_PRIVATE_KEY` with the correct JSON |
| Duplicate notifications (one from Worker, one from in-app polling) | Both systems fire when app is open | Acceptable for this project; in-app `firedReminders` Set prevents double in-app fires |
| Notification fires but app doesn't open when tapped | `notificationclick` handler in sw.js | Already present — check cache version was bumped so the new sw.js is active |
