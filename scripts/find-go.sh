#!/usr/bin/env bash
# Locate a Go toolchain: prefer PATH, fall back to the local SDK install.
# Prints the directory containing the `go` binary, or nothing if not found.
set -euo pipefail

if command -v go >/dev/null 2>&1; then
  dirname "$(command -v go)"
  exit 0
fi
for candidate in \
  "$HOME/.local/go-sdk/go/bin" \
  "/usr/local/go/bin" \
  "/usr/lib/go/bin"; do
  if [ -x "$candidate/go" ]; then
    echo "$candidate"
    exit 0
  fi
done
exit 1
