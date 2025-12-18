# HOSTILE AUDIT PHASE 2 - TEST SUITE
**Trust Boundaries: PDF Security & PII Logging**

Date: 2025-12-18
Status: Implementation Complete
Verification: Manual Testing Required

---

## OVERVIEW

This document provides comprehensive test cases for Hostile Audit Phase 2 implementations:
- **Objective A**: Secure PDF Downloads (signed token authentication)
- **Objective B**: PII Logging Resolution (removed from all logs)

---

## OBJECTIVE A: PDF DOWNLOAD SECURITY TESTS

### Test Environment Setup

```bash
# Set environment variables
export BASE_URL="http://localhost:8787"
export API_KEY="your-agency-api-key"
export AGENCY_ID="your-agency-id"
export CLIENT_ID="your-client-id"
export PDF_SIGNING_SECRET="test-secret-key-change-in-prod"

# Start local development server
cd products/reporting-tool/backend
npm run dev
```

---

### TEST 1: PDF Download Without Token → 401 PDF_TOKEN_REQUIRED

**Scenario**: Attempt to download PDF without providing a signed token

**Request**:
```bash
curl -X GET "http://localhost:8787/reports/${AGENCY_ID}/${CLIENT_ID}/report-2025-12-18.pdf" \
  -v
```

**Expected Response**:
```json
HTTP/1.1 401 Unauthorized
{
  "ok": false,
  "error": {
    "code": "PDF_TOKEN_REQUIRED",
    "message": "PDF download requires a signed token. Please request a new signed URL."
  }
}
```

**Verification Checklist**:
- [ ] Status code is 401
- [ ] Error code is `PDF_TOKEN_REQUIRED`
- [ ] Response includes clear instruction to request signed URL
- [ ] No PDF content is returned

---

### TEST 2: PDF Download With Invalid Token → 403 PDF_TOKEN_INVALID

**Scenario**: Attempt to download PDF with malformed or tampered token

**Request**:
```bash
curl -X GET "http://localhost:8787/reports/${AGENCY_ID}/${CLIENT_ID}/report-2025-12-18.pdf?token=invalid-token-12345" \
  -v
```

**Expected Response**:
```json
HTTP/1.1 403 Forbidden
{
  "ok": false,
  "error": {
    "code": "PDF_TOKEN_INVALID",
    "message": "Invalid PDF token. Please request a new signed URL."
  }
}
```

**Verification Checklist**:
- [ ] Status code is 403
- [ ] Error code is `PDF_TOKEN_INVALID`
- [ ] Token signature verification fails
- [ ] No PDF content is returned

---

### TEST 3: PDF Download With Expired Token → 403 PDF_TOKEN_EXPIRED

**Scenario**: Attempt to download PDF with token past expiration time

**Setup**: Generate token with very short TTL (1 second), wait 2 seconds, then attempt download

**Request 1: Generate short-lived token**
```bash
SIGNED_URL=$(curl -X POST "http://localhost:8787/api/reports/${CLIENT_ID}/report-2025-12-18.pdf/signed-url?ttl=1" \
  -H "x-api-key: ${API_KEY}" \
  -s | jq -r '.url')

echo "Signed URL: ${SIGNED_URL}"
echo "Waiting 2 seconds for token to expire..."
sleep 2
```

**Request 2: Attempt download with expired token**
```bash
curl -X GET "${SIGNED_URL}" -v
```

**Expected Response**:
```json
HTTP/1.1 403 Forbidden
{
  "ok": false,
  "error": {
    "code": "PDF_TOKEN_EXPIRED",
    "message": "PDF token has expired. Please request a new signed URL."
  }
}
```

**Verification Checklist**:
- [ ] Status code is 403
- [ ] Error code is `PDF_TOKEN_EXPIRED`
- [ ] Token expiration time is correctly validated
- [ ] No PDF content is returned

---

### TEST 4: PDF Download With Token Parameter Mismatch → 403 PDF_TOKEN_MISMATCH

**Scenario**: Attempt to reuse token for different PDF (different agencyId, clientId, or filename)

**Setup**: Generate token for one PDF, attempt to use it for another

