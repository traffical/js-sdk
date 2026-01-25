#!/bin/bash
#
# Release @traffical/js-client to Cloudflare R2 CDN
#
# Usage: ./scripts/release-cdn.sh
#
# Uploads the built SDK to:
# - cdn.traffical.io/js-client/v{VERSION}/traffical.min.js
# - cdn.traffical.io/js-client/v{MAJOR}/traffical.min.js
# - cdn.traffical.io/js-client/latest/traffical.min.js

set -e

# Get version from package.json
VERSION=$(jq -r .version package.json)
MAJOR=$(echo "$VERSION" | cut -d. -f1)

echo "Releasing @traffical/js-client v$VERSION to CDN..."

# Ensure we're in the right directory
if [ ! -f "package.json" ]; then
  echo "Error: Must run from sdk/js-client directory"
  exit 1
fi

# Build the SDK
echo "Building..."
bun run build

# Check if build succeeded
if [ ! -f "dist/traffical.min.js" ]; then
  echo "Error: Build failed - dist/traffical.min.js not found"
  exit 1
fi

# Show bundle size
SIZE=$(wc -c < dist/traffical.min.js | tr -d ' ')
SIZE_KB=$(echo "scale=2; $SIZE / 1024" | bc)
echo "Bundle size: ${SIZE_KB} KB"

# Upload to R2 - specific version
echo "Uploading v$VERSION..."
bunx wrangler r2 object put "traffical-cdn/js-client/v$VERSION/traffical.min.js" \
  --file dist/traffical.min.js \
  --content-type "application/javascript" \
  --cache-control "public, max-age=31536000, immutable" --remote

bunx wrangler r2 object put "traffical-cdn/js-client/v$VERSION/traffical.min.js.map" \
  --file dist/traffical.min.js.map \
  --content-type "application/json" \
  --cache-control "public, max-age=31536000, immutable" --remote

# Upload to R2 - major version (v1, v2, etc.)
echo "Uploading v$MAJOR (major version)..."
bunx wrangler r2 object put "traffical-cdn/js-client/v$MAJOR/traffical.min.js" \
  --file dist/traffical.min.js \
  --content-type "application/javascript" \
  --cache-control "public, max-age=3600" --remote

bunx wrangler r2 object put "traffical-cdn/js-client/v$MAJOR/traffical.min.js.map" \
  --file dist/traffical.min.js.map \
  --content-type "application/json" \
  --cache-control "public, max-age=3600" --remote

# Upload to R2 - latest
echo "Uploading latest..."
bunx wrangler r2 object put "traffical-cdn/js-client/latest/traffical.min.js" \
  --file dist/traffical.min.js \
  --content-type "application/javascript" \
  --cache-control "public, max-age=300" --remote

bunx wrangler r2 object put "traffical-cdn/js-client/latest/traffical.min.js.map" \
  --file dist/traffical.min.js.map \
  --content-type "application/json" \
  --cache-control "public, max-age=300" --remote

echo ""
echo "✓ Released v$VERSION to CDN"
echo ""
echo "URLs:"
echo "  https://cdn.traffical.io/js-client/v$VERSION/traffical.min.js (immutable)"
echo "  https://cdn.traffical.io/js-client/v$MAJOR/traffical.min.js (1h cache)"
echo "  https://cdn.traffical.io/js-client/latest/traffical.min.js (5m cache)"

