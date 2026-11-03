// Bookkeeping that lets widget refreshes patch the DOM in place instead of
// replacing it (see morph.js and widget-refresh.js).

// What the server last rendered for each node: a Map of attributes for
// elements, the text for text/comment nodes. Nodes missing from here were
// created client-side (expand buttons, masonry columns, popover placeholders).
const serverRendered = new WeakMap();

export function rememberServerRender(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);

    for (let node = root; node !== null; node = walker.nextNode()) {
        serverRendered.set(node, node.nodeType === Node.ELEMENT_NODE ? attributesOf(node) : node.nodeValue);
    }
}

export function serverRenderOf(node) {
    return serverRendered.get(node);
}

export function setServerRender(node, value) {
    serverRendered.set(node, value);
}

export function isServerRendered(node) {
    return serverRendered.has(node);
}

export function attributesOf(element) {
    const attributes = new Map();

    for (let i = 0; i < element.attributes.length; i++) {
        attributes.set(element.attributes[i].name, element.attributes[i].value);
    }

    return attributes;
}

// Teardown for things that outlive their element when it's removed from the
// page: window listeners, observers, client-created sibling nodes.
const removalCallbacks = new Set();

export function onElementRemoved(element, callback) {
    removalCallbacks.add({ element, callback });
}

export function sweepRemovedElements() {
    for (const entry of removalCallbacks) {
        if (entry.element.isConnected) continue;

        removalCallbacks.delete(entry);

        try { entry.callback(); } catch (e) { console.error(e); }
    }
}
