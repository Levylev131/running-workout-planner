# CLAUDE.md — Run & Workout Planner

Guidance for working in this folder specifically. This is a standalone static web app with its own git repo, nested inside the parent Desktop folder — unrelated to `controller_tracker.py` at the top level.

## What this is

Mobile-first static HTML/JS app to plan runs/workouts and log what actually happened (plan vs. actual). No build step, no backend, no framework. Installed as a PWA on the user's iPhone (Add to Home Screen).

## Running it

No install/build needed. Serve the folder and open `index.html`:

```bash
python -m http.server 8791
```

- On this PC: `http://localhost:8791/index.html` (secure context — geolocation and the service worker both work here)
- On the user's phone (same Wi-Fi): `http://<PC's LAN IP>:8791/index.html` — get the IP with `ipconfig | grep IPv4`. This is a plain-HTTP connection, so real GPS and the service worker's offline caching silently no-op there (falls back to IP-lookup/address search for location; PWA install still works over HTTP).

## Files

- `index.html` — shell, tab nav (Upcoming / History), modal host, script tags (classic, non-module — see gotcha below)
- `db.js` — IndexedDB layer. Single `sessions` store. Exposes `window.DB = { uid, Sessions }`. Session shape: `{id, type, title, date, status: "planned"|"completed", planned: {distance, duration, notes, route?}, actual: {distance, duration, effort, notes}}`
- `app.js` — UI logic, tab switching, plan/log/edit/delete forms. Card markup lives in `planCardHtml(s)`/`historyCardHtml(s)`/`sessionCardHtml(s)`, bound via `bindCardActions(container)` — reused by both the Upcoming/History lists and the calendar's day-detail modal, so don't reintroduce inline card HTML elsewhere.
- `calendar.js` — Calendar tab: month grid + week agenda (toggle between them), day-detail modal (`openDayModal`) for viewing/adding/editing sessions by date. **Must load before `app.js` in `index.html`** — `app.js` calls `renderCalendarTab()` at the bottom on init, and classic scripts execute in tag order sharing one global scope, so the reverse order throws a silent unhandled-rejection on first load.
- `routes.js` — IIFE-wrapped map/route builder (Leaflet + OpenStreetMap via CDN). Exposes only `window.openRouteBuilder` / `window.viewRouteModal`. Location fallback chain: real GPS → `locateApprox()` (ipapi.co IP lookup) → static default, plus a Nominatim address search bar (`searchPlace()`). A `userOverride` flag stops the async auto-locate from clobbering a manual search/drawn point after the fact.
- `styles.css` — shared palette with `Personal Dashboard/styles.css` (`--accent: #4a6d5c` light / `#5c9179` dark default) for visual consistency across the user's tools. Theme vars live in `:root`, a `prefers-color-scheme: dark` media block, and `:root[data-theme="dark"]` (explicit override wins). `--accent-soft` (badge backgrounds) is *derived* from `--accent` via `color-mix()`, not a fixed hex — so it stays coherent whether the user is on the default color or a custom-picked one. Any new element using `--accent`-adjacent color needs a `background` set explicitly on inputs/selects/textareas — the browser's native white form-control background does NOT respond to CSS vars alone (bit us once already, see gotchas).
- `manifest.json` / `sw.js` / `icons/` — PWA support (added 2026-07-30). Service worker is same-origin cache-first for the app shell only; map tiles/geolocation/Nominatim calls always pass through to network. Registration is guarded to only attempt on `https:` or `localhost`. **Bump `CACHE_NAME` in `sw.js` any time an app-shell file changes** (currently v5) — the installed iPhone PWA needs a full close-and-reopen (not just a refresh) to pick up the update afterward.

## Theming (dark mode + custom accent color, added 2026-07-30)

Settings live behind the gear icon in the header (`#settings-btn` → `openSettingsModal()` in `app.js`), not a direct toggle. Two independent choices, both in `localStorage` and both applied via an inline `<script>` in `index.html`'s `<head>` **before** `styles.css` paints (avoids a flash of the wrong theme):
- `theme` — `"light"` / `"dark"`, sets `data-theme` attribute on `<html>`. No explicit choice → follows system `prefers-color-scheme`.
- `accentColor` — hex string from a native `<input type="color">`, applied as an inline `style.setProperty("--accent", ...)` on `<html>` so it overrides the stylesheet's theme-based default regardless of light/dark.

If adding new themeable UI, use CSS vars (`--bg`, `--panel`, `--border`, `--text`, `--text-dim`, `--accent`, `--accent-soft`, `--danger`, `--workout-soft`, `--workout-accent`) — never a hardcoded hex — or it won't respond to dark mode or a custom accent.

## Known gotchas (already hit and fixed — don't reintroduce)

- `db.js` and `app.js` load as classic `<script>` tags sharing one global scope. Don't re-declare `const { Sessions, uid } = window.DB` in `app.js` — those names are already global from `db.js`; redeclaring collides.
- Any numeric `<input>` that gets a value from something other than direct typing (e.g. route-computed distance with 2 decimals) needs `step="any"`, not `step="0.1"` — mismatched step blocks form submission via native HTML5 validation with **zero console output**. Looks like "Save does nothing."
- Real GPS and the service worker both require a secure context. This app is normally accessed over plain HTTP via LAN IP on the phone, so both degrade gracefully by design — don't "fix" this by chasing HTTPS unless the user brings it up. **Local HTTPS/mkcert was tried and explicitly abandoned by the user** (alarmed by running an unfamiliar binary against the Windows trust store) — do not revisit unless they explicitly ask again.
- `.modal input/select/textarea` need an explicit `background: var(--panel)` — without it they inherit the browser's native white form-control background regardless of any `color` CSS var, producing near-invisible light-on-white text in dark mode. Any new form-control CSS in this project must set both `color` and `background` from vars.
- **Testing gotcha, not a code bug:** when iterating on files and testing via claude-in-chrome against a long-lived `python -m http.server` port, the *browser's plain HTTP cache* (not the service worker — that's a separate, already-understood issue) can keep serving stale JS/CSS across normal navigations indefinitely, even after unregistering the SW and clearing Cache Storage. `curl` to the same port confirms the server has fresh content. Fastest fix: bump to a brand-new port for that test session rather than debugging the cache.

## Ideas backlog (not started — ask before picking one up)

- **Strava integration** — parked at the user's request (2026-07-30). Would auto-pull actual run data instead of manual entry. Needs a small backend for OAuth token exchange (Strava requires a client secret, no PKCE), so this is the point a lightweight server (e.g. Flask) becomes necessary — first backend this project would need.
- If auto-generated loop routes (vs. manual drawing) come up again: user rejected GraphHopper specifically because it required a separate account/API key, not because of network calls in general — a no-signup option (Overpass API, OpenRouteService) would likely land better.

## Session memory

This file covers durable architecture/conventions/backlog. Cross-session narrative (what changed, when, why, testing history) lives in the auto-memory file — update `project_running_workout_planner.md` and `MEMORY.md` at the end of a session per the root `CLAUDE.md` convention, not here.
