#!/bin/bash
# Test script for admin API key rotation endpoint
# Usage: ./scripts/test-admin-rotate-key.sh

set -e

WORKER_URL="https://reporting-tool-api.jamesredwards89.workers.dev"
AGENCY_ID="0700c1a2-c15d-4d36-baaf-5a94e84b5c15"

echo "🧪 Testing Admin API Key Rotation Endpoint"
echo "=========================================="
echo ""

# Prompt for admin secret
read -s -p "Enter ADMIN_SECRET: " ADMIN_SECRET
echo ""
echo ""

# Test 1: Missing admin secret (should return 403)
echo "Test 1: Missing admin secret (expect 403)..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$WORKER_URL/api/admin/agency/$AGENCY_ID/rotate-key")

if [ "$STATUS" = "403" ]; then
  echo "✓ PASS: Correctly rejected request without admin secret"
else
  echo "✗ FAIL: Expected 403, got $STATUS"
  exit 1
fi

echo ""

# Test 2: Invalid admin secret (should return 403)
echo "Test 2: Invalid admin secret (expect 403)..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$WORKER_URL/api/admin/agency/$AGENCY_ID/rotate-key" \
  -H "x-admin-secret: invalid-secret")

if [ "$STATUS" = "403" ]; then
  echo "✓ PASS: Correctly rejected request with invalid admin secret"
else
  echo "✗ FAIL: Expected 403, got $STATUS"
  exit 1
fi

echo ""

# Test 3: Invalid agency ID (should return 404)
echo "Test 3: Invalid agency ID (expect 404)..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$WORKER_URL/api/admin/agency/non-existent-id/rotate-key" \
  -H "x-admin-secret: $ADMIN_SECRET")

if [ "$STATUS" = "404" ]; then
  echo "✓ PASS: Correctly returned 404 for non-existent agency"
else
  echo "✗ FAIL: Expected 404, got $STATUS"
  exit 1
fi

echo ""

# Test 4: Valid rotation (should return 200 with new API key)
echo "Test 4: Valid rotation (expect 200)..."
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST "$WORKER_URL/api/admin/agency/$AGENCY_ID/rotate-key" \
  -H "x-admin-secret: $ADMIN_SECRET")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

if [ "$HTTP_CODE" = "200" ]; then
  echo "✓ PASS: Rotation succeeded"
  echo ""
  echo "Response:"
  echo "$BODY" | jq .

  # Extract new API key
  NEW_KEY=$(echo "$BODY" | jq -r '.newApiKey')

  if [ -n "$NEW_KEY" ] && [ "$NEW_KEY" != "null" ]; then
    echo ""
    echo "✓ New API key generated: ${NEW_KEY:0:8}...${NEW_KEY: -8}"

    # Test 5: Verify new key works
    echo ""
    echo "Test 5: Verify new key works (expect 200)..."
    VERIFY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      "$WORKER_URL/api/clients" \
      -H "x-api-key: $NEW_KEY")

    if [ "$VERIFY_STATUS" = "200" ]; then
      echo "✓ PASS: New API key works correctly"
    else
      echo "✗ FAIL: New API key returned HTTP $VERIFY_STATUS"
      exit 1
    fi
  else
    echo "✗ FAIL: No API key in response"
    exit 1
  fi
else
  echo "✗ FAIL: Expected 200, got $HTTP_CODE"
  echo "Response: $BODY"
  exit 1
fi

echo ""
echo "=========================================="
echo "✅ All tests passed!"
echo ""
echo "⚠️  Save the new API key securely:"
echo "$NEW_KEY"
