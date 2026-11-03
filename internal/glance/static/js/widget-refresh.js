import { enhanceWidget } from './page.js';
import { morph } from './morph.js';
import { rememberServerRender, sweepRemovedElements } from './lifecycle.js';

// Per-widget interval handles, keyed by widget id.
const intervals = new Map();
const intervalSeconds = new Map();
const lastRefreshAt = new Map();
const etags = new Map();
const inFlight = new Set();

let baseURL = "";
let visibilityListenerInstalled = false;

export function setupWidgetRefresh(_baseURL) {
    baseURL = _baseURL;

    document.querySelectorAll(".widget[data-refresh-interval]").forEach((widgetEl) => {
        const seconds = parseInt(widgetEl.dataset.refreshInterval, 10);
        if (!seconds || seconds < 1) return;
        const id = widgetEl.dataset.widgetId;
        if (!id) return;
        intervalSeconds.set(id, seconds);
        startInterval(id, seconds);
    });

    if (visibilityListenerInstalled) return;
    visibilityListenerInstalled = true;
    if (document.hidden === undefined) return;

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            for (const handle of intervals.values()) clearInterval(handle);
            intervals.clear();
            return;
        }

        const now = Date.now();
        intervalSeconds.forEach((seconds, id) => {
            const last = lastRefreshAt.get(id) || 0;
            if (now - last >= seconds * 1000) refreshWidget(id);
            startInterval(id, seconds);
        });
    });
}

function startInterval(id, seconds) {
    const existing = intervals.get(id);
    if (existing !== undefined) clearInterval(existing);
    intervals.set(id, setInterval(() => refreshWidget(id), seconds * 1000));
}

function stopInterval(id) {
    const handle = intervals.get(id);
    if (handle !== undefined) {
        clearInterval(handle);
        intervals.delete(id);
    }
    intervalSeconds.delete(id);
    lastRefreshAt.delete(id);
    etags.delete(id);
}

function findWidget(id) {
    return document.querySelector(`.widget[data-widget-id="${CSS.escape(id)}"]`);
}

async function refreshWidget(id) {
    if (findWidget(id) === null) {
        stopInterval(id);
        return;
    }

    // A slow upstream can make a request outlast the interval; don't stack them.
    if (inFlight.has(id)) return;
    inFlight.add(id);
    lastRefreshAt.set(id, Date.now());

    try {
        const headers = {};
        if (etags.has(id)) headers["If-None-Match"] = etags.get(id);

        const res = await fetch(`${baseURL}/api/widgets/${encodeURIComponent(id)}/refresh`, {
            credentials: "same-origin",
            cache: "no-store",
            headers,
        });

        // Same render as last time: nothing to do, and nothing gets repainted.
        if (res.status === 304) return;

        if (!res.ok) {
            // 404 means the widget id is unknown to the server (e.g., after a
            // config reload that reassigned ids). Don't keep retrying — a full
            // page reload will repopulate intervals with fresh ids.
            if (res.status === 404) stopInterval(id);
            return;
        }

        const html = await res.text();
        const target = findWidget(id);
        if (target === null) return;

        applyRender(target, html);

        const etag = res.headers.get("ETag");
        if (etag !== null) etags.set(id, etag);
    } catch (e) {
        console.error("widget refresh failed", id, e);
    } finally {
        inFlight.delete(id);
    }
}

function applyRender(widgetEl, html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const next = template.content.firstElementChild;
    if (next === null) return;

    // Masonry moves the server's children into client-made columns, so the
    // live DOM no longer mirrors the server's structure and can't be patched.
    if (widgetEl.querySelector(".masonry") !== null) {
        const replacement = document.importNode(next, true);
        rememberServerRender(replacement);
        widgetEl.replaceWith(replacement);
        widgetEl = replacement;
    } else {
        morph(widgetEl, next);
    }

    sweepRemovedElements();
    enhanceWidget(widgetEl);
}
