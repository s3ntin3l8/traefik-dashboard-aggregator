#!/usr/bin/env bash
# ci-prebuild.sh — runs before `go build`/`go test` in ci-go.yml.
#
# The Go binary embeds web/dist via //go:embed. The real frontend bundle is
# produced by the frontend job / Docker build; on the backend-only CI lane
# we just need a non-empty stub so //go:embed is happy.
set -euo pipefail

mkdir -p web/dist
printf '<!doctype html><title>traefik-viewer</title>' > web/dist/index.html
