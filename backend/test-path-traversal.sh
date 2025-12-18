#!/bin/bash
# Path Traversal Security Tests
# Tests filename validation fixes from Hostile Audit Phase 2 Sanity Check

set -e

echo "🔒 Path Traversal Security Tests"
echo "=================================="
echo ""

# Configuration
BASE_URL="${BASE_URL:-http://localhost:8787}"
API_KEY="${API_KEY:-test-api-key}"
CLIENT_ID="${CLIENT_ID:-test-client-id}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASS=0
FAIL=0

# Test function
test_traversal() {
  local test_name="$1"
  local filename="$2"
  local expected_code="$3"

  echo -n "Testing: $test_name... "

  response=$(curl -X POST "${BASE_URL}/api/reports/${CLIENT_ID}/${filename}/signed-url" \
    -H "x-api-key: ${API_KEY}" \
    -s -w "\n%{http_code}" \
    2>/dev/null)

  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')
  error_code=$(echo "$body" | jq -r '.error.code // empty' 2>/dev/null)

  if [ "$error_code" == "$expected_code" ]; then
    echo -e "${GREEN}PASS${NC} (${error_code})"
    ((PASS++))
  else
    echo -e "${RED}FAIL${NC} (Expected: ${expected_code}, Got: ${error_code:-$http_code})"
    ((FAIL++))
  fi
}

# Test valid filename first
test_traversal "Valid filename" "report-2025-12-18.pdf" "OK"

# Test path traversal attacks
test_traversal "Path traversal (../)" "../secret.pdf" "INVALID_FILENAME"
test_traversal "Path traversal (../../)" "../../etc/passwd.pdf" "INVALID_FILENAME"
test_traversal "Forward slash" "subdir/report.pdf" "INVALID_FILENAME"
test_traversal "Backslash" "..\\secret.pdf" "INVALID_FILENAME"
test_traversal "Multiple dots" "...pdf" "INVALID_FILENAME"
test_traversal "Hidden file" ".secret.pdf" "INVALID_FILENAME"
test_traversal "Absolute path" "/etc/passwd.pdf" "INVALID_FILENAME"
test_traversal "Null byte" "report.pdf\0.txt" "INVALID_FILENAME"
test_traversal "Special chars (!)" "report!.pdf" "INVALID_FILENAME"
test_traversal "Special chars (@)" "report@2025.pdf" "INVALID_FILENAME"
test_traversal "Spaces" "my report.pdf" "INVALID_FILENAME"
test_traversal "Unicode" "report™.pdf" "INVALID_FILENAME"

# Test case variations
test_traversal "Uppercase extension" "report.PDF" "OK"
test_traversal "Mixed case extension" "report.Pdf" "OK"

echo ""
echo "=================================="
echo -e "Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "=================================="

if [ $FAIL -gt 0 ]; then
  exit 1
fi
