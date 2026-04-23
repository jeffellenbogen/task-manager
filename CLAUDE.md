# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A mobile-first PWA task manager deployed to GitHub Pages. There is no build system, no package manager, and no framework — the entire app is a single `index.html` with inline CSS and vanilla JavaScript.

## Development

Open `index.html` directly in a browser or serve it locally:

```
python3 -m http.server 8080
```

Deployment is automatic: pushing to `main` on GitHub publishes via GitHub Pages (configured in `_config.yml` with `.nojekyll` to bypass Jekyll processing).

## Architecture

Everything lives in `index.html`:

- **State** — `tasks[]` and `trash[]` arrays, persisted to `localStorage` as JSON. Each task has: `id`, `title`, `priority` (high/medium/low), `cat`, `due`, `dueTime`, `reminder`, `done`, `created`.
- **Render loop** — `render()` is the single source of truth for the DOM. All mutations (toggle, add, delete, restore, reorder) call `save()` then `render()`.
- **Swipe-to-delete** — `initSwipe(row)` attaches touch events to each task row. A left swipe beyond -90px triggers `softDelete()`.
- **Drag-to-reorder** — `initDrag(handle)` uses a ghost element + placeholder (`dg` global object) to reorder tasks. Only available in the "All" filter view.
- **Reminders** — `scheduleReminders()` uses `setTimeout` (capped at 7 days out) to fire native `Notification` API alerts. Timers are stored in `remTimers{}` and cleared on each render.
- **Service Worker** (`sw.js`) — cache-first strategy for offline support. Cache version is `taskmanager-v3`; bump this constant to force users to download a fresh app shell.

## Key Constraints

- **No edit mode** — tasks can be created and deleted but not edited. Adding edit would require significant new UI surface.
- **`id` generation** — `Date.now().toString(36) + Math.random().toString(36).slice(2)` — used as DOM `data-id` attributes and notification `tag` values; must remain unique strings.
- **Filter state** — `filter` is a module-level variable; switching filters re-runs `render()` without touching state.
- **Drag reorder only works in "All" filter** — the drag handles are intentionally hidden in other filter views because reordering a filtered subset would produce confusing results in the full list.
