#!/usr/bin/env bash
# FRS-1 Test: Idempotency Header Case Acceptance
# Verifies that both lowercase and capitalized header forms work

set -euo pipefail

BASE_URL="${RAPIDTOOLS_BASE_URL:-https://reporting-api.rapidtools.dev}"
API_KEY="${RAPIDTOOLS_API_KEY:?RAPIDTOOLS_API_KEY must be set}"
CLIENT_ID="${RAPIDTOOLS_CLIENT_ID:?RAPIDTOOLS_CLIENT_ID must be set}"

IDEMPOTENCY_KEY="frs1-test-$(date +%s)"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "FRS-1 TEST: Idempotency Header Case Acceptance"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Base URL: $BASE_URL"
echo "Client ID: $CLIENT_ID"
echo "Idempotency Key: $IDEMPOTENCY_KEY"
echo ""

# Test 1: Lowercase header
echo "Test 1: Using lowercase 'idempotency-key' header..."
RESPONSE1=$(curl -s -w "\n%{http_code}" -X POST \
  "$BASE_URL/api/client/$CLIENT_ID/report/send" \
  -H "x-api-key: $API_KEY" \
  -H "idempotency-key: $IDEMPOTENCY_KEY")

HTTP_CODE1=$(echo "$RESPONSE1" | tail -n1)
BODY1=$(echo "$RESPONSE1" | sed '$d')

echo "HTTP Status: $HTTP_CODE1"
echo "Response: $BODY1"
echo ""

if [ "$HTTP_CODE1" -eq 200 ]; then
  echo "✅ Test 1 PASSED: Lowercase header accepted"
else
  echo "❌ Test 1 FAILED: Expected 200, got $HTTP_CODE1"
  exit 1
fi

# Test 2: Capitalized header (replay with same key)
echo "Test 2: Using capitalized 'Idempotency-Key' header (replay)..."
RESPONSE2=$(curl -s -w "\n%{http_code}" -X POST \
  "$BASE_URL/api/client/$CLIENT_ID/report/send" \
  -H "x-api-key: $API_KEY" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY")

HTTP_CODE2=$(echo "$RESPONSE2" | tail -n1)
BODY2=$(echo "$RESPONSE2" | sed '$d')

echo "HTTP Status: $HTTP_CODE2"
echo "Response: $BODY2"
echo ""

if [ "$HTTP_CODE2" -eq 200 ]; then
  # Check if response contains "replayed: true"
  if echo "$BODY2" | grep -q '"replayed".*true'; then
    echo "✅ Test 2 PASSED: Capitalized header accepted, idempotency working (replayed: true)"
  else
    echo "❌ Test 2 FAILED: Expected replayed: true, but not found in response"
    exit 1
  fi
else
  echo "❌ Test 2 FAILED: Expected 200, got $HTTP_CODE2"
  exit 1
fi

# Test 3: Different case, new key (verify both forms work independently)
NEW_KEY="frs1-test-caps-$(date +%s)"
echo "Test 3: Using capitalized header with new key..."
RESPONSE3=$(curl -s -w "\n%{http_code}" -X POST \
  "$BASE_URL/api/client/$CLIENT_ID/report/send" \
  -H "x-api-key: $API_KEY" \
  -H "Idempotency-Key: $NEW_KEY")

HTTP_CODE3=$(echo "$RESPONSE3" | tail -n1)
BODY3=$(echo "$RESPONSE3" | sed '$d')

echo "HTTP Status: $HTTP_CODE3"
echo "Response: $BODY3"
echo ""

if [ "$HTTP_CODE3" -eq 200 ]; then
  echo "✅ Test 3 PASSED: Capitalized header works with new key"
else
  echo "❌ Test 3 FAILED: Expected 200, got $HTTP_CODE3"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ ALL TESTS PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Verdict: Both 'idempotency-key' (lowercase) and 'Idempotency-Key'"
echo "         (capitalized) header forms are accepted and working correctly."