**Request 1: Generate token for legitimate PDF**
```bash
SIGNED_URL=$(curl -X POST "http://localhost:8787/api/reports/${CLIENT_ID}/report-2025-12-18.pdf/signed-url" \
  -H "x-api-key: ${API_KEY}" \
  -s | jq -r '.url')

# Extract token from URL
TOKEN=$(echo "${SIGNED_URL}" | grep -oP 'token=\K[^&]+')
echo "Token: ${TOKEN}"
```

**Request 2: Attempt to use token for different PDF**
```bash
curl -X GET "http://localhost:8787/reports/${AGENCY_ID}/${CLIENT_ID}/different-report.pdf?token=${TOKEN}" \
  -v
```

**Expected Response**:
```json
HTTP/1.1 403 Forbidden
{
  "ok": false,
  "error": {
    "code": "PDF_TOKEN_MISMATCH",
    "message": "Token parameters do not match the requested PDF."
  }
}
```

**Verification Checklist**:
- [ ] Status code is 403
- [ ] Error code is `PDF_TOKEN_MISMATCH`
- [ ] Token cannot be reused for different PDFs
- [ ] Token payload is validated against URL parameters
- [ ] No PDF content is returned

---

### TEST 5: Generate Signed URL Without Authentication → 401 UNAUTHORIZED

**Scenario**: Attempt to generate signed URL without agency API key

**Request**:
```bash
curl -X POST "http://localhost:8787/api/reports/${CLIENT_ID}/report-2025-12-18.pdf/signed-url" \
  -v
```

**Expected Response**:
```json
HTTP/1.1 401 Unauthorized
{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid API key"
  }
}
```

**Verification Checklist**:
- [ ] Status code is 401
- [ ] Error code is `UNAUTHORIZED`
- [ ] No signed URL is returned

---

### TEST 6: Generate Signed URL With Invalid TTL → 400 INVALID_TTL

**Scenario**: Request signed URL with invalid TTL parameter

**Request**:
```bash
curl -X POST "http://localhost:8787/api/reports/${CLIENT_ID}/report-2025-12-18.pdf/signed-url?ttl=-100" \
  -H "x-api-key: ${API_KEY}" \
  -v
```

**Expected Response**:
```json
HTTP/1.1 400 Bad Request
{
  "ok": false,
  "error": {
    "code": "INVALID_TTL",
    "message": "TTL must be a positive integer"
  }
}
```

**Verification Checklist**:
- [ ] Status code is 400
- [ ] Error code is `INVALID_TTL`
- [ ] Negative TTL values are rejected
- [ ] Zero TTL values are rejected
- [ ] Non-numeric TTL values are rejected

---

### TEST 7: Generate Signed URL For Non-PDF File → 400 INVALID_FILE_TYPE

**Scenario**: Attempt to generate signed URL for non-PDF file

**Request**:
```bash
curl -X POST "http://localhost:8787/api/reports/${CLIENT_ID}/report-2025-12-18.txt/signed-url" \
  -H "x-api-key: ${API_KEY}" \
  -v
```

**Expected Response**:
```json
HTTP/1.1 400 Bad Request
{
  "ok": false,
  "error": {
    "code": "INVALID_FILE_TYPE",
    "message": "Filename must end with .pdf"
  }
}
```

**Verification Checklist**:
- [ ] Status code is 400
- [ ] Error code is `INVALID_FILE_TYPE`
- [ ] Only .pdf files are allowed

---

### TEST 8: Generate Signed URL For Client Not Owned By Agency → 403 UNAUTHORIZED

**Scenario**: Agency attempts to generate signed URL for another agency's client

**Request**:
```bash
curl -X POST "http://localhost:8787/api/reports/other-agency-client-id/report-2025-12-18.pdf/signed-url" \
  -H "x-api-key: ${API_KEY}" \
  -v
```

**Expected Response**:
```json
HTTP/1.1 403 Forbidden
{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Unauthorized"
  }
}
```

**Verification Checklist**:
- [ ] Status code is 403
- [ ] Error code is `UNAUTHORIZED`
- [ ] Client ownership is validated
- [ ] Cross-agency access is blocked

---

### TEST 9: Successful PDF Download With Valid Token → 200 OK

**Scenario**: Happy path - generate signed URL and successfully download PDF

