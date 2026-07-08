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

# 2. core-io (depends on core)
build_pkg "core-io"

# 2b. openfeature-core (depends on core + @openfeature/core)
build_pkg "openfeature-core"

# 3. js-client (depends on core, core-io)
build_pkg "js-client"

# 4. Parallel: node, react, svelte (depend on core/core-io/js-client)
build_pkg "node" &
build_pkg "react" &
build_pkg "svelte" &
build_pkg "react-native" &
wait

# 5. OpenFeature providers (depend on openfeature-core + node/js-client)
build_pkg "openfeature-server" &
build_pkg "openfeature-web" &
wait


echo ""
echo "✅ Done!"
echo ""
echo "Link packages in a project:"
echo "  cd your-project"
echo "  bun link @traffical/core @traffical/js-client @traffical/react"
