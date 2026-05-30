#!/usr/bin/env bash
# Point git at the versioned hooks in .githooks (run once per clone).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
chmod +x .githooks/* scripts/*.sh 2>/dev/null || true
echo "✓ git hooks enabled (core.hooksPath=.githooks)"
echo "  bypass any hook with --no-verify if needed."
