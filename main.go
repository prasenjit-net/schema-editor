package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path"
	"strings"
	"syscall"
	"time"
)

// The web build is compiled into the executable. Run "npm run build:single"
// instead of invoking "go build" directly so dist exists and is up to date.
//
//go:embed all:dist
var embeddedWeb embed.FS

func main() {
	defaultAddress := os.Getenv("ADDR")
	if defaultAddress == "" {
		defaultAddress = ":8080"
	}

	address := flag.String("addr", defaultAddress, "HTTP listen address")
	flag.Parse()

	handler, err := spaHandler(embeddedWeb)
	if err != nil {
		slog.Error("prepare embedded web application", "error", err)
		os.Exit(1)
	}

	server := &http.Server{
		Addr:              *address,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		<-shutdownContext.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			slog.Error("shut down server", "error", err)
		}
	}()

	displayURL := "http://" + *address
	if strings.HasPrefix(*address, ":") {
		displayURL = "http://localhost" + *address
	}
	slog.Info("serving Schematic", "url", displayURL)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("serve application", "error", err)
		os.Exit(1)
	}
}

func spaHandler(source fs.FS) (http.Handler, error) {
	web, err := fs.Sub(source, "dist")
	if err != nil {
		return nil, fmt.Errorf("open embedded dist directory: %w", err)
	}

	index, err := fs.ReadFile(web, "index.html")
	if err != nil {
		return nil, fmt.Errorf("read embedded index: %w", err)
	}

	files := http.FileServer(http.FS(web))
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet && request.Method != http.MethodHead {
			response.Header().Set("Allow", "GET, HEAD")
			http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		name := strings.TrimPrefix(path.Clean(request.URL.Path), "/")
		if name == "." {
			name = ""
		}

		if name != "" {
			if info, statErr := fs.Stat(web, name); statErr == nil && !info.IsDir() {
				response.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				files.ServeHTTP(response, request)
				return
			}

			// Missing files should remain 404s. Extensionless paths are treated as
			// client-side SPA routes and receive index.html.
			if path.Ext(name) != "" {
				http.NotFound(response, request)
				return
			}
		}

		response.Header().Set("Content-Type", "text/html; charset=utf-8")
		response.Header().Set("Cache-Control", "no-cache")
		response.WriteHeader(http.StatusOK)
		if request.Method == http.MethodGet {
			_, _ = response.Write(index)
		}
	}), nil
}