**Request 1: Generate signed URL**
```bash
SIGNED_URL=$(curl -X POST "http://localhost:8787/api/reports/${CLIENT_ID}/report-2025-12-18.pdf/signed-url" \
  -H "x-api-key: ${API_KEY}" \
  -s | jq -r '.url')

echo "Signed URL: ${SIGNED_URL}"
```

**Expected Response 1**:
```json
HTTP/1.1 200 OK
{
  "ok": true,
  "url": "http://localhost:8787/reports/{agencyId}/{clientId}/report-2025-12-18.pdf?token={validToken}",
  "expiresAt": "2025-12-18T14:15:00.000Z",
  "ttl": 900
}
```

**Request 2: Download PDF with signed URL**
```bash
curl -X GET "${SIGNED_URL}" \
  -o downloaded-report.pdf \
  -v
```

**Expected Response 2**:
```
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="report-2025-12-18.pdf"
Cache-Control: private, max-age=900
[PDF binary content]
```

**Verification Checklist**:
- [ ] Signed URL generation returns 200 OK
- [ ] URL contains valid token in query parameter
- [ ] expiresAt timestamp is correct (current time + TTL)
- [ ] PDF download with token returns 200 OK
- [ ] Content-Type is `application/pdf`
- [ ] Cache-Control is `private` (not public)
- [ ] PDF file is valid and can be opened

---

### TEST 10: TTL Capping → Max 1 Hour

**Scenario**: Request signed URL with TTL exceeding maximum (3600 seconds)

**Request**:
```bash
curl -X POST "http://localhost:8787/api/reports/${CLIENT_ID}/report-2025-12-18.pdf/signed-url?ttl=7200" \
  -H "x-api-key: ${API_KEY}" \
  -s | jq
```

**Expected Response**:
```json
HTTP/1.1 200 OK
{
  "ok": true,
  "url": "http://localhost:8787/reports/{agencyId}/{clientId}/report-2025-12-18.pdf?token={validToken}",
  "expiresAt": "2025-12-18T15:00:00.000Z",
  "ttl": 3600
}
```

**Verification Checklist**:
- [ ] TTL is capped at 3600 seconds (1 hour)
- [ ] expiresAt reflects capped TTL, not requested TTL
- [ ] Response explicitly shows `ttl: 3600`

---

### TEST 11: Enumeration Resistance

**Scenario**: Verify that URL enumeration is impossible without secret

**Attack Attempt**:
```bash
# Try to guess valid PDF URLs without tokens
for i in {1..100}; do
  curl -X GET "http://localhost:8787/reports/${AGENCY_ID}/${CLIENT_ID}/report-2025-12-${i}.pdf" \
    -s -o /dev/null -w "%{http_code}\n"
done
```

**Expected Behavior**:
- All requests without tokens should return 401 PDF_TOKEN_REQUIRED
- No PDF content should be accessible without valid token
- No timing differences should reveal PDF existence

**Verification Checklist**:
- [ ] All requests without tokens fail with 401
- [ ] No difference in response time for existing vs. non-existing PDFs
- [ ] Error messages do not reveal PDF existence

---

### TEST 12: Email Contains Signed URL

**Scenario**: Verify that report emails contain signed URLs, not raw PDF paths

**Setup**: Trigger report send in dev mode (dev mode logs email content)

**Request**:
```bash
curl -X POST "http://localhost:8787/api/client/${CLIENT_ID}/report/send" \
  -H "x-api-key: ${API_KEY}" \
  -v
```

