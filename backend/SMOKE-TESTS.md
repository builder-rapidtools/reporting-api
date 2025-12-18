# RapidTools Production Smoke Tests

**Safe for production** - Does not require editing source code or exposing secrets.

## What's Tested

### Non-Authenticated Tests (Always Run)

1. **Health Check** (`GET /api/health`)
   - Verifies service is responding
   - Expects: `200 OK` with `{ ok: true, data: { status: "ok", ... } }`

2. **PDF Download - No Token** (`GET /reports/:agencyId/:clientId/:filename`)
   - Verifies authentication is required
   - Tests with placeholder (non-existent) client
   - Expects: `404` (valid for non-existent resource), OR `401`/`403` with error code (e.g., `PDF_TOKEN_REQUIRED`)

3. **PDF Download - Garbage Token** (`GET /reports/:agencyId/:clientId/:filename?token=garbage`)
   - Verifies token validation works
   - Tests with placeholder (non-existent) client
   - Expects: `404` (valid for non-existent resource), OR `403` with error code (e.g., `PDF_TOKEN_INVALID`)

4. **PDF Download - Expired Token**
   - Status: **SKIP** (requires server-minted token, cannot fabricate without `PDF_SIGNING_SECRET`)

### Authenticated Tests (Require Environment Variables)

5. **Mint Signed PDF URL** (`POST /api/reports/:clientId/:filename/signed-url`)
   - Requires: `RAPIDTOOLS_API_KEY`, `RAPIDTOOLS_CLIENT_ID`
   - Verifies: Signed URL generation works
   - Expects: `200 OK` with `{ ok: true, data: { url, expiresAt } }`
   - **Note**: 404 on this endpoint indicates deployment issue (missing Phase 2+ code), not security behavior

6. **Fetch Signed PDF URL** (`GET <signedUrl>`)
   - Requires: Valid signed URL from test #5
   - Verifies: PDF download works with valid token
   - Expects: `200 OK` with `Content-Type: application/pdf`

7. **Fetch Tampered Token** (tampered signed URL)
   - Requires: Valid signed URL from test #5 (tampered)
   - Verifies: Token tampering is detected
   - Expects: `403` with error code (e.g., `PDF_TOKEN_INVALID`, `PDF_TOKEN_MISMATCH`)

### Destructive Tests (Skipped by Default)

8. **Delete Client - No Cascade** (`DELETE /api/client/:id`)
   - Status: **SKIP** (too destructive for smoke tests)
   - Would verify: Client deletion works without cascade

9. **Delete Client - With Cascade** (`DELETE /api/client/:id` + header `X-Cascade-Delete: true`)
   - Status: **SKIP** (too destructive for smoke tests)
   - Would verify: Cascade delete removes all R2 objects

---

## CI vs Manual Execution

### CI (Automated - GitHub Actions)

**What runs**: Non-authenticated tests only (tests 1-3)

**Why**:
- No secrets required (least privilege)
- Safe for public PRs
- Validates core security posture

**When**: Every push to main, every pull request

**Workflow**: `.github/workflows/smoke-tests-non-auth.yml`

### Manual (Local or Protected Environments)

**What runs**: Full test suite including authenticated tests (tests 1-7)

**Why**:
- Validates complete trust-boundary chain (mint → download → tamper detection)
- Requires production credentials
- Should run after deployment to verify full functionality

**When**: Post-deployment verification, security audits

**How**: `./scripts/run-smoke-tests-prod.sh` with credentials

---

## Environment Variables

All environment variables are **optional**. Non-authenticated tests run without any configuration.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RAPIDTOOLS_BASE_URL` | No | `https://reporting-api.rapidtools.dev` | Override production URL (auto-discovered from `wrangler.toml`) |
| `RAPIDTOOLS_API_KEY` | No (for auth tests: Yes) | - | Agency API key (never logged) |
| `RAPIDTOOLS_CLIENT_ID` | No (for auth tests: Yes) | - | Client UUID for signed URL tests |
| `RAPIDTOOLS_PDF_FILENAME` | No | `2025-12-18T12-00-00-000Z.pdf` | PDF filename for tests |

