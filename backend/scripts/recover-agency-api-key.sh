#!/bin/bash
set -e

# Ensure required tools exist
command -v jq >/dev/null 2>&1 || {
  echo "❌ FAILED: jq is required but not installed"
  exit 1
}

command -v uuidgen >/dev/null 2>&1 || {
  echo "❌ FAILED: uuidgen is required but not installed"
  exit 1
}

# Configuration
AGENCY_ID="0700c1a2-c15d-4d36-baaf-5a94e84b5c15"
WORKER_URL="https://reporting-tool-api.jamesredwards89.workers.dev"

# Fetch agency record
AGENCY_KEY="agency:$AGENCY_ID"
AGENCY_JSON=$(npx wrangler kv key get "$AGENCY_KEY" \
  --binding=REPORTING_KV \
  --remote \
  --preview=false \
  2>/dev/null || true)

if [ -z "$AGENCY_JSON" ]; then
  echo "❌ FAILED: Agency record not found"
  exit 1
fi

# Extract old API key to clean up its lookup
OLD_API_KEY=$(echo "$AGENCY_JSON" | jq -r '.apiKey // empty')

# Generate new API key
NEW_API_KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')

# Update agency JSON with new key
UPDATED_AGENCY_JSON=$(echo "$AGENCY_JSON" | jq --arg newKey "$NEW_API_KEY" '.apiKey = $newKey')

# Update agency record
npx wrangler kv key put "$AGENCY_KEY" "$UPDATED_AGENCY_JSON" \
  --binding=REPORTING_KV \
  --remote \
  --preview=false \
  2>/dev/null

# Create new lookup
NEW_LOOKUP_KEY="agency_api_key:$NEW_API_KEY"
npx wrangler kv key put "$NEW_LOOKUP_KEY" "$AGENCY_ID" \
  --binding=REPORTING_KV \
  --remote \
  --preview=false \
  2>/dev/null

# Delete old lookup if it existed
if [ -n "$OLD_API_KEY" ]; then
  OLD_LOOKUP_KEY="agency_api_key:$OLD_API_KEY"
  npx wrangler kv key delete "$OLD_LOOKUP_KEY" \
    --binding=REPORTING_KV \
    --remote \
    --preview=false \
    2>/dev/null || true
fi

# Allow KV propagation
sleep 3

# Verify new key works
NEW_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$WORKER_URL/api/clients" \
  -H "x-api-key: $NEW_API_KEY")

if [ "$NEW_STATUS" != "200" ]; then
  echo "❌ FAILED: New key does not work (HTTP $NEW_STATUS)"
  exit 1
fi

# Success
echo "✅ SUCCESS"
echo "New Agency API key: $NEW_API_KEY"
