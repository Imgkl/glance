package glance

import (
	"context"
	"html/template"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// stub widget that counts update() calls and respects the cache schedule.
type counterWidget struct {
	widgetBase
	updates atomic.Int64
}

func (w *counterWidget) initialize() error {
	w.withCacheDuration(time.Hour)
	return nil
}

func (w *counterWidget) update(ctx context.Context) {
	w.updates.Add(1)
	// hold the lock long enough for sibling goroutines to pile up on it
	time.Sleep(20 * time.Millisecond)
	w.scheduleNextUpdate()
}

func (w *counterWidget) Render() template.HTML { return "" }

func TestRegisterWidgetIncludesContainerChildren(t *testing.T) {
	leaf1 := &clockWidget{}
	leaf1.setID(101)
	leaf2 := &clockWidget{}
	leaf2.setID(102)
	leaf3 := &clockWidget{}
	leaf3.setID(103)

	group := &groupWidget{}
	group.setID(200)
	group.containerWidgetBase.Widgets = widgets{leaf1, leaf2}

	split := &splitColumnWidget{}
	split.setID(300)
	split.containerWidgetBase.Widgets = widgets{group, leaf3}

	app := &application{widgetByID: make(map[uint64]widget)}
	app.registerWidget(split)

	for _, id := range []uint64{101, 102, 103, 200, 300} {
		if _, ok := app.widgetByID[id]; !ok {
			t.Errorf("widget id %d was not registered", id)
		}
	}
}

func TestUpdateOutdatedWidgetsDedupesConcurrentCalls(t *testing.T) {
	w := &counterWidget{}
	w.setID(1)
	if err := w.initialize(); err != nil {
		t.Fatal(err)
	}

	p := &page{}
	p.HeadWidgets = widgets{w}

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p.updateOutdatedWidgets()
		}()
	}
	wg.Wait()

	if got := w.updates.Load(); got != 1 {
		t.Errorf("expected 1 update across 10 concurrent page renders, got %d", got)
	}
}

func TestContainerUpdateDedupesConcurrentCalls(t *testing.T) {
	child := &counterWidget{}
	child.setID(1)
	if err := child.initialize(); err != nil {
		t.Fatal(err)
	}

	group := &groupWidget{}
	group.setID(2)
	group.containerWidgetBase.Widgets = widgets{child}

	var wg sync.WaitGroup
	ctx := context.Background()
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			group.containerWidgetBase._update(ctx)
		}()
	}
	wg.Wait()

	if got := child.updates.Load(); got != 1 {
		t.Errorf("expected 1 update across 10 concurrent container updates, got %d", got)
	}
}
