package glance

import (
	"context"
	"html/template"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type stubHTMLWidget struct {
	widgetBase
	html template.HTML
}

func (w *stubHTMLWidget) initialize() error          { return nil }
func (w *stubHTMLWidget) update(ctx context.Context) {}
func (w *stubHTMLWidget) Render() template.HTML      { return w.html }

// The client relies on 304s to skip DOM work entirely, so a wrong ETag
// either freezes widgets (false 304) or brings back the flicker (no 304).
func TestWidgetRefreshRevalidatesWithETag(t *testing.T) {
	stub := &stubHTMLWidget{html: "<div>v1</div>"}
	app := &application{widgetByID: map[uint64]widget{1: stub}}

	refresh := func(ifNoneMatch string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/api/widgets/1/refresh", nil)
		req.SetPathValue("widget", "1")
		if ifNoneMatch != "" {
			req.Header.Set("If-None-Match", ifNoneMatch)
		}
		rec := httptest.NewRecorder()
		app.handleWidgetRefreshRequest(rec, req)
		return rec
	}

	first := refresh("")
	etag := first.Header().Get("ETag")
	if first.Code != http.StatusOK || first.Body.String() != "<div>v1</div>" || etag == "" {
		t.Fatalf("first refresh: code=%d body=%q etag=%q", first.Code, first.Body.String(), etag)
	}

	if unchanged := refresh(etag); unchanged.Code != http.StatusNotModified || unchanged.Body.Len() != 0 {
		t.Fatalf("unchanged render: want empty 304, got code=%d body=%q", unchanged.Code, unchanged.Body.String())
	}

	stub.html = "<div>v2</div>"
	changed := refresh(etag)
	if changed.Code != http.StatusOK || changed.Body.String() != "<div>v2</div>" {
		t.Fatalf("changed render: want 200 with new body, got code=%d body=%q", changed.Code, changed.Body.String())
	}
	if changed.Header().Get("ETag") == etag {
		t.Fatal("changed render kept the old ETag")
	}
}

// The browser refreshes a widget only when the server's schedule says so, so
// a widget missing from it (or listed wrongly) silently stops updating, and
// one listed too eagerly turns into a busy loop.
func TestRefreshScheduleFollowsWhenDataIsDue(t *testing.T) {
	now := time.Now()

	nested := &stubHTMLWidget{}
	nested.ID = 2
	nested.withCacheDuration(time.Minute).nextUpdate = now.Add(40 * time.Second)

	static := &stubHTMLWidget{}
	static.ID = 3

	overdue := &stubHTMLWidget{}
	overdue.ID = 4
	overdue.withCacheDuration(time.Second).nextUpdate = now.Add(-time.Second)

	group := &groupWidget{}
	group.ID = 1
	group.Widgets = widgets{nested, static}

	p := &page{}
	p.Columns = append(p.Columns, struct {
		Size    string  `yaml:"size"`
		Widgets widgets `yaml:"widgets"`
	}{Widgets: widgets{group, overdue}})

	schedule := p.refreshSchedule()

	if len(schedule) != 2 {
		t.Fatalf("want only the nested and overdue widgets scheduled, got %v", schedule)
	}
	if d := schedule[2]; d < 39_000 || d > 40_000 {
		t.Errorf("nested widget: want ~40s until its cache expires, got %dms", d)
	}
	if d := schedule[4]; d != minRefreshDelay.Milliseconds() {
		t.Errorf("overdue widget: want the %s floor, got %dms", minRefreshDelay, d)
	}

	app := &application{widgetByID: map[uint64]widget{2: nested, 3: static}}
	refreshIn := func(id string) string {
		req := httptest.NewRequest("GET", "/api/widgets/"+id+"/refresh", nil)
		req.SetPathValue("widget", id)
		rec := httptest.NewRecorder()
		app.handleWidgetRefreshRequest(rec, req)
		return rec.Header().Get(refreshInHeader)
	}

	if got := refreshIn("2"); got == "" {
		t.Error("refresh response for a cached widget has no next refresh time")
	}
	if got := refreshIn("3"); got != "" {
		t.Errorf("refresh response for a static widget asks for another refresh in %sms", got)
	}
}