**Expected Dev Mode Console Output**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📧 EMAIL (DEV MODE - NOT SENT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
To: client@example.com
From: reports@rapidtools.io
Subject: Weekly Report: Client Name
PDF URL: http://localhost:8787/reports/{agencyId}/{clientId}/report-2025-12-18.pdf?token={validToken}
-------------------------------------------
HTML Summary:
... [includes signed URL link] ...
This secure link expires in 24 hours.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Verification Checklist**:
- [ ] Email contains PDF URL with `?token=` parameter
- [ ] HTML includes "This secure link expires in 24 hours" notice
- [ ] Token is present in logged URL
- [ ] No raw S3/R2 paths are exposed

---

## OBJECTIVE B: PII LOGGING RESOLUTION TESTS

### Test Environment Setup

```bash
# Run scheduled report job and capture logs
npm run dev

# In another terminal, trigger scheduled run
curl -X POST "http://localhost:8787/__scheduled" \
  -H "Cron: 0 9 * * 1"
```

---

### TEST 13: No Client Names In Logs

**Scenario**: Verify that client names are never logged

**Test Procedure**:
1. Trigger report send for multiple clients
2. Grep logs for any client name occurrences

**Verification Command**:
```bash
# Check for clientName in any log output
grep -r "clientName" src/ --include="*.ts" | grep -E "(console\.|log)" | grep -v "interface\|type\|export\|import"

# Should return no results
```

**Expected Result**: No matches found

**Verification Checklist**:
- [ ] No `clientName` in console.log statements
- [ ] No `client.name` in console.log statements
- [ ] Client identifiers use `clientId` (UUID) only

---

### TEST 14: No Client Emails In Logs

**Scenario**: Verify that client emails are never logged

**Test Procedure**:
1. Trigger report send for multiple clients
2. Grep logs for any email occurrences

**Verification Command**:
```bash
# Check for clientEmail in any log output
grep -r "clientEmail\|client.email" src/ --include="*.ts" | grep -E "(console\.|log)" | grep -v "interface\|type\|export\|import"

# Should return no results
```

**Expected Result**: No matches found

**Verification Checklist**:
- [ ] No `clientEmail` in console.log statements
- [ ] No `client.email` in console.log statements
- [ ] Email addresses are only used for API responses and email sending, never logging

---

### TEST 15: No Agency Names In Logs

**Scenario**: Verify that agency names are never logged

**Test Procedure**:
1. Trigger agency operations (checkout, subscription updates)
2. Grep logs for any agency name occurrences

**Verification Command**:
```bash
# Check for agencyName in any log output
grep -r "agencyName\|agency.name" src/ --include="*.ts" | grep -E "(console\.|log)" | grep -v "interface\|type\|export\|import"

# Should return no results
```

**Expected Result**: No matches found

**Verification Checklist**:
- [ ] No `agencyName` in console.log statements
- [ ] No `agency.name` in console.log statements
- [ ] Agency identifiers use `agencyId` (UUID) only

---

### TEST 16: Scheduled Run Logs Use Stable Identifiers Only

**Scenario**: Verify that scheduled report run logs contain only stable identifiers

**Test Procedure**:
1. Trigger scheduled report run
2. Inspect console output for PII

**Expected Console Output**:
```json
{
  "level": "info",
  "message": "Scheduled report run started",
  "timestamp": "2025-12-18T14:00:00.000Z",
  "runId": "run-2025-12-18T14:00:00.000Z-abc123",
  "environment": "prod",
  "dryRun": false,
  "automationEnabled": true
}

{
  "level": "info",
  "message": "Processing agency",
  "timestamp": "2025-12-18T14:00:01.000Z",
  "runId": "run-2025-12-18T14:00:00.000Z-abc123",
  "agencyId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}

{
  "level": "info",
  "message": "Sending report",
  "timestamp": "2025-12-18T14:00:02.000Z",
  "runId": "run-2025-12-18T14:00:00.000Z-abc123",
  "agencyId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "clientId": "c1d2e3f4-a5b6-7890-cdef-ab1234567890"
}

{
  "level": "info",
  "message": "Report sent successfully",
  "timestamp": "2025-12-18T14:00:05.000Z",
  "runId": "run-2025-12-18T14:00:00.000Z-abc123",
  "agencyId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "clientId": "c1d2e3f4-a5b6-7890-cdef-ab1234567890",
  "pdfKey": "reports/a1b2c3d4-e5f6-7890-abcd-ef1234567890/c1d2e3f4-a5b6-7890-cdef-ab1234567890/report-2025-12-18.pdf",
  "sentAt": "2025-12-18T14:00:05.000Z",
  "retries": 0
}
```

**Verification Checklist**:
- [ ] Logs contain only: `runId`, `agencyId`, `clientId`, `pdfKey`, `sentAt`, `retries`, `error`, `status`
- [ ] No `agencyName`, `clientName`, `clientEmail`, `billingEmail`
- [ ] All identifiers are UUIDs or stable keys

---

### TEST 17: Failure Logs Contain No PII

**Scenario**: Verify that error logs do not contain PII

**Test Procedure**:
1. Trigger report send with intentional failure (e.g., invalid CSV)
2. Inspect error logs

**Expected Console Output**:
```json
{
  "level": "error",
  "message": "Report send failed",
  "timestamp": "2025-12-18T14:00:10.000Z",
  "runId": "run-2025-12-18T14:00:00.000Z-abc123",
  "agencyId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "clientId": "c1d2e3f4-a5b6-7890-cdef-ab1234567890",
  "error": "No GA4 data uploaded for this client",
  "retries": 2
}
```

**Verification Checklist**:
- [ ] Error logs contain only stable identifiers
- [ ] No client or agency names in error messages
- [ ] Error descriptions are generic, not PII-revealing

---

### TEST 18: Stripe Checkout Logs Contain No PII

**Scenario**: Verify that Stripe checkout dev mode logs do not contain PII

**Test Procedure**:
1. Trigger Stripe checkout in dev mode
2. Inspect console output

**Expected Console Output**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 STRIPE CHECKOUT (DEV MODE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Agency ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
Price: Starter Plan (£25/month)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Verification Checklist**:
- [ ] No `agency.name` in console output
- [ ] No `agency.billingEmail` in console output
- [ ] Only `Agency ID` (UUID) is logged

---

### TEST 19: Scheduled Run Summary Contains No PII

**Scenario**: Verify that scheduled run summary printed to console contains no PII

**Test Procedure**:
1. Complete scheduled report run
2. Inspect final summary output

**Expected Console Output**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ SCHEDULED REPORT RUN SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Run ID: run-2025-12-18T14:00:00.000Z-abc123
Agencies processed: 5
Clients processed: 12
Reports sent: 10
Reports skipped: 1
Reports failed: 1
Duration: 45000ms

Failed reports:
  - Agency a1b2c3d4-e5f6-7890-abcd-ef1234567890 / Client c1d2e3f4-a5b6-7890-cdef-ab1234567890: No GA4 data uploaded for this client
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Verification Checklist**:
- [ ] Summary uses "Agency {agencyId} / Client {clientId}" format
- [ ] No agency names in failure list
- [ ] No client names in failure list
- [ ] UUIDs are displayed, not human-readable names

---

## TEST EXECUTION SUMMARY

### Phase 2A: PDF Security (12 tests)
- [ ] TEST 1: PDF_TOKEN_REQUIRED
- [ ] TEST 2: PDF_TOKEN_INVALID
- [ ] TEST 3: PDF_TOKEN_EXPIRED
- [ ] TEST 4: PDF_TOKEN_MISMATCH
- [ ] TEST 5: Unsigned URL generation requires auth
- [ ] TEST 6: INVALID_TTL
- [ ] TEST 7: INVALID_FILE_TYPE
- [ ] TEST 8: Cross-agency access blocked
- [ ] TEST 9: Successful download with valid token
- [ ] TEST 10: TTL capping at 1 hour
- [ ] TEST 11: Enumeration resistance
- [ ] TEST 12: Email contains signed URLs

### Phase 2B: PII Logging (7 tests)
- [ ] TEST 13: No client names in logs
- [ ] TEST 14: No client emails in logs
- [ ] TEST 15: No agency names in logs
- [ ] TEST 16: Scheduled run uses stable identifiers
- [ ] TEST 17: Failure logs contain no PII
- [ ] TEST 18: Stripe checkout logs contain no PII
- [ ] TEST 19: Scheduled run summary contains no PII

---

## VERIFICATION SCRIPT

Save as `test-phase-2.sh`:

```bash
#!/bin/bash
set -e

echo "🔒 HOSTILE AUDIT PHASE 2 - TEST SUITE"
echo "======================================"
echo ""

# Configuration
export BASE_URL="http://localhost:8787"
export API_KEY="${API_KEY:-your-agency-api-key}"
export AGENCY_ID="${AGENCY_ID:-your-agency-id}"
export CLIENT_ID="${CLIENT_ID:-your-client-id}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
PASS=0
FAIL=0

# Test function
test_endpoint() {
  local test_name="$1"
  local expected_code="$2"
  local url="$3"
  local method="${4:-GET}"
  local headers="${5:-}"

  echo -n "Testing: $test_name... "

  if [ "$method" == "POST" ]; then
    response_code=$(curl -X POST "$url" $headers -s -o /dev/null -w "%{http_code}")
  else
    response_code=$(curl -X GET "$url" $headers -s -o /dev/null -w "%{http_code}")
  fi

  if [ "$response_code" == "$expected_code" ]; then
    echo -e "${GREEN}PASS${NC} (HTTP $response_code)"
    ((PASS++))
  else
    echo -e "${RED}FAIL${NC} (Expected $expected_code, got $response_code)"
    ((FAIL++))
  fi
}

echo "📋 Running PDF Security Tests..."
echo ""

# TEST 1: PDF_TOKEN_REQUIRED
test_endpoint "PDF without token" "401" \
  "${BASE_URL}/reports/${AGENCY_ID}/${CLIENT_ID}/report.pdf"

# TEST 2: PDF_TOKEN_INVALID
test_endpoint "PDF with invalid token" "403" \
  "${BASE_URL}/reports/${AGENCY_ID}/${CLIENT_ID}/report.pdf?token=invalid"

# TEST 5: Unsigned URL without auth
test_endpoint "Signed URL without auth" "401" \
  "${BASE_URL}/api/reports/${CLIENT_ID}/report.pdf/signed-url" \
  "POST"

# TEST 6: Invalid TTL
test_endpoint "Signed URL with invalid TTL" "400" \
  "${BASE_URL}/api/reports/${CLIENT_ID}/report.pdf/signed-url?ttl=-100" \
  "POST" \
  "-H 'x-api-key: ${API_KEY}'"

# TEST 7: Non-PDF file
test_endpoint "Signed URL for non-PDF" "400" \
  "${BASE_URL}/api/reports/${CLIENT_ID}/report.txt/signed-url" \
  "POST" \
  "-H 'x-api-key: ${API_KEY}'"

echo ""
echo "📋 Running PII Logging Tests..."
echo ""

# PII Grep Tests
echo -n "Checking for clientName in logs... "
if ! grep -r "clientName" src/ --include="*.ts" | grep -E "(console\.|log)" | grep -v "interface\|type\|export\|import" > /dev/null 2>&1; then
  echo -e "${GREEN}PASS${NC} (No PII found)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} (PII found in logs)"
  ((FAIL++))
fi

echo -n "Checking for clientEmail in logs... "
if ! grep -r "clientEmail\|client.email" src/ --include="*.ts" | grep -E "(console\.|log)" | grep -v "interface\|type\|export\|import" > /dev/null 2>&1; then
  echo -e "${GREEN}PASS${NC} (No PII found)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} (PII found in logs)"
  ((FAIL++))
fi

echo -n "Checking for agencyName in logs... "
if ! grep -r "agencyName\|agency.name" src/ --include="*.ts" | grep -E "(console\.|log)" | grep -v "interface\|type\|export\|import" > /dev/null 2>&1; then
  echo -e "${GREEN}PASS${NC} (No PII found)"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} (PII found in logs)"
  ((FAIL++))
fi

echo ""
echo "======================================"
echo -e "Test Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "======================================"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
```

**Run tests**:
```bash
chmod +x test-phase-2.sh
./test-phase-2.sh
```

---

## MANUAL VERIFICATION CHECKLIST

### PDF Security
- [ ] All PDF downloads require signed tokens
- [ ] Tokens expire correctly (tested with short TTL)
- [ ] Token signature verification works (tested with invalid tokens)
- [ ] Token parameter matching prevents reuse (tested with mismatched parameters)
- [ ] TTL is capped at 1 hour maximum
- [ ] Email templates include signed URLs with expiration notices
- [ ] Cache-Control is set to `private` for PDF downloads

### PII Logging
- [ ] No client names in any log output
- [ ] No client emails in any log output
- [ ] No agency names in any log output
- [ ] No billing emails in any log output
- [ ] All logs use stable identifiers only (UUIDs, requestIds, etc.)
- [ ] Scheduled run summary uses "Agency {id} / Client {id}" format
- [ ] Error logs contain no PII

---

## NOTES

- All tests should be run in both dev and prod environments
- Dev mode may skip actual email/PDF generation but should still validate token logic
- Production testing requires real Stripe/Resend integration
- Some tests require existing clients and uploaded CSV data
- Token expiration tests are time-sensitive

---

## VERIFICATION STATUS

**Date**: 2025-12-18
**Status**: ⏳ Awaiting Manual Testing
**Next Steps**: Run automated test suite and manual verification checklist
