#!/usr/bin/env bash
# Build and link all Traffical SDKs for local development
# Usage: ./build-local.sh
#
# Fails loudly on ANY package build error (previously errors were swallowed by
# `|| echo`, so `bun run build` could exit 0 with broken/missing dist output and
# CI stayed green on a broken build).

set -euo pipefail
cd "$(dirname "$0")"

echo "🔧 Building Traffical SDKs..."
echo ""

build_pkg() {
  local pkg=$1
  local cmd=${2:-build}
  echo "  → $pkg"
  # No `|| echo` swallow: a non-zero exit here propagates (set -e) for
  # sequential builds, and is surfaced via `wait <pid>` for parallel builds.
  (cd "packages/$pkg" && bun run "$cmd")
}

# Wait on a set of background PIDs; exit non-zero if ANY of them failed.
wait_all() {
  local fail=0 pid
  for pid in "$@"; do
    if ! wait "$pid"; then
      fail=1
    fi
  done
  if [ "$fail" -ne 0 ]; then
    echo "❌ One or more package builds failed."
    exit 1
  fi
}

# 1. Core (base - no deps)
build_pkg "core"

# 2. core-io (depends on core)
build_pkg "core-io"

# 2b. openfeature-core (depends on core + @openfeature/core)
build_pkg "openfeature-core"

# 3. js-client (depends on core, core-io)
build_pkg "js-client"

# 4. Parallel: node, react, svelte, react-native (depend on core/core-io/js-client)
pids=()
build_pkg "node" & pids+=("$!")
build_pkg "react" & pids+=("$!")
build_pkg "svelte" & pids+=("$!")
build_pkg "react-native" & pids+=("$!")
wait_all "${pids[@]}"

# 5. OpenFeature providers (depend on openfeature-core + node/js-client)
pids=()
build_pkg "openfeature-server" & pids+=("$!")
build_pkg "openfeature-web" & pids+=("$!")
wait_all "${pids[@]}"


echo ""
echo "✅ Done!"
echo ""
echo "Link packages in a project:"
echo "  cd your-project"
echo "  bun link @traffical/core @traffical/js-client @traffical/react"
