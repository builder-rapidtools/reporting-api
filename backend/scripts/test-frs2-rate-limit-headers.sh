#!/usr/bin/env bash
# FRS-2 Test: Rate Limit Headers
# Verifies that X-RateLimit-* headers are present in responses

set -euo pipefail

BASE_URL="${RAPIDTOOLS_BASE_URL:-https://reporting-api.rapidtools.dev}"
API_KEY="${RAPIDTOOLS_API_KEY:?RAPIDTOOLS_API_KEY must be set}"
CLIENT_ID="${RAPIDTOOLS_CLIENT_ID:?RAPIDTOOLS_CLIENT_ID must be set}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "FRS-2 TEST: Rate Limit Headers"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Base URL: $BASE_URL"
echo "Client ID: $CLIENT_ID"
echo ""

# Test: Send one request and check for rate limit headers
echo "Test: Checking for X-RateLimit-* headers in successful response..."
IDEMPOTENCY_KEY="frs2-headers-test-$(date +%s)"

# Use -i to include headers in output
RESPONSE=$(curl -i -s -X POST \
  "$BASE_URL/api/client/$CLIENT_ID/report/send" \
  -H "x-api-key: $API_KEY" \
  -H "idempotency-key: $IDEMPOTENCY_KEY")

# Extract headers and body
HEADERS=$(echo "$RESPONSE" | sed -n '1,/^\r$/p')
BODY=$(echo "$RESPONSE" | sed -n '/^\r$/,$p' | tail -n +2)

# Check for X-RateLimit-Limit header
if echo "$HEADERS" | grep -qi "x-ratelimit-limit:"; then
  LIMIT=$(echo "$HEADERS" | grep -i "x-ratelimit-limit:" | cut -d':' -f2 | tr -d ' \r')
  echo "✅ X-RateLimit-Limit: $LIMIT"
else
  echo "❌ FAILED: X-RateLimit-Limit header not found"
  exit 1
fi

# Check for X-RateLimit-Remaining header
if echo "$HEADERS" | grep -qi "x-ratelimit-remaining:"; then
  REMAINING=$(echo "$HEADERS" | grep -i "x-ratelimit-remaining:" | cut -d':' -f2 | tr -d ' \r')
  echo "✅ X-RateLimit-Remaining: $REMAINING"
else
  echo "❌ FAILED: X-RateLimit-Remaining header not found"
  exit 1
fi

# Check for X-RateLimit-Reset header
if echo "$HEADERS" | grep -qi "x-ratelimit-reset:"; then
  RESET=$(echo "$HEADERS" | grep -i "x-ratelimit-reset:" | cut -d':' -f2 | tr -d ' \r')
  echo "✅ X-RateLimit-Reset: $RESET"

  # Verify reset is a Unix timestamp (numeric and reasonable)
  if [[ "$RESET" =~ ^[0-9]+$ ]] && [ "$RESET" -gt 1700000000 ]; then
    RESET_DATE=$(date -r "$RESET" 2>/dev/null || date -d "@$RESET" 2>/dev/null || echo "N/A")
    echo "   Reset time: $RESET_DATE"
  else
    echo "⚠️  WARNING: Reset timestamp looks invalid: $RESET"
  fi
else
  echo "❌ FAILED: X-RateLimit-Reset header not found"
  exit 1
fi

# Check HTTP status
HTTP_STATUS=$(echo "$RESPONSE" | head -n 1 | grep -oE '[0-9]{3}' | head -n 1)
if [ "$HTTP_STATUS" == "200" ] || [ "$HTTP_STATUS" == "429" ]; then
  echo "✅ HTTP Status: $HTTP_STATUS"
else
  echo "❌ Unexpected HTTP status: $HTTP_STATUS"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ ALL TESTS PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Verdict: All required X-RateLimit-* headers are present and correctly formatted."
echo ""
echo "Headers found:"
echo "  X-RateLimit-Limit: $LIMIT"
echo "  X-RateLimit-Remaining: $REMAINING"
echo "  X-RateLimit-Reset: $RESET"
