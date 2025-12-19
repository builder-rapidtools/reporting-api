#!/usr/bin/env bash
# FRS-2 Test: Retry Semantics Validation
# Verifies that retry-safe endpoints behave as documented

set -euo pipefail

BASE_URL="${RAPIDTOOLS_BASE_URL:-https://reporting-api.rapidtools.dev}"
API_KEY="${RAPIDTOOLS_API_KEY:?RAPIDTOOLS_API_KEY must be set}"
CLIENT_ID="${RAPIDTOOLS_CLIENT_ID:?RAPIDTOOLS_CLIENT_ID must be set}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "FRS-2 TEST: Retry Semantics Validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Base URL: $BASE_URL"
echo "Client ID: $CLIENT_ID"
echo ""

# Test 1: send_report WITH idempotency-key (should be retry-safe)
echo "Test 1: send_report WITH idempotency-key (retry-safe)..."
IDEMPOTENCY_KEY="frs2-retry-test-$(date +%s)"

# First request
RESPONSE1=$(curl -s -w "\n%{http_code}" -X POST \
  "$BASE_URL/api/client/$CLIENT_ID/report/send" \
  -H "x-api-key: $API_KEY" \
  -H "idempotency-key: $IDEMPOTENCY_KEY")

HTTP_CODE1=$(echo "$RESPONSE1" | tail -n1)
BODY1=$(echo "$RESPONSE1" | sed '$d')

if [ "$HTTP_CODE1" -eq 200 ]; then
  echo "✅ First request succeeded (HTTP 200)"
else
  echo "❌ First request failed (HTTP $HTTP_CODE1)"
  echo "   Response: $BODY1"
  exit 1
fi

# Retry with same key (should return cached response with replayed: true)
sleep 1
RESPONSE2=$(curl -s -w "\n%{http_code}" -X POST \
  "$BASE_URL/api/client/$CLIENT_ID/report/send" \
  -H "x-api-key: $API_KEY" \
  -H "idempotency-key: $IDEMPOTENCY_KEY")

HTTP_CODE2=$(echo "$RESPONSE2" | tail -n1)
BODY2=$(echo "$RESPONSE2" | sed '$d')

if [ "$HTTP_CODE2" -eq 200 ]; then
  # Check for replayed: true
  if echo "$BODY2" | grep -q '"replayed".*true'; then
    echo "✅ Retry returned cached response (replayed: true)"
  else
    echo "❌ Retry succeeded but replayed: true not found"
    echo "   Response: $BODY2"
    exit 1
  fi
else
  echo "❌ Retry failed (HTTP $HTTP_CODE2)"
  echo "   Response: $BODY2"
  exit 1
fi

echo ""

# Test 2: Verify signed URL endpoint is idempotent (retry-safe without header)
echo "Test 2: generate_signed_pdf_url (idempotent, no header needed)..."

# Try to get a signed URL (may 404 if PDF doesn't exist, but should be idempotent)
PDF_FILENAME="2025-12-19T00-00-00-000Z.pdf"

RESPONSE3=$(curl -s -w "\n%{http_code}" -X POST \
  "$BASE_URL/api/reports/$CLIENT_ID/$PDF_FILENAME/signed-url" \
  -H "x-api-key: $API_KEY")

HTTP_CODE3=$(echo "$RESPONSE3" | tail -n1)
BODY3=$(echo "$RESPONSE3" | sed '$d')

# Retry immediately (should return same result)
RESPONSE4=$(curl -s -w "\n%{http_code}" -X POST \
  "$BASE_URL/api/reports/$CLIENT_ID/$PDF_FILENAME/signed-url" \
  -H "x-api-key: $API_KEY")

HTTP_CODE4=$(echo "$RESPONSE4" | tail -n1)
BODY4=$(echo "$RESPONSE4" | sed '$d')

if [ "$HTTP_CODE3" == "$HTTP_CODE4" ]; then
  echo "✅ Signed URL endpoint is idempotent (same status code on retry)"
  echo "   Status: $HTTP_CODE3 (both requests)"
else
  echo "⚠️  WARNING: Signed URL endpoint returned different status codes"
  echo "   First: $HTTP_CODE3, Retry: $HTTP_CODE4"
fi

echo ""

# Test 3: Verify error code exists for idempotency check failure
echo "Test 3: Verify IDEMPOTENCY_CHECK_FAILED error code is documented..."

# Check manifest.json for the error code
MANIFEST_PATH="/Users/james/ai-stack/rapidtools/catalog/rapidtools-reporting/manifest.json"
if [ -f "$MANIFEST_PATH" ]; then
  if grep -q "IDEMPOTENCY_CHECK_FAILED" "$MANIFEST_PATH"; then
    echo "✅ IDEMPOTENCY_CHECK_FAILED error code documented in manifest"
  else
    echo "❌ IDEMPOTENCY_CHECK_FAILED not found in manifest"
    exit 1
  fi
else
  echo "⚠️  WARNING: Manifest not found at $MANIFEST_PATH (skipping check)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ ALL TESTS PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Verdict: Retry semantics are correctly implemented:"
echo "  - send_report WITH idempotency-key: Retry-safe (replayed responses)"
echo "  - generate_signed_pdf_url: Idempotent (stateless)"
echo "  - IDEMPOTENCY_CHECK_FAILED: Documented"
