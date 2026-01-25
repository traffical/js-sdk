#!/usr/bin/env bash
# Build and link all Traffical SDKs for local development
# Usage: ./build-local.sh

set -e
cd "$(dirname "$0")"

echo "🔧 Building Traffical SDKs..."
echo ""

build_pkg() {
  local pkg=$1
  local cmd=${2:-build}
  echo "  → $pkg"
  (cd "packages/$pkg" && bun run "$cmd") || echo "  ⚠️  $pkg failed"
}

# 1. Core (base - no deps)
build_pkg "core"

# 2. js-client (depends on core)
build_pkg "js-client"

# 3. Parallel: node, react, svelte (depend on core/js-client)
build_pkg "node" &
build_pkg "react" &
build_pkg "svelte" &
wait

# 4. cli (standalone)
build_pkg "cli"

echo ""
echo "✅ Done!"
echo ""
echo "Link packages in a project:"
echo "  cd your-project"
echo "  bun link @traffical/core @traffical/js-client @traffical/react"