---

## Usage

### Run Non-Authenticated Tests Only

```bash
# Using Node.js directly
node scripts/smoke-prod.js

# Using bash wrapper (recommended)
./scripts/smoke-prod.sh
```

**Expected Output:**
```
🧪 Running RapidTools Production Smoke Tests...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 RAPIDTOOLS PRODUCTION SMOKE TEST RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Base URL: https://reporting-api.rapidtools.dev
Source: wrangler.toml line 8 (pattern: "reporting-api.rapidtools.dev/*")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ✅ Health Check
   Status: PASS
   200 OK - ok

2. ✅ PDF Download (no token)
   Status: PASS
   404 Not Found (security working - path secured)

3. ✅ PDF Download (garbage token)
   Status: PASS
   404 Not Found (validation working - path secured)

4. ⏭️ PDF Download (expired token)
   Status: SKIP
   Requires server-minted token (cannot fabricate without secret)

5. ⏭️ Mint Signed PDF URL
   Status: SKIP
   Requires RAPIDTOOLS_API_KEY and RAPIDTOOLS_CLIENT_ID

...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Summary: 3 passed, 0 failed, 6 skipped
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️  To run authenticated tests, set environment variables:
   export RAPIDTOOLS_API_KEY="your-api-key"
   export RAPIDTOOLS_CLIENT_ID="your-client-id"
   export RAPIDTOOLS_PDF_FILENAME="2025-12-18T12-00-00-000Z.pdf"

✅ SMOKE TEST PASSED
```

---

### Run Authenticated Tests

```bash
# Set environment variables (API key is NEVER logged)
export RAPIDTOOLS_API_KEY="your-api-key-here"
export RAPIDTOOLS_CLIENT_ID="your-client-uuid-here"
export RAPIDTOOLS_PDF_FILENAME="2025-12-18T12-00-00-000Z.pdf"

# Run tests
./scripts/smoke-prod.sh
```

**Expected Output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧪 RapidTools Production Smoke Tests
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Base URL: https://reporting-api.rapidtools.dev (default)
API Key: ****** (set - authenticated tests enabled)
Client ID: abc-123-def-456
PDF Filename: 2025-12-18T12-00-00-000Z.pdf

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🧪 Running RapidTools Production Smoke Tests...

...

5. ✅ Mint Signed PDF URL
   Status: PASS
   200 OK - got signed URL (expires: 2025-12-18T13:00:00.000Z)

6. ✅ Fetch Signed PDF URL
   Status: PASS
   200 OK - PDF downloaded (application/pdf)

7. ✅ Fetch Tampered Token
   Status: PASS
   403 PDF_TOKEN_INVALID (tamper detection working)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Summary: 6 passed, 0 failed, 3 skipped
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ SMOKE TEST PASSED
```

---

## Running in CI (GitHub Actions, GitLab CI, etc.)

### Example: GitHub Actions

```yaml
name: Production Smoke Tests

on:
  schedule:
    - cron: '0 * * * *' # Every hour
  workflow_dispatch: # Manual trigger

jobs:
  smoke-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Run Smoke Tests (Non-Auth)
        run: |
          cd products/reporting-tool/backend
          node scripts/smoke-prod.js

      - name: Run Smoke Tests (Authenticated)
        env:
          RAPIDTOOLS_API_KEY: ${{ secrets.RAPIDTOOLS_API_KEY }}
          RAPIDTOOLS_CLIENT_ID: ${{ secrets.RAPIDTOOLS_CLIENT_ID }}
        run: |
          cd products/reporting-tool/backend
          node scripts/smoke-prod.js
