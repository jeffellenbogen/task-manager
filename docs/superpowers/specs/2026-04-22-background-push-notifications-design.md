# Background Push Notifications via Cloudflare Workers

**Date:** 2026-04-22
**Status:** Approved

## Problem

The existing reminder system uses `setInterval` in the browser tab. When the app is closed or backgrounded on iOS, JavaScript stops running, so no reminders fire. Opening the app catches missed reminders within a 10-minute window, but reminders don't fire proactively.

## Goal

Notifications fire at the scheduled time even when the app is fully closed, on iOS 16.4+ with the PWA installed to the Home Screen.

## Approach: Web Push via Cloudflare Workers

A Cloudflare Worker acts as the push server. It holds VAPID keys, stores scheduled reminders in Workers KV, and sends Web Push messages via a Cron Trigger. The app subscribes to push and registers reminders with the Worker when they are created.

## Architecture

```
[App: index.html]
  - Subscribes to Web Push using VAPID public key
  - On reminder save: POST subscription + reminder time + task info to Worker
  - On task delete: POST to Worker to cancel the reminder
  - On app open: existing in-app polling continues as fallback

[Cloudflare Worker: push-server]
  - POST /subscribe   — store reminder entry in KV
  - DELETE /reminder  — remove reminder entry from KV
  - Cron Trigger (every minute) — scan KV for due reminders, send Web Push, delete entry

[Workers KV]
  - Key: `{reminderTimestamp}:{taskId}`
  - Value: { endpoint, keys: { p256dh, auth }, taskTitle, taskId }

[Service Worker: sw.js]
  - Existing cache/fetch/notificationclick handlers unchanged
  - New: `push` event listener — receives Worker's message, calls showNotification()
```

## Secrets Management

| Secret | Where it lives | Notes |
|--------|---------------|-------|
| VAPID private key | Cloudflare Worker environment secret (set via `wrangler secret put`) | Never in code or git |
| VAPID public key | `index.html` JS (hardcoded) | Safe to be public by design |
| Cloudflare API token | Developer's machine only (used by wrangler CLI) | Never committed |
| `.dev.vars` | `.gitignore`d | Local wrangler dev secrets file |

VAPID keys are generated once using a script (`npx web-push generate-vapid-keys`). The private key goes directly into Cloudflare via CLI. The public key is pasted into `index.html`.

## New Files

- `worker/index.js` — Cloudflare Worker (handles HTTP routes + cron)
- `worker/wrangler.toml` — Worker config (KV binding, cron schedule, Worker name)
- `worker/.dev.vars` — local secrets (gitignored)
- `.gitignore` — add `.dev.vars` entry

## Changes to Existing Files

**`index.html`**
- Add `subscribeToPush()` — called after notification permission granted; gets push subscription from browser, POSTs to Worker
- Add `registerReminder(task)` — called when a task with a reminder is saved; POSTs reminder entry to Worker
- Add `cancelReminder(taskId)` — called when a task is deleted; sends DELETE to Worker
- VAPID public key constant added at top of script block

**`sw.js`**
- Add `push` event listener — parses push payload, calls `self.registration.showNotification()`

## Edge Cases

- **Task deleted before reminder fires:** Worker attempts push; browser rejects it silently (subscription is still valid, but we display a stale task title — acceptable for a learning project).
- **App offline when reminder time passes:** Push is sent by Worker but delivery is queued by the browser/OS until the device is online.
- **Permission denied:** `subscribeToPush()` exits early; app falls back to in-app-only reminders.
- **Worker KV eventually consistent:** Cron window is 1 minute; reminders may fire up to ~60s late, which is acceptable.

## Setup Sequence (for implementation)

1. Create free Cloudflare account at cloudflare.com
2. Install wrangler CLI: `npm install -g wrangler`
3. Login: `wrangler login`
4. Generate VAPID keys: `npx web-push generate-vapid-keys`
5. Create Workers KV namespace: `wrangler kv:namespace create REMINDERS`
6. Store VAPID private key: `wrangler secret put VAPID_PRIVATE_KEY`
7. Update `wrangler.toml` with KV namespace ID
8. Deploy Worker: `wrangler deploy`
9. Update `index.html` with Worker URL + VAPID public key
10. Push to GitHub → GitHub Pages serves updated app

## Out of Scope

- Multi-user support (single user only)
- Editing tasks (existing constraint — no edit mode)
- Cleaning up stale KV entries for deleted tasks (silent failure is acceptable)
- Analytics or delivery receipts
