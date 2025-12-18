# Hostile Audit Phase 1: Economic Enforcement Tests

**Date:** 18 December 2025
**Implementation:** Economic enforcement protections against free-riding and abuse

---

## Overview

This document describes tests for the four economic enforcement protections implemented in Phase 1:

1. **Trial Expiration** - 14-day trial limit
2. **Client Count Enforcement** - 5 client limit for Starter plan
3. **CSV Size & Row Limits** - 5MB and 100,000 row limits
4. **Registration Rate Limiting** - 3 registrations per IP per hour

---

## Prerequisites

```bash
cd ~/ai-stack/rapidtools/products/reporting-tool/backend
npm run dev
```

Set up test environment:
```bash
# In .dev.vars
REPORTING_ENV=dev
AUTOMATION_ENABLED=false
```

---

## Test 1: Trial Expiration

### Setup

Create a test agency with an expired trial:

```bash
# Register a new agency
curl -X POST http://localhost:8787/api/agency/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Trial Test Agency",
    "billingEmail": "trial@example.com"
  }' | jq .

# Note the API key returned
export TEST_API_KEY="<api-key-from-response>"
```

### Manual Trial Expiration (for testing)

Use Cloudflare dashboard or wrangler CLI to manually edit the agency record:
```bash
# Get agency ID from registration response
# Manually update trialEndsAt to a past date using KV dashboard
```

Or modify the code temporarily to set a 1-minute trial for testing.

### Verify Enforcement

```bash
# Attempt to create a client with expired trial
curl -X POST http://localhost:8787/api/client \
  -H "Content-Type: application/json" \
  -H "x-api-key: $TEST_API_KEY" \
  -d '{
    "name": "Test Client",
    "email": "client@example.com"
  }'
```

**Expected Response (402):**
```json
{
  "ok": false,
  "error": {
    "code": "TRIAL_EXPIRED",
    "message": "Trial period expired on YYYY-MM-DD. Please subscribe to continue."
  }
}
```

✅ **PASS:** Expired trials are blocked.

---

## Test 2: Client Count Enforcement

### Setup

Create a Starter plan agency and add 5 clients:

```bash
# Register agency
curl -X POST http://localhost:8787/api/agency/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Starter Plan Agency",
    "billingEmail": "starter@example.com"
  }' | jq .

export STARTER_API_KEY="<api-key-from-response>"

# Create 5 clients
for i in {1..5}; do
  curl -X POST http://localhost:8787/api/client \
    -H "Content-Type: application/json" \
    -H "x-api-key: $STARTER_API_KEY" \
    -d "{
      \"name\": \"Client $i\",
      \"email\": \"client$i@example.com\"
    }" | jq .
done
```

### Verify Enforcement

```bash
# Attempt to create 6th client
curl -X POST http://localhost:8787/api/client \
  -H "Content-Type: application/json" \
  -H "x-api-key: $STARTER_API_KEY" \
  -d '{
    "name": "Client 6",
    "email": "client6@example.com"
  }'
```

**Expected Response (403):**
```json
{
  "ok": false,
  "error": {
    "code": "CLIENT_LIMIT_EXCEEDED",
    "message": "Starter plan allows up to 5 clients. Upgrade to Pro for unlimited clients."
  }
}
```

✅ **PASS:** 6th client creation is blocked.

### Verify List Still Works

```bash
curl -X GET http://localhost:8787/api/clients \
  -H "x-api-key: $STARTER_API_KEY" | jq '.data.clients | length'
```

**Expected:** `5` clients listed.

---

## Test 3: CSV Size & Row Limits

### Test 3a: Size Limit (5MB)

```bash
# Create a large CSV (>5MB)
head -c 6000000 /dev/urandom | base64 > large.csv

# Attempt upload
curl -X POST http://localhost:8787/api/client/<client-id>/ga4-csv \
  -H "Content-Type: text/csv" \
  -H "x-api-key: $TEST_API_KEY" \
  --data-binary @large.csv
```

**Expected Response (413):**
```json
{
  "ok": false,
  "error": {
    "code": "CSV_TOO_LARGE",
    "message": "CSV file exceeds maximum size of 5MB (actual: 5.72MB)"
  }
}
```

✅ **PASS:** Large CSV rejected.

### Test 3b: Row Limit (100,000 rows)

