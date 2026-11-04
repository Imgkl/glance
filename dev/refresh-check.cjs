// Checks that widget refreshes patch the page in place: nothing the user
// opened gets closed, and widgets/images aren't rebuilt. Runs against a live
// instance using the home/media pages of this deployment's config.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright node dev/refresh-check.cjs http://localhost:1011
//
// Exits non-zero if any check fails.

const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const base = process.argv[2] || "http://localhost:8080";
const tick = 6500; // AdGuard's cache is 5s in the config this targets

// Refreshes every widget the page would refresh right away, instead of
// waiting for each one's cache to expire, through the page's own module.
const refreshAll = (page) => page.evaluate(async () => {
    const src = [...document.scripts].find((s) => s.src.includes("page.js")).src.replace("page.js", "widget-refresh.js");
    const { refreshWidgetNow } = await import(src);
    const res = await fetch(`/api/pages${location.pathname}/content/`);
    const schedule = JSON.parse(res.headers.get("X-Widget-Refresh-Schedule") || "{}");
    await Promise.all(Object.keys(schedule).map(refreshWidgetNow));
});

const widgetByTitle = (title) => `[...document.querySelectorAll(".widget")].find((w) =>
    w.querySelector(".widget-header")?.innerText.trim().toUpperCase().startsWith(${JSON.stringify(title.toUpperCase())}))`;

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

