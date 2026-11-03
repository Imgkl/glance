package glance

import (
	"context"
	"html/template"
	"net/http"
	"net/http/httptest"
	"testing"
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
