#!/bin/bash
# Token Expiry Boundary Tests
# Tests expiry fix from Hostile Audit Phase 2 Sanity Check

set -e

echo "⏱️  Token Expiry Boundary Tests"
echo "================================"
echo ""

# Configuration
BASE_URL="${BASE_URL:-http://localhost:8787}"
API_KEY="${API_KEY:-test-api-key}"
CLIENT_ID="${CLIENT_ID:-test-client-id}"
FILENAME="report-2025-12-18.pdf"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASS=0
FAIL=0

echo "Test 1: Token expires exactly now (boundary condition)"
echo "-------------------------------------------------------"

# Generate token with 1-second TTL
echo "Generating signed URL with 1-second TTL..."
response=$(curl -X POST "${BASE_URL}/api/reports/${CLIENT_ID}/${FILENAME}/signed-url?ttl=1" \
  -H "x-api-key: ${API_KEY}" \
  -s 2>/dev/null)

signed_url=$(echo "$response" | jq -r '.url // empty')

if [ -z "$signed_url" ]; then
  echo -e "${RED}FAIL${NC}: Could not generate signed URL"
  echo "Response: $response"
  exit 1
fi

echo "Signed URL generated: $signed_url"
echo "Waiting 1.5 seconds for token to expire..."
sleep 1.5

# Attempt download after expiry
echo "Attempting download with expired token..."
download_response=$(curl -X GET "$signed_url" -s 2>/dev/null)
error_code=$(echo "$download_response" | jq -r '.error.code // empty')

if [ "$error_code" == "PDF_TOKEN_EXPIRED" ]; then
  echo -e "${GREEN}PASS${NC}: Expired token correctly rejected (PDF_TOKEN_EXPIRED)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC}: Expected PDF_TOKEN_EXPIRED, got: $error_code"
  echo "Response: $download_response"
  ((FAIL++))
fi

echo ""
echo "Test 2: Token still valid just before expiry"
echo "---------------------------------------------"

# Generate token with 3-second TTL
echo "Generating signed URL with 3-second TTL..."
response=$(curl -X POST "${BASE_URL}/api/reports/${CLIENT_ID}/${FILENAME}/signed-url?ttl=3" \
  -H "x-api-key: ${API_KEY}" \
  -s 2>/dev/null)

signed_url=$(echo "$response" | jq -r '.url // empty')
expires_at=$(echo "$response" | jq -r '.expiresAt // empty')

if [ -z "$signed_url" ]; then
  echo -e "${RED}FAIL${NC}: Could not generate signed URL"
  exit 1
fi

echo "Signed URL generated, expires at: $expires_at"
echo "Waiting 1 second (token should still be valid)..."
sleep 1

# Attempt download before expiry
echo "Attempting download with valid token..."
download_response=$(curl -X GET "$signed_url" -s -w "\n%{http_code}" 2>/dev/null)
http_code=$(echo "$download_response" | tail -n1)

if [ "$http_code" == "200" ] || [ "$http_code" == "404" ]; then
  # 200 = success, 404 = PDF not found (but token was valid)
  echo -e "${GREEN}PASS${NC}: Token still valid before expiry (HTTP $http_code)"
  ((PASS++))
else
  body=$(echo "$download_response" | sed '$d')
  error_code=$(echo "$body" | jq -r '.error.code // empty')
  echo -e "${RED}FAIL${NC}: Token should be valid, got error: $error_code (HTTP $http_code)"
  ((FAIL++))
fi

echo ""
echo "Test 3: Token with very short TTL (edge case)"
echo "----------------------------------------------"

# Generate token with minimum TTL (1 second)
echo "Generating signed URL with minimum TTL (1 second)..."
response=$(curl -X POST "${BASE_URL}/api/reports/${CLIENT_ID}/${FILENAME}/signed-url?ttl=1" \
  -H "x-api-key: ${API_KEY}" \
  -s 2>/dev/null)

signed_url=$(echo "$response" | jq -r '.url // empty')

if [ -z "$signed_url" ]; then
  echo -e "${RED}FAIL${NC}: Could not generate signed URL"
  exit 1
fi

echo "Attempting immediate download (should succeed)..."
download_response=$(curl -X GET "$signed_url" -s -w "\n%{http_code}" 2>/dev/null)
http_code=$(echo "$download_response" | tail -n1)

if [ "$http_code" == "200" ] || [ "$http_code" == "404" ]; then
  echo -e "${GREEN}PASS${NC}: Immediate download succeeded (HTTP $http_code)"
  ((PASS++))
else
  body=$(echo "$download_response" | sed '$d')
  error_code=$(echo "$body" | jq -r '.error.code // empty')
  echo -e "${RED}FAIL${NC}: Immediate download should succeed, got: $error_code (HTTP $http_code)"
  ((FAIL++))
fi

echo ""
echo "================================"
echo -e "Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "================================"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
