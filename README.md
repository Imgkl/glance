# Glance

A self-hosted dashboard where every widget refreshes live, in place, without reloading the page. Forked from [glanceapp/glance](https://github.com/glanceapp/glance).

Stock Glance shows what it fetched when the page loaded; to see new data you reload. Here each widget refreshes as soon as its cache expires, and only what changed is touched. Images don't reload, nothing flickers, and anything you opened (a "Show more" list, a dropdown, a popover) stays open.

## What it does

- **`cache` is the refresh rate.** `cache: 5s` means the widget is never more than 5 seconds out of date while you're looking at it. There's no separate setting, and the floor is 2 seconds. Hourly widgets (weather) refresh on the hour, and after a failed update the page follows the widget's early retry.
- **Only while someone is looking.** Nothing is fetched when no dashboard is open, and a background tab stops refreshing until it's visible again.
- **Skips unchanged widgets.** The refresh endpoint answers `304 Not Modified` when the render is the same.
- **Patches changed ones.** Only the server's changes are applied to the live page. Rows are matched by what they link to or show, so added, removed or reordered items keep their elements.
- **Works for widgets nested** in `group` and `split-column`, and each widget refreshes under its own lock.

Everything else is upstream Glance: see the [configuration docs](docs/configuration.md#cache).

## Run

Images for amd64, arm64 and armv7 are on GitHub Container Registry:

```yaml
services:
  glance:
    image: ghcr.io/imgkl/glance:v2026.11.0
    volumes:
      - ./config:/app/config
    ports:
      - 8080:8080
```

## Develop

```bash
go run .
go test ./...
```

`dev/refresh-check.cjs` opens a real browser against a running instance and checks that refreshes keep opened state and rebuild nothing. It expects the widgets it names (AdGuard, Tailscale, Server Stats, Prowlarr).

## Versions

Calendar versions (`vYYYY.MM.N`), so they never clash with upstream's tags. Pushing a `v*` tag publishes the images. The [changelog](CHANGELOG.md) lists upstream merges separately from changes made here.

To take an upstream release, merge its tag (`git fetch upstream --tags && git merge v0.8.8`) rather than rebasing. If upstream's README conflicts, keep this one.
