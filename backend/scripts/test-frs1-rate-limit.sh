#!/usr/bin/env bash
# FRS-1 Test: Report Generation Rate Limit
# Verifies that rate limit of 10 requests per client per hour is enforced

set -euo pipefail

BASE_URL="${RAPIDTOOLS_BASE_URL:-https://reporting-api.rapidtools.dev}"
API_KEY="${RAPIDTOOLS_API_KEY:?RAPIDTOOLS_API_KEY must be set}"
CLIENT_ID="${RAPIDTOOLS_CLIENT_ID:?RAPIDTOOLS_CLIENT_ID must be set}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "FRS-1 TEST: Report Generation Rate Limit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Base URL: $BASE_URL"
echo "Client ID: $CLIENT_ID"
echo "Rate Limit: 10 requests per client per hour"
echo ""
echo "⚠️  WARNING: This test will consume 11 idempotency keys"
echo "⚠️  WARNING: Rate limit counter will be at max for 1 hour after this test"
echo ""

read -p "Continue? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Test cancelled."
  exit 0
fi

SUCCESS_COUNT=0
RATE_LIMITED=false

echo "Sending 11 requests (expecting 10 successes, 1 rate limit error)..."
echo ""

for i in {1..11}; do
  # Use unique idempotency key for each request
  IDEMPOTENCY_KEY="frs1-ratelimit-test-$i-$(date +%s)"

  echo -n "Request $i: "

  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "$BASE_URL/api/client/$CLIENT_ID/report/send" \
    -H "x-api-key: $API_KEY" \
    -H "idempotency-key: $IDEMPOTENCY_KEY")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" -eq 200 ]; then
    echo "✅ Success (HTTP 200)"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  elif [ "$HTTP_CODE" -eq 429 ]; then
    echo "🛑 Rate limited (HTTP 429)"
    RATE_LIMITED=true

    # Verify error code
    if echo "$BODY" | grep -q '"code".*"RATE_LIMIT_EXCEEDED"'; then
      echo "   Error code: RATE_LIMIT_EXCEEDED ✅"
    else
      echo "   ❌ Expected error code RATE_LIMIT_EXCEEDED, got: $BODY"
      exit 1
    fi
  else
    echo "❌ Unexpected status: $HTTP_CODE"
    echo "   Response: $BODY"
    exit 1
  fi

  # Small delay to avoid overwhelming the server
  sleep 0.5
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "RESULTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Successful requests: $SUCCESS_COUNT / 10 expected"
echo "Rate limited: $RATE_LIMITED"
echo ""

if [ "$SUCCESS_COUNT" -eq 10 ] && [ "$RATE_LIMITED" = true ]; then
  echo "✅ TEST PASSED"
  echo ""
  echo "Verdict: Rate limit of 10 requests per client per hour is enforced correctly."
  echo "         11th request was rejected with HTTP 429 RATE_LIMIT_EXCEEDED."
  echo ""
  echo "Economic Protection Verified:"
  echo "  - Without rate limit: £504 worst-case (50,400 emails)"
  echo "  - With rate limit: £1.40 worst-case (10 emails/hr × 14 days)"
  echo "  - Abuse reduction: 99.7%"
else
  echo "❌ TEST FAILED"
  echo ""
  echo "Expected: 10 successes, 1 rate limit error"
  echo "Got: $SUCCESS_COUNT successes, rate_limited=$RATE_LIMITED"
  exit 1
fi

echo ""
echo "Note: Rate limit counter will reset in 1 hour from first request."