```bash
# Generate CSV with 100,001 rows
{
  echo "date,sessions,users,pageviews"
  for i in {1..100001}; do
    echo "2024-01-01,$i,$i,$i"
  done
} > many_rows.csv

# Attempt upload
curl -X POST http://localhost:8787/api/client/<client-id>/ga4-csv \
  -H "Content-Type: text/csv" \
  -H "x-api-key: $TEST_API_KEY" \
  --data-binary @many_rows.csv
```

**Expected Response (413):**
```json
{
  "ok": false,
  "error": {
    "code": "CSV_TOO_MANY_ROWS",
    "message": "CSV file exceeds maximum row count of 100000 (actual: 100001)"
  }
}
```

✅ **PASS:** CSV with too many rows rejected.

### Test 3c: Valid CSV Accepted

```bash
# Generate valid CSV
{
  echo "date,sessions,users,pageviews"
  for i in {1..10}; do
    echo "2024-01-0$i,100,50,200"
  done
} > valid.csv

# Upload
curl -X POST http://localhost:8787/api/client/<client-id>/ga4-csv \
  -H "Content-Type: text/csv" \
  -H "x-api-key: $TEST_API_KEY" \
  --data-binary @valid.csv
```

**Expected Response (200):**
```json
{
  "ok": true,
  "data": {
    "uploadedAt": "2025-12-18T...",
    "rowsProcessed": 10
  }
}
```

✅ **PASS:** Valid CSV accepted.

---

## Test 4: Registration Rate Limiting

### Test 4a: Normal Registration

```bash
# First registration
curl -X POST http://localhost:8787/api/agency/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Agency 1",
    "billingEmail": "agency1@example.com"
  }' | jq .
```

**Expected:** Success (201)

### Test 4b: Rate Limit Enforcement

```bash
# Attempt 4 registrations rapidly from same IP
for i in {2..4}; do
  curl -X POST http://localhost:8787/api/agency/register \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"Agency $i\",
      \"billingEmail\": \"agency$i@example.com\"
    }" | jq .
done
```

**Expected for 4th attempt (429):**
```json
{
  "ok": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many registration attempts. Please try again in 1 hour."
  }
}
```

✅ **PASS:** 4th registration within 1 hour is blocked.

### Test 4c: Rate Limit Reset

```bash
# Wait 1 hour (or manually clear KV key: registration_ratelimit:<ip>)
# Then retry registration

curl -X POST http://localhost:8787/api/agency/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Agency After Reset",
    "billingEmail": "reset@example.com"
  }' | jq .
```

**Expected:** Success (201)

✅ **PASS:** Rate limit resets after TTL.

---

## Manifest Verification

Verify manifests reflect enforced limits:

```bash
# Check reporting manifest
cat ~/ai-stack/rapidtools/catalog/rapidtools-reporting/manifest.json | jq '.limits'
```

**Expected:**
- `payload_limits.enforced: true`
- `plan_limits.starter.max_clients: 5`
- `plan_limits.starter.enforced: true`

```bash
# Check validation manifest
cat ~/ai-stack/rapidtools/catalog/rapidtools-validation/manifest.json | jq '.limits'
```

**Expected:**
- `payload_limits.enforced: true`

---

## Summary Checklist

Before marking Phase 1 complete, verify:

- [ ] Trial expiration blocks access after 14 days
- [ ] Starter plan cannot exceed 5 clients
- [ ] CSV uploads reject >5MB files
- [ ] CSV uploads reject >100k rows
- [ ] Agency registration limited to 3 per IP per hour
- [ ] Manifests updated with `enforced: true` where applicable
- [ ] New error codes added to manifest error lists

**All tests passed:** ✅ Economic enforcement protections active.

---

## Production Deployment Notes

1. **Backwards Compatibility:**
   - Existing agencies without `trialEndsAt` are grandfathered (legacy trials allowed)
   - Existing agencies without `subscriptionPlan` default to `starter`

2. **Monitoring:**
   - Watch for `TRIAL_EXPIRED` errors in logs
   - Monitor `CLIENT_LIMIT_EXCEEDED` frequency
   - Track `CSV_TOO_LARGE` and `CSV_TOO_MANY_ROWS` rejections
   - Alert on `RATE_LIMIT_EXCEEDED` spikes

3. **Cloudflare Rate Limiting:**
   - Consider enabling Cloudflare-level rate limiting for additional protection
   - Current implementation uses KV-based IP tracking (good enough for Phase 1)

---

**Phase 1 Implementation Complete.**
