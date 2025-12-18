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

# Production Worker URL
WORKER_URL="https://reporting-tool-api.jamesredwards89.workers.dev"

echo ""
echo "🔐 RapidTools API Key Rotation (Production)"
echo "------------------------------------------"

# Prompt for current API key (hidden input)
read -s -p "Enter current API key: " OLD_API_KEY
echo ""

# Guard against empty input
if [ -z "$OLD_API_KEY" ]; then
  echo "❌ FAILED: No API key provided"
  exit 1
fi

# Generate new API key
NEW_API_KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')

# Lookup agency ID from old key
LOOKUP_KEY="agency_api_key:$OLD_API_KEY"
AGENCY_ID=$(npx wrangler kv key get "$LOOKUP_KEY" \
  --binding=REPORTING_KV \
  --remote \
  --preview=false \
  2>/dev/null || true)

if [ -z "$AGENCY_ID" ]; then
  echo "❌ FAILED: API key not found in production KV"
  exit 1
fi

echo "✔ Agency found: $AGENCY_ID"

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

# Update agency JSON with new key
UPDATED_AGENCY_JSON=$(echo "$AGENCY_JSON" | jq --arg newKey "$NEW_API_KEY" '.apiKey = $newKey')

# Create new lookup
NEW_LOOKUP_KEY="agency_api_key:$NEW_API_KEY"
npx wrangler kv key put "$NEW_LOOKUP_KEY" "$AGENCY_ID" \
  --binding=REPORTING_KV \
  --remote \
  --preview=false

# Update agency record
npx wrangler kv key put "$AGENCY_KEY" "$UPDATED_AGENCY_JSON" \
  --binding=REPORTING_KV \
  --remote \
  --preview=false

# Delete old lookup
npx wrangler kv key delete "$LOOKUP_KEY" \
  --binding=REPORTING_KV \
  --remote \
  --preview=false

echo "✔ API key rotated in KV"

# Allow KV propagation
sleep 10

# Verify old key fails
OLD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$WORKER_URL/api/clients" \
  -H "x-api-key: $OLD_API_KEY")

if [ "$OLD_STATUS" != "401" ] && [ "$OLD_STATUS" != "403" ]; then
  echo "❌ FAILED: Old key still works (HTTP $OLD_STATUS)"
  exit 1
fi

echo "✔ Old API key rejected as expected"

# Verify new key works
NEW_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$WORKER_URL/api/clients" \
  -H "x-api-key: $NEW_API_KEY")

if [ "$NEW_STATUS" != "200" ]; then
  echo "❌ FAILED: New key does not work (HTTP $NEW_STATUS)"
  exit 1
fi

echo "✔ New API key accepted"

# Success
echo ""
echo "✅ SUCCESS"
echo "------------------------------------------"
echo "New API key:"
echo "$NEW_API_KEY"
echo ""
echo "⚠️  Save this key securely. It will not be shown again."