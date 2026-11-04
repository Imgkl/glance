import { enhanceWidget } from './page.js';
import { morph } from './morph.js';
import { rememberServerRender, sweepRemovedElements } from './lifecycle.js';

// Refreshes each widget when the server says its data is next due: when its
// cache expires, on the hour, or at an early retry after an error. The server
// sends the delays (in milliseconds) with the page content and then with each
// refresh, so the browser never polls faster than the data can change.
// Nothing runs while the page is hidden.

const RETRY_AFTER_FAILURE = 30_000;

const dueAt = new Map();   // widget id -> timestamp of its next refresh
const timers = new Map();  // widget id -> timeout handle
const etags = new Map();
const inFlight = new Set();

let baseURL = "";
let visibilityListenerInstalled = false;

export function setupWidgetRefresh(_baseURL, schedule) {
    baseURL = _baseURL;

    for (const [id, delay] of Object.entries(schedule)) {
        scheduleRefresh(id, delay);
    }

    if (visibilityListenerInstalled || document.hidden === undefined) return;
    visibilityListenerInstalled = true;

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            for (const handle of timers.values()) clearTimeout(handle);
            timers.clear();
            return;
        }

        // Whatever came due while hidden refreshes now; the rest resume.
        const now = Date.now();
        dueAt.forEach((at, id) => scheduleRefresh(id, at - now));
    });
}

// Refreshes a widget right away, whenever it's next due. Used by the browser
// check in dev/ to exercise refreshes without waiting on real data.
export function refreshWidgetNow(id) {
    return refreshWidget(id);
}

function scheduleRefresh(id, delay) {
    clearTimeout(timers.get(id));
    dueAt.set(id, Date.now() + delay);

    if (!document.hidden) {
        timers.set(id, setTimeout(() => refreshWidget(id), Math.max(delay, 0)));
    }
}

function stopRefreshing(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    dueAt.delete(id);
    etags.delete(id);
}

function findWidget(id) {
    return document.querySelector(`.widget[data-widget-id="${CSS.escape(id)}"]`);
}

async function refreshWidget(id) {
    if (findWidget(id) === null) {
        stopRefreshing(id);
        return;
    }

    if (inFlight.has(id)) return;
    inFlight.add(id);
    clearTimeout(timers.get(id));

    let next = RETRY_AFTER_FAILURE;

    try {
        const headers = {};
        if (etags.has(id)) headers["If-None-Match"] = etags.get(id);

        const res = await fetch(`${baseURL}/api/widgets/${encodeURIComponent(id)}/refresh`, {
            credentials: "same-origin",
            cache: "no-store",
            headers,
        });

        // 404 means the widget id is unknown to the server (e.g., after a
        // config reload that reassigned ids). A page reload picks up new ones.
        if (res.status === 404) {
            next = null;
            return;
        }

        if (res.status === 304 || res.ok) {
            const refreshIn = res.headers.get("X-Widget-Refresh-In");
            next = refreshIn === null ? null : parseInt(refreshIn, 10);
        }

        // A 304 is the same render as last time: nothing gets repainted.
        // Other failures try again after RETRY_AFTER_FAILURE.
        if (!res.ok) return;

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

        if (next === null) {
            stopRefreshing(id);
        } else {
            scheduleRefresh(id, next);
        }
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
