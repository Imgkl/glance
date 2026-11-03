package glance

import (
	"fmt"
	"hash/fnv"
	"net/http"
	"strconv"
	"time"
)

// handleWidgetRefreshRequest returns a single widget's freshly rendered HTML
// for the client-side refresh scheduler (static/js/widget-refresh.js).
//
// Responses carry an ETag derived from the rendered HTML. Most ticks render
// exactly the same markup, so the client sends it back via If-None-Match and
// gets an empty 304, which it treats as "nothing to do" without touching the DOM.
func (a *application) handleWidgetRefreshRequest(w http.ResponseWriter, r *http.Request) {
	if a.handleUnauthorizedResponse(w, r, showUnauthorizedJSON) {
		return
	}

	widgetID, err := strconv.ParseUint(r.PathValue("widget"), 10, 64)
	if err != nil {
		a.handleNotFound(w, r)
		return
	}

	widget, exists := a.widgetByID[widgetID]
	if !exists {
		a.handleNotFound(w, r)
		return
	}

	force := r.URL.Query().Get("force") == "1"

	func() {
		widget.lock()
		defer widget.unlock()

		now := time.Now()
		if force || widget.requiresUpdate(&now) {
			widget.update(r.Context())
		}
	}()

	// Render outside the lock; renderTemplate re-acquires it briefly.
	html := []byte(widget.Render())
	etag := renderETag(html)

	w.Header().Set("ETag", etag)
	// The client manages revalidation itself; keep the browser's HTTP cache
	// from answering on our behalf and hiding the 304 from it.
	w.Header().Set("Cache-Control", "no-store")

	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(html)
}

func renderETag(html []byte) string {
	h := fnv.New64a()
	h.Write(html)
	return fmt.Sprintf(`"%x"`, h.Sum64())
}
