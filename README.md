<p align="center"><img src="docs/logo.png"></p>
<h1 align="center">Glance</h1>

<p align="center">A fork of <a href="https://github.com/glanceapp/glance">glanceapp/glance</a> where widgets refresh live, in place, without reloading the page.</p>

<p align="center">
  <a href="#whats-different">What's different</a> •
  <a href="#running-it">Running it</a> •
  <a href="docs/configuration.md#configuring-glance">Configuration</a> •
  <a href="CHANGELOG.md">Changelog</a>
</p>

![](docs/images/readme-main-image.png)

Everything upstream Glance does works the same here; its
[configuration docs](docs/configuration.md), [themes](docs/themes.md) and
[preconfigured pages](docs/preconfigured-pages.md) still apply. This fork adds
live refresh on top and tracks upstream releases.

## What's different

### Live per-widget refresh

Any widget can refresh itself in the browser on its own schedule:

```yaml
- type: docker-containers
  refresh-interval: 30s
```

- The minimum is `5s`. Widgets with no data to refresh or with their own
  client-side state (`calendar`, `to-do`, `clock`, `iframe`, `html`, `search`,
  `bookmarks`, `group`, `split-column`) reject it at config load.
- A refresh re-renders the widget, but fetches new data only once its `cache`
  has expired, so a short interval doesn't hammer the services behind it.
- Timers pause while the tab is hidden.

See [`refresh-interval`](docs/configuration.md#refresh-interval) for details.

### No flicker, no lost state

Refreshing doesn't swap the widget out:

- **Unchanged widgets aren't touched.** The refresh endpoint answers `304 Not
  Modified` (via ETag) when the render hasn't changed.
- **Changed widgets are patched in place.** Only what the server changed is
  applied to the page. Rows are matched by what they link to or show, so items
  that are added, removed or reordered keep their elements and images don't
  reload.
- **What you opened stays open.** Expanded "Show more" lists, dropdowns,
  hover popovers and carousel scroll positions survive refreshes.

### Under the hood

| File | Role |
| --- | --- |
| `internal/glance/widget-refresh.go` | `GET /api/widgets/{id}/refresh`: renders one widget, with ETag revalidation |
| `internal/glance/static/js/widget-refresh.js` | Per-widget timers, visibility pausing, fetching |
| `internal/glance/static/js/morph.js` | Patches the live widget toward the new render (three-way merge against the previous one) |
| `internal/glance/static/js/lifecycle.js` | Remembers each server render; cleans up after removed elements |

Widgets are refreshable by ID even when nested in `group` and `split-column`,
and each widget has its own lock, so one slow widget doesn't hold up the page.

## Running it

Multi-arch images (amd64, arm64, armv7) are published to GitHub Container
Registry for every release:

```yaml
services:
  glance:
    container_name: glance
    image: ghcr.io/imgkl/glance:v2026.11.0
    restart: unless-stopped
    volumes:
      - ./config:/app/config
      - /var/run/docker.sock:/var/run/docker.sock:ro # only for docker-containers
    ports:
      - 8080:8080
```

`latest` follows the newest release, but pinning a version from the
[changelog](CHANGELOG.md) keeps upgrades deliberate. For config files and everything else about setting Glance up, see upstream's
[installation guide](https://github.com/glanceapp/glance#installation) and the
[configuration docs](docs/configuration.md).

## Versions

Releases use calendar versions, `vYYYY.MM.N`, so they never collide with
upstream's tags. Each entry in the [changelog](CHANGELOG.md) lists what was
merged from upstream separately from the fork's own changes.

Pushing a `v*` tag builds and publishes the images (`.github/workflows/release.yaml`).

## Development

Requires Go 1.27+.

```bash
go run .                # run locally
go test ./...           # unit tests
```

`dev/refresh-check.cjs` drives a real browser against a running instance and
checks that refreshes keep opened state and don't rebuild widgets or images.
It expects pages with the widgets it names (AdGuard, Tailscale, Server Stats,
Prowlarr), so adjust it to your own config:

```bash
PLAYWRIGHT=/path/to/node_modules/playwright node dev/refresh-check.cjs http://localhost:8080
```

### Merging upstream

```bash
git fetch upstream --tags
git merge v0.8.8        # upstream's release tag; merge, don't rebase
```

Upstream's README changes always conflict with this one; keep this one. Then
run the tests and the browser check, and add an "Upstream" section to the next
changelog entry.

## Credits

Glance is built by [svilenmarkov](https://github.com/svilenmarkov) and
[contributors](https://github.com/glanceapp/glance/graphs/contributors). Issues
and feature requests for Glance itself belong
[upstream](https://github.com/glanceapp/glance/issues).
