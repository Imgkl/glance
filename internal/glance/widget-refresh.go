package glance

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"net/http"
	"strconv"
	"time"
)

// The browser refreshes each widget when its data is next due, and these
// headers tell it when that is, in milliseconds:
//
//   - the page content response carries a JSON object of widget ID to delay
//     for every widget on the page that refreshes;
//   - each refresh response carries the delay until that widget's next one,
//     or is absent if it no longer refreshes.
//
// They're headers rather than markup so the rendered HTML (and its ETag)
// only changes when the widget's content does.
const (
	refreshScheduleHeader = "X-Widget-Refresh-Schedule"
	refreshInHeader       = "X-Widget-Refresh-In"
)

// handleWidgetRefreshRequest returns a single widget's freshly rendered HTML
// for the client-side refresh scheduler (static/js/widget-refresh.js).
//
// Responses carry an ETag derived from the rendered HTML. Many refreshes
// render exactly the same markup, so the client sends it back via
// If-None-Match and gets an empty 304, which it treats as "nothing to do"
// without touching the DOM.
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

	refreshIn, refreshes := func() (time.Duration, bool) {
		widget.lock()
		defer widget.unlock()

		now := time.Now()
		if force || widget.requiresUpdate(&now) {
			widget.update(r.Context())
		}

		return widget.refreshIn(time.Now())
	}()

	if refreshes {
		w.Header().Set(refreshInHeader, strconv.FormatInt(refreshIn.Milliseconds(), 10))
	}

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

// refreshSchedule returns, for every widget on the page that refreshes
// (including ones nested in groups and split columns), how many milliseconds
// until it's next due.
func (p *page) refreshSchedule() map[uint64]int64 {
	schedule := make(map[uint64]int64)
	now := time.Now()

	var add func(list []widget)
	add = func(list []widget) {
		for _, w := range list {
			w.lock()
			delay, refreshes := w.refreshIn(now)
			w.unlock()

			if refreshes {
				schedule[w.GetID()] = delay.Milliseconds()
			}

			if c, ok := w.(interface{ childWidgets() []widget }); ok {
				add(c.childWidgets())
			}
		}
	}

	add(p.HeadWidgets)
	for c := range p.Columns {
		add(p.Columns[c].Widgets)
	}

	return schedule
}

func setRefreshScheduleHeader(w http.ResponseWriter, p *page) {
	schedule, err := json.Marshal(p.refreshSchedule())
	if err == nil {
		w.Header().Set(refreshScheduleHeader, string(schedule))
	}
}
