import { attributesOf, isServerRendered, rememberServerRender, serverRenderOf, setServerRender } from './lifecycle.js';

// Patches a live widget toward a fresh server render, applying only what the
// server changed since its previous render (a three-way merge against what
// lifecycle.js remembered). Anything the client did on its own is left alone
// unless the server changed that same thing:
//   - classes and attributes added by enhancements or the user
//     (container-expanded, collapsible-item, <details open>, lazy-image state)
//   - text the client rewrote (relative timestamps)
//   - nodes the client inserted (expand buttons, popover placeholders)
// Untouched nodes keep their identity, so images don't reload and listeners,
// scroll positions and focus survive.
export function morph(current, next) {
    morphNode(current, next);
}

function morphNode(current, next) {
    if (current.nodeType !== Node.ELEMENT_NODE) {
        if (serverRenderOf(current) !== next.nodeValue) {
            current.nodeValue = next.nodeValue;
        }

        setServerRender(current, next.nodeValue);
        return;
    }

    // An open popover has moved part of this subtree into the popover
    // container. Leave it as is; the next refresh after it closes catches up
    // because its remembered server render is left untouched too.
    if (current.classList.contains("popover-active")) {
        return;
    }

    morphAttributes(current, next);
    morphChildren(current, next);
}

function morphAttributes(current, next) {
    const before = serverRenderOf(current);
    const after = attributesOf(next);
    const names = new Set([...before.keys(), ...after.keys()]);

    for (const name of names) {
        const was = before.get(name);
        const now = after.get(name);

        if (was === now) continue;

        if (name === "class") {
            morphClasses(current, was, now);
        } else if (now === undefined) {
            current.removeAttribute(name);
        } else {
            current.setAttribute(name, now);
        }
    }

    setServerRender(current, after);
}

function morphClasses(element, was, now) {
    const before = classTokens(was);
    const after = classTokens(now);

    for (const token of before) {
        if (!after.has(token)) element.classList.remove(token);
    }

    for (const token of after) {
        if (!before.has(token)) element.classList.add(token);
    }
}

function classTokens(value) {
    return new Set(value === undefined ? [] : value.split(/\s+/).filter(Boolean));
}

function morphChildren(current, next) {
    // Client-created nodes aren't part of the server's markup, so they're
    // neither matched nor removed; they stay where the client put them.
    const existing = Array.from(current.childNodes).filter(isServerRendered);
    // Identity -> nodes in document order. Usually one each, but rows can
    // legitimately share one (several episodes of a show use its poster).
    const identified = new Map();
    const anonymous = [];

    for (const node of existing) {
        const identity = identityOf(node);

        if (identity === null) {
            anonymous.push(node);
        } else if (identified.has(identity)) {
            identified.get(identity).push(node);
        } else {
            identified.set(identity, [node]);
        }
    }

    const kept = new Set();
    let anonymousCursor = 0;
    let previous = null;

    for (const node of Array.from(next.childNodes)) {
        const identity = identityOf(node);
        let match = null;

        if (identity !== null) {
            // Identified rows are found wherever they are, so items added,
            // removed or reordered keep their nodes (and loaded images).
            const candidates = identified.get(identity);

            if (candidates !== undefined && isSameKind(candidates[0], node)) {
                match = candidates.shift();
                if (candidates.length == 0) identified.delete(identity);
            }
        } else {
            const index = findAnonymousMatch(anonymous, anonymousCursor, node);

            if (index !== -1) {
                match = anonymous[index];
                anonymousCursor = index + 1;
            }
        }

        if (match === null) {
            match = document.importNode(node, true);
            rememberServerRender(match);
            insertAfter(current, match, previous);
        } else {
            if (nextServerSibling(current, previous) !== match) {
                insertAfter(current, match, previous);
            }

            morphNode(match, node);
        }

        kept.add(match);
        previous = match;
    }

    for (const node of existing) {
        if (!kept.has(node)) node.remove();
    }
}

// Anonymous nodes match in order. Elements may skip ahead past nodes the
// server dropped; text nodes only match in place, since whitespace all looks
// alike and skipping ahead to it would drop the elements in between.
function findAnonymousMatch(anonymous, from, node) {
    if (from < anonymous.length && isSameKind(anonymous[from], node)) {
        return from;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return -1;
    }

    for (let i = from + 1; i < anonymous.length; i++) {
        if (isSameKind(anonymous[i], node)) return i;
    }

    return -1;
}

function isSameKind(a, b) {
    return a.nodeType === b.nodeType && a.nodeName === b.nodeName;
}

// Lets rows keep their nodes when items are added, removed or reordered. Most
// widget items link to or show something unique; plain elements without any
// of these match in order and get patched in place.
function identityOf(element) {
    if (element.nodeType !== Node.ELEMENT_NODE) return null;

    const own = element.id
        || element.getAttribute("data-key")
        || element.getAttribute("href")
        || element.getAttribute("src");

    if (own) return own;

    if (element.nodeName === "LI") {
        const descendant = element.querySelector("img[src], a[href]");
        if (descendant !== null) return descendant.getAttribute("src") || descendant.getAttribute("href");
    }

    return null;
}

// The server node following `previous`, skipping past client nodes attached
// to it (e.g. the expand button that follows a collapsible list).
function nextServerSibling(parent, previous) {
    let node = previous === null ? parent.firstChild : previous.nextSibling;

    while (node !== null && !isServerRendered(node)) {
        node = node.nextSibling;
    }

    return node;
}

function insertAfter(parent, node, previous) {
    parent.insertBefore(node, nextServerSibling(parent, previous));
}