(async () => {
    const browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1920, height: 1400 } })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // ---- home: state the user opened must survive a refresh ----
    await page.goto(`${base}/home`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    await page.evaluate(`${widgetByTitle("Adgaurd")}.querySelector("details summary").click()`);
    await page.evaluate(`${widgetByTitle("Tailscale")}.querySelector(".expand-toggle-button").click()`);
    await page.hover(".widget-type-server-stats [data-popover-type]");
    await page.waitForTimeout(800);

    const homeState = () => page.evaluate(`({
        adguardOpen: ${widgetByTitle("Adgaurd")}.querySelector("details").open,
        adguardText: ${widgetByTitle("Adgaurd")}.innerText,
        tailscaleExpanded: ${widgetByTitle("Tailscale")}.querySelector(".collapsible-container").classList.contains("container-expanded"),
        tailscaleButtons: ${widgetByTitle("Tailscale")}.querySelectorAll(".expand-toggle-button").length,
        // Chrome re-hovers whatever lands under a still cursor, so a swapped
        // widget re-opens its popover; require the same hovered element instead.
        popoverShown: getComputedStyle(document.querySelector(".popover-container")).display !== "none"
            && (window.__hovered ??= document.querySelector(".popover-active")) !== null
            && window.__hovered.isConnected && window.__hovered.classList.contains("popover-active"),
    })`);

    const homeBefore = await homeState();
    // AdGuard refreshes on its own when its cache expires; the rest are forced.
    await page.waitForTimeout(tick);
    const adguardTicked = (await homeState()).adguardText !== homeBefore.adguardText;
    await refreshAll(page);
    const homeAfter = await homeState();

    check("AdGuard refreshes on its own when its cache expires", adguardTicked, "its stats change every few seconds");
    check("AdGuard 'Top blocked domains' stays open", homeBefore.adguardOpen && homeAfter.adguardOpen);
    check("Tailscale 'Show more' stays expanded", homeBefore.tailscaleExpanded && homeAfter.tailscaleExpanded);
    check("Tailscale keeps a single expand button", homeAfter.tailscaleButtons === 1, `${homeAfter.tailscaleButtons} buttons`);
    check("Server Stats popover stays open while hovered", homeBefore.popoverShown && homeAfter.popoverShown);

    // ---- media: unchanged refreshes must not rebuild anything ----
    await page.goto(`${base}/media`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    await page.evaluate(`${widgetByTitle("Prowlarr Indexers")}.querySelector(".expand-toggle-button").click()`);

    await page.evaluate(() => {
        window.__before = {
            widgets: [...document.querySelectorAll(".widget")],
            images: [...document.querySelectorAll(".widget img")],
        };
    });
    // Twice: the first refresh of each widget returns its full render, the
    // second mostly 304s.
    await refreshAll(page);
    await refreshAll(page);

    const media = await page.evaluate(`(() => {
        const prowlarr = ${widgetByTitle("Prowlarr Indexers")};
        return {
            widgets: window.__before.widgets.length,
            widgetsReplaced: window.__before.widgets.filter((el) => !el.isConnected).length,
            images: window.__before.images.length,
            imagesReplaced: window.__before.images.filter((el) => !el.isConnected).length,
            prowlarrExpanded: prowlarr.querySelector(".collapsible-container").classList.contains("container-expanded"),
            prowlarrButtons: prowlarr.querySelectorAll(".expand-toggle-button").length,
        };
    })()`);

    check("No widget was rebuilt", media.widgetsReplaced === 0, `${media.widgetsReplaced}/${media.widgets} replaced`);
    check("No poster/image was rebuilt", media.imagesReplaced === 0, `${media.imagesReplaced}/${media.images} replaced`);
    check("Prowlarr 'Show more' stays expanded", media.prowlarrExpanded && media.prowlarrButtons === 1, `${media.prowlarrButtons} buttons`);

    // ---- changed data: patch a real poster row the way a new release would ----
    // Adds a card at the front, drops one, renames one and moves the last to
    // second (what History-style lists do), then patches the live copy.
    const changed = await page.evaluate(async () => {
        const src = [...document.scripts].find((s) => s.src.includes("page.js")).src;
        const { morph } = await import(src.replace("page.js", "morph.js"));
        const { rememberServerRender } = await import(src.replace("page.js", "lifecycle.js"));

        const id = [...document.querySelectorAll(".widget[data-widget-id]")]
            .find((w) => w.querySelectorAll(".carousel-items-container > a[href]").length > 3)?.dataset.widgetId;
        if (id === undefined) return null;

        const html = await (await fetch(`/api/widgets/${id}/refresh`, { cache: "no-store" })).text();
        const parse = (h) => { const t = document.createElement("template"); t.innerHTML = h; return t.content.firstElementChild; };

        const live = document.importNode(parse(html), true);
        document.body.append(live);
        rememberServerRender(live);
        live.querySelectorAll("img").forEach((img) => img.classList.add("client-state"));
        const before = [...live.querySelectorAll(".carousel-items-container > a")];

        const next = parse(html);
        const items = next.querySelector(".carousel-items-container");
        const cards = [...items.children];
        const dropped = cards[1].getAttribute("href");
        cards[1].remove();
        const added = cards[0].cloneNode(true);
        added.setAttribute("href", "http://example.invalid/new");
        added.querySelector("img")?.setAttribute("src", "http://example.invalid/new.jpg");
        items.prepend(added);
        cards[3].querySelector("li").textContent = "Renamed";
        items.insertBefore(cards.at(-1), items.children[1]);

        const expected = next.cloneNode(true);
        morph(live, next);

        const describe = (el) => [...el.querySelectorAll(".carousel-items-container > a")]
            .map((a) => [a.getAttribute("href"), a.querySelector("img")?.getAttribute("src"), a.textContent.replace(/\s+/g, " ").trim()].join("|"));
        const survivors = before.filter((a) => a.getAttribute("href") !== dropped);
        const result = {
            matches: JSON.stringify(describe(live)) === JSON.stringify(describe(expected)),
            kept: survivors.filter((a) => a.isConnected && a.querySelector("img")?.classList.contains("client-state")).length,
            survivors: survivors.length,
        };
        live.remove();
        return result;
    });

    check("Changed rows: content matches the server", changed?.matches === true);
    check("Changed rows: surviving cards keep their node and image", changed !== null && changed.kept === changed.survivors,
        changed && `${changed.kept}/${changed.survivors} kept`);

    check("No JavaScript errors", errors.length === 0, errors.join("; "));

    await browser.close();

    for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
    process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
