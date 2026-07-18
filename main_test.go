package main

import (
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestSPAHandler(t *testing.T) {
	testFS := fstest.MapFS{
		"dist/index.html":        {Data: []byte("<h1>Schematic</h1>")},
		"dist/assets/app.js":     {Data: []byte("console.log('ready')")},
		"dist/assets/styles.css": {Data: []byte("body{}")},
	}

	handler, err := spaHandler(testFS)
	if err != nil {
		t.Fatalf("spaHandler() error = %v", err)
	}

	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
		wantBody   string
		wantCache  string
	}{
		{name: "root", method: http.MethodGet, path: "/", wantStatus: http.StatusOK, wantBody: "<h1>Schematic</h1>", wantCache: "no-cache"},
		{name: "SPA route", method: http.MethodGet, path: "/schemas/new", wantStatus: http.StatusOK, wantBody: "<h1>Schematic</h1>", wantCache: "no-cache"},
		{name: "asset", method: http.MethodGet, path: "/assets/app.js", wantStatus: http.StatusOK, wantBody: "console.log('ready')", wantCache: "public, max-age=31536000, immutable"},
		{name: "missing asset", method: http.MethodGet, path: "/assets/missing.js", wantStatus: http.StatusNotFound, wantBody: "404 page not found\n"},
		{name: "unsupported method", method: http.MethodPost, path: "/", wantStatus: http.StatusMethodNotAllowed, wantBody: "method not allowed\n"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, test.path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)

			if response.Code != test.wantStatus {
				t.Errorf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if response.Body.String() != test.wantBody {
				t.Errorf("body = %q, want %q", response.Body.String(), test.wantBody)
			}
			if test.wantCache != "" && response.Header().Get("Cache-Control") != test.wantCache {
				t.Errorf("Cache-Control = %q, want %q", response.Header().Get("Cache-Control"), test.wantCache)
			}
		})
	}
}

func TestSPAHandlerRequiresIndex(t *testing.T) {
	_, err := spaHandler(fstest.MapFS{"dist/.keep": &fstest.MapFile{Data: []byte{}}})
	if err == nil {
		t.Fatal("spaHandler() error = nil, want missing index error")
	}
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("spaHandler() error = %v, want fs.ErrNotExist", err)
	}
}
