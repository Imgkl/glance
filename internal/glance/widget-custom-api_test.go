package glance

import (
	"bytes"
	"html"
	"html/template"
	"net/url"
	"strings"
	"testing"

	"github.com/tidwall/gjson"
)

func TestJellyfinPrimaryImageURLSelectsDisplayedPoster(t *testing.T) {
	tests := []struct {
		name, item, imageID, wantTag string
	}{
		{"movie", `{"Id":"movie","ImageTags":{"Primary":"movie-tag"}}`, "movie", "movie-tag"},
		{"series", `{"Id":"series","ImageTags":{"Primary":"series-tag"}}`, "series", "series-tag"},
		{"season", `{"Id":"season","ImageTags":{"Primary":"season-tag"},"SeriesId":"series","SeriesPrimaryImageTag":"series-tag"}`, "season", "season-tag"},
		{"episode series poster", `{"Id":"episode","ImageTags":{"Primary":"episode-tag"},"SeriesId":"series","SeriesPrimaryImageTag":"series-tag"}`, "series", "series-tag"},
		{"episode season poster", `{"Id":"episode","ImageTags":{"Primary":"episode-tag"},"SeriesId":"series","SeriesPrimaryImageTag":"series-tag","ParentPrimaryImageItemId":"season","ParentPrimaryImageTag":"season-tag"}`, "season", "season-tag"},
		{"missing image", `{"Id":"movie","ImageTags":{}}`, "movie", ""},
		{"unrelated image", `{"Id":"episode","ImageTags":{"Primary":"episode-tag"},"ParentPrimaryImageItemId":"series","ParentPrimaryImageTag":"series-tag"}`, "season", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			imageURL := "https://media.example/jellyfin/Items/" + tt.imageID + "/Images/Primary?ApiKey=test%2Bkey&maxWidth=400#poster"
			got, err := jellyfinPrimaryImageURL(imageURL, decoratedGJSONResult{gjson.Parse(tt.item)}, tt.imageID)
			if err != nil {
				t.Fatal(err)
			}
			if tt.wantTag == "" && got != imageURL {
				t.Fatalf("missing tag changed URL: %q", got)
			}
			parsed, err := url.Parse(got)
			if err != nil {
				t.Fatal(err)
			}
			if parsed.Query().Get("tag") != tt.wantTag {
				t.Fatalf("tag = %q, want %q", parsed.Query().Get("tag"), tt.wantTag)
			}
			if parsed.Query().Get("ApiKey") != "test+key" || parsed.Query().Get("maxWidth") != "400" || parsed.Fragment != "poster" {
				t.Fatalf("changed existing URL fields: %q", got)
			}
		})
	}
}

func TestJellyfinPosterTemplateChangesURLOnlyWhenArtworkChanges(t *testing.T) {
	tmpl := template.Must(template.New("poster").Funcs(customAPITemplateFuncs).Parse(`{{ range .Array "Items" }}<img src="{{ jellyfinPrimaryImageURL "https://media.example/Items/movie/Images/Primary?ApiKey=test&tag=stale" . (.String "Id") }}">{{ end }}`))
	render := func(tag string) string {
		t.Helper()
		data := decoratedGJSONResult{gjson.Parse(`{"Items":[{"Id":"movie","ImageTags":{"Primary":"` + tag + `"}}]}`)}
		var output bytes.Buffer
		if err := tmpl.Execute(&output, &data); err != nil {
			t.Fatal(err)
		}
		return html.UnescapeString(output.String())
	}
	old := render("old-artwork")
	if got := render("old-artwork"); got != old {
		t.Fatal("unchanged artwork produced a different render")
	}
	updated := render("new-artwork")
	if updated == old || !strings.Contains(updated, "tag=new-artwork") || strings.Contains(updated, "tag=stale") {
		t.Fatalf("updated artwork retained stale URL: %s", updated)
	}
}

func TestJellyfinPrimaryImageURLErrorDoesNotExposeKey(t *testing.T) {
	_, err := jellyfinPrimaryImageURL("https://media.example/%zz?ApiKey=private-key", decoratedGJSONResult{gjson.Parse(`{"Id":"movie","ImageTags":{"Primary":"tag"}}`)}, "movie")
	if err == nil || strings.Contains(err.Error(), "private-key") {
		t.Fatalf("expected an error without credentials, got %v", err)
	}
}
