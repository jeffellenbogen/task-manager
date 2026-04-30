# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A mobile-first PWA task manager deployed to GitHub Pages, with a Cloudflare Worker (`worker/`) acting as a Web Push server so reminders fire even when the app is fully closed.

The app itself (`index.html`) has no build system, no package manager, and no framework — a single HTML file with inline CSS and vanilla JavaScript. The Worker is a separate npm-based project, managed by Wrangler.

## Development

App:

```
python3 -m http.server 8080
```

Pushing to `main` publishes via GitHub Pages (`.nojekyll` bypasses Jekyll).

Worker (from `worker/`):

```
npx wrangler dev --test-scheduled    # local, uses worker/.dev.vars (gitignored)
npx wrangler deploy                  # deploy to task-reminders.<subdomain>.workers.dev
```

Secrets (`VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`) are managed via `wrangler secret put` — never committed.

## Architecture

### App (`index.html`)

- **State** — `tasks[]` and `trash[]` arrays, persisted to `localStorage` as JSON. Each task has: `id`, `title`, `priority` (high/medium/low), `cat`, `due`, `dueTime`, `reminder`, `done`, `created`.
- **Render loop** — `render()` is the single source of truth for the DOM. All mutations (toggle, add, edit, delete, restore, reorder) call `save()` then `render()`.
- **Edit mode** — `openEditSheet(id)` reuses the add-task sheet; module-level `editingId` tells `addTask()` whether to create or update.
- **Swipe-to-delete** — `initSwipe(row)` attaches touch events; a left swipe beyond -90px triggers `softDelete()`.
- **Drag-to-reorder** — `initDrag(handle)` uses a ghost element + placeholder (`dg` global). Only available in the "All" filter view.
- **Reminders (foreground)** — `scheduleReminders()` polls every 30s via `setInterval` while the app is open; `checkReminders()` also runs on app open with a 24-hour catch-up window for missed reminders fired while the app was closed.
- **Reminders (background)** — `registerReminder(task)` POSTs the push subscription + reminder time to the Worker on save; `cancelReminder(taskId)` DELETEs on soft-delete or when an edit removes the reminder. `initPush()` subscribes to PushManager on app load using `VAPID_PUBLIC_KEY`.
- **Service Worker** (`sw.js`) — cache-first fetch handler for offline. `push` event listener calls `self.registration.showNotification()` so reminders fire when the app is closed. Bump the `CACHE` constant to force a refresh of the installed PWA shell.

### Worker (`worker/`)

- `worker/src/index.js` — `POST /subscribe` (store reminder in KV), `DELETE /reminder` (cancel), `OPTIONS` preflight, and `scheduled` cron handler. CORS allowed for `https://jeffellenbogen.github.io` and localhost.
- `worker/src/push.js` — VAPID JWT signing (ES256) + RFC 8291 payload encryption (aes128gcm) using only the Web Crypto API; no npm runtime deps.
- `worker/wrangler.jsonc` — Worker name `task-reminders`, KV binding `REMINDERS` (production + preview), cron `*/5 * * * *`.
- **Cron** — every 5 minutes, `handleScheduled` lists `reminder:*` keys, fires Web Push for due entries, deletes them (even on push failure, to avoid repeat fires).
- **Cron frequency = 5 min** — Cloudflare KV's free tier caps `list` operations at 1,000/day. `*/5` does 288 lists/day, leaving headroom for write/delete ops that also count toward the daily quota. Reminders may fire up to ~5 min late as a result.
- **`reminderMs` stored in KV metadata** — `handleScheduled` filters non-due entries via `list` metadata, avoiding an extra `get()` per key. The value itself still contains `reminderMs` for backward compatibility.

### Data Flow

```
[App save] → POST /subscribe { subscription, taskId, taskTitle, reminderMs } → [KV: reminder:<taskId>]
                                                                                        ↓ (cron, 1/min)
                                                                          Web Push → [sw.js push event → notification]
```

## Key Constraints

- **`id` generation** — `Date.now().toString(36) + Math.random().toString(36).slice(2)` — used as DOM `data-id`, notification `tag`, and Worker KV keys; must remain a unique string.
- **Filter state** — `filter` is a module-level variable; switching filters re-runs `render()` without touching state.
- **Drag reorder only works in "All" filter** — drag handles are hidden elsewhere because reordering a filtered subset would produce confusing results in the full list.
- **iOS push requires Home Screen install on iOS 16.4+** — Web Push on iOS only fires for PWAs installed via Share → Add to Home Screen.
- **`VAPID_PUBLIC_KEY` and `WORKER_URL` constants in `index.html` are hardcoded** — public key is public by design; if the Worker is redeployed under a different subdomain, `WORKER_URL` must be updated.
