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
#
# Environment variables (required in CI):
# - CLOUDFLARE_API_TOKEN: API token with R2 write permissions
# - CLOUDFLARE_ACCOUNT_ID: Your Cloudflare account ID
#
# Optional:
# - CLOUDFLARE_ZONE_ID: Zone ID for cdn.traffical.io (enables cache purging)
#   Defaults to the traffical.io zone if not set.

set -e

# Get version from package.json
VERSION=$(jq -r .version package.json)
MAJOR=$(echo "$VERSION" | cut -d. -f1)

echo "Releasing @traffical/js-client v$VERSION to CDN..."

# Ensure we're in the right directory
if [ ! -f "package.json" ]; then
  echo "Error: Must run from packages/js-client directory"
  exit 1
fi

# Check for required environment variables in CI
if [ -n "$CI" ]; then
  if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo "Error: CLOUDFLARE_API_TOKEN is not set"
    exit 1
  fi
  if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
    echo "Error: CLOUDFLARE_ACCOUNT_ID is not set"
    exit 1
  fi
fi

# Always rebuild to ensure the artifact matches the current package.json version
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

# Purge Cloudflare edge cache so updated objects are served immediately
CDN_ZONE_ID="${CLOUDFLARE_ZONE_ID:-1385a95c8cb15db16a4432dc19e2a42d}"
if [ -n "$CLOUDFLARE_API_TOKEN" ]; then
  echo "Purging CDN cache..."
  PURGE_RESPONSE=$(curl -s -X POST \
    "https://api.cloudflare.com/client/v4/zones/$CDN_ZONE_ID/purge_cache" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"files\":[
      \"https://cdn.traffical.io/js-client/v$VERSION/traffical.min.js\",
      \"https://cdn.traffical.io/js-client/v$VERSION/traffical.min.js.map\",
      \"https://cdn.traffical.io/js-client/v$MAJOR/traffical.min.js\",
      \"https://cdn.traffical.io/js-client/v$MAJOR/traffical.min.js.map\",
      \"https://cdn.traffical.io/js-client/latest/traffical.min.js\",
      \"https://cdn.traffical.io/js-client/latest/traffical.min.js.map\"
    ]}")
  if echo "$PURGE_RESPONSE" | grep -q '"success":true'; then
    echo "✓ Cache purged"
  else
    echo "⚠ Cache purge failed: $PURGE_RESPONSE"
  fi
else
  echo "⚠ Skipping cache purge (CLOUDFLARE_API_TOKEN not set)"
fi

echo ""
echo "✓ Released v$VERSION to CDN"
echo ""
echo "URLs:"
echo "  https://cdn.traffical.io/js-client/v$VERSION/traffical.min.js (immutable)"
echo "  https://cdn.traffical.io/js-client/v$MAJOR/traffical.min.js (1h cache)"
echo "  https://cdn.traffical.io/js-client/latest/traffical.min.js (5m cache)"


