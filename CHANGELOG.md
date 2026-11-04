# Changelog

Personal fork of [glanceapp/glance](https://github.com/glanceapp/glance).
Versions are calendar-based (`vYYYY.MM.N`) so they never collide with
upstream's tags. Each release lists what was merged from upstream separately
from the fork's own changes.

Images: `ghcr.io/imgkl/glance:<version>` (published by CI on tag push).

## v2026.11.1 — 2026-11-04

### Fork
- Changed: widgets refresh when their `cache` expires, so `cache` alone sets
  how fresh a widget is. The page asks the server when each widget is next due
  (on cache expiry, on the hour, or at an early retry after an error) instead
  of polling on a fixed timer. The floor is 2 seconds.
- Removed: `refresh-interval`. Configs that still set it fail to load with a
  message pointing at `cache`. To convert, set `cache` to whichever of the two
  values was longer.
- Changed: every widget with data to fetch refreshes, not just ones opted in.
  Widgets with nothing to fetch (`clock`, `bookmarks`, `search`, ...) and
  containers (`group`, `split-column`) don't; their children refresh on their own.

## v2026.11.0 — 2026-11-03

### Upstream
- Merged glanceapp/glance **v0.8.7** (from v0.8.4): X-Forwarded-For rate-limit
  bypass fix, auth request body limit, server read timeouts, HTTPS Docker
  endpoints, Reddit signed-out/guest-token fixes, RSS relative URL fixes,
  AdGuard latency fix, unhealthy container detection, custom-api basic auth
  and `withAllowInsecure`, passwordless Pi-hole 6, Go and Alpine bumps.

### Fork
- Fixed: widget refresh no longer rebuilds the widget. Unchanged renders are
  skipped (the refresh endpoint now answers `304` via ETag) and changed ones
  are patched in place, so the page no longer flickers and images don't reload.
- Fixed: anything opened on a widget survives refreshes: AdGuard's "Top blocked
  domains" dropdown, hover popovers, "Show more" lists, carousel scroll.
- Changed: client-side widget setup (carousels, collapsible lists and grids,
  lazy images, truncated titles, masonry) is safe to re-run on refreshed widgets.
- Removed: the snapshot/restore and image-fade workarounds from `v0.8.4-pwr2`.
- Added: `dev/refresh-check.cjs`, a browser check for the above against a live
  instance.

## Baseline — fork changes before this changelog

Released as `v0.8.4-pwr` and `v0.8.4-pwr2`, on top of upstream v0.8.4.

- Per-widget `refresh-interval` (5s minimum; not allowed on static or
  interactive widget types) and the `/api/widgets/{id}/refresh` endpoint.
- Per-widget locking instead of a page-wide lock; widgets nested in groups and
  split columns are refreshable by ID.
- CI publishes multi-arch images to `ghcr.io/imgkl/glance`.