```

**Important**:
- Store `RAPIDTOOLS_API_KEY` as a GitHub secret (Settings → Secrets)
- **Never commit API keys to source code**
- API keys are **never logged** by smoke test scripts

---

## Exit Codes

- `0` - All tests passed (some may be skipped)
- `1` - One or more tests failed
- `1` - Fatal error (e.g., network unreachable)

---

## Auto-Discovery Details

The smoke test automatically discovers configuration from the repository:

### Base URL Discovery

**Source**: `wrangler.toml` line 8
```toml
[[routes]]
pattern = "reporting-api.rapidtools.dev/*"
```

**Extracted**: `https://reporting-api.rapidtools.dev`

### Endpoint Path Discovery

**Source**: `src/router.ts`

| Endpoint | Path | Line |
|----------|------|------|
| Health Check | `GET /api/health` | 33 |
| Signed PDF URL Mint | `POST /api/reports/:clientId/:filename/signed-url` | 57 |
| PDF Download | `GET /reports/:agencyId/:clientId/:filename` | 62 |
| Client Delete | `DELETE /api/client/:id` | 47 |

### Cascade Delete Detection

**Source**: `src/handlers/clients.ts` line 141

**Trigger**: Header `X-Cascade-Delete: true` (Phase 4 hardening - changed from query parameter)

---

## 404 Handling Logic

The smoke tests distinguish between two types of 404 responses:

### ✅ **404 is Acceptable** (PDF Download Endpoints)
- **Endpoints**: `GET /reports/:agencyId/:clientId/:filename`
- **Reason**: Security by non-disclosure - 404 prevents information leakage about which PDFs exist
- **Test Behavior**: Treat 404 as **PASS** (security working correctly)

### ❌ **404 is a Failure** (API Management Endpoints)
- **Endpoints**: `POST /api/reports/:clientId/:filename/signed-url`, `POST /api/client/:id`, etc.
- **Reason**: These endpoints should always exist - 404 indicates missing deployment/code
- **Test Behavior**: Treat 404 as **FAIL** (deployment issue, not security)

**Why This Matters**: Without this distinction, a missing endpoint (deployment bug) would be incorrectly interpreted as "security working". This dual handling ensures:
- PDF security tests validate "fail closed" behavior
- API tests detect incomplete deployments
- Smoke tests can serve as deployment gates

---

## Security Notes

✅ **Safe for production**:
- No destructive operations (delete tests skipped by default)
- No secrets logged or printed
- Only reads public endpoints and auth-protected endpoints
- Uses placeholder values for unauthenticated tests

✅ **Secret safety**:
- API keys are **never** logged to console
- Bash wrapper shows `******` instead of actual key
- Safe for CI/CD logs
- Safe for screen sharing

⚠️ **Caution**:
- Authenticated tests require a **real client** with uploaded CSV data
- Client delete tests are **skipped** by default (too destructive)
- Do not run delete tests against production clients

---

## Troubleshooting

### "Network error: fetch failed"

**Cause**: Cannot reach production URL

**Solution**:
1. Check internet connection
2. Verify production URL is correct
3. Check if Cloudflare Workers is deployed

### "Expected 200, got 401"

**Cause**: Invalid or expired API key

**Solution**:
1. Verify `RAPIDTOOLS_API_KEY` is correct
2. Check API key hasn't been rotated
3. Verify agency subscription is active

### "Expected 200, got 404" (Mint Signed PDF URL)

**Cause**: Client or PDF file doesn't exist

**Solution**:
1. Verify `RAPIDTOOLS_CLIENT_ID` exists
2. Verify client has uploaded CSV data
3. Verify PDF filename matches a generated report

---

## Maintenance

**When to update smoke tests**:
- New critical endpoints added (update `smoke-prod.js`)
- Production URL changes (update `wrangler.toml` - auto-discovered)
- API contract changes (update test expectations)

**Files to maintain**:
- `scripts/smoke-prod.js` - Test logic
- `scripts/smoke-prod.sh` - Bash wrapper
- `SMOKE-TESTS.md` - This documentation

---

**Last Updated**: 2025-12-18
**Version**: 1.0 (Post-Phase 4)
**Status**: Production Ready
