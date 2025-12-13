# Cron Safety Verification Checklist

**Purpose:** Verify scheduled report automation has correct safety gates before production use.

**Operating Principles Enforced:**
- Automation must be explicitly enabled (kill-switch)
- Dev mode scheduled runs must be dry-run only (no emails, no PDFs)
- Failures must be visible (structured logs)

---

## Prerequisites

```bash
cd ~/ai-stack/rapidtools/products/reporting-tool/backend
npm run dev
```

---

## Test 1: Kill-Switch (AUTOMATION_ENABLED not set)

**Expected:** Cron runs but does nothing (disabled by default).

```bash
# Ensure kill-switch is NOT set in .dev.vars
# (Comment out AUTOMATION_ENABLED or leave it unset)

# Trigger cron
curl "http://localhost:8787/__scheduled?cron=0+9+*+*+1"
```

**Expected console output:**
```json
{
  "level": "warn",
  "message": "Scheduled report run DISABLED by kill-switch",
  "runId": "run-...",
  "automationEnabled": false,
  "note": "Set AUTOMATION_ENABLED=true to enable automation"
}
```

**Expected summary:**
```
Agencies processed: 0
Clients processed: 0
Reports sent: 0
```

✅ **PASS:** Automation disabled by default.

---

## Test 2: Dev Mode Dry-Run (AUTOMATION_ENABLED=true, REPORTING_ENV=dev)

**Expected:** Cron runs, iterates agencies/clients, but NO emails sent, NO PDFs written.

```bash
# Edit .dev.vars:
# REPORTING_ENV=dev
# AUTOMATION_ENABLED=true

# Restart dev server
npm run dev

# Trigger cron
curl "http://localhost:8787/__scheduled?cron=0+9+*+*+1"
```

**Expected console output (warning at start):**
```json
{
  "level": "warn",
  "message": "Scheduled report run in DRY-RUN mode (dev environment)",
  "runId": "run-...",
  "dryRun": true,
  "note": "No emails will be sent, no PDFs will be written. Logs only."
}
```

**Expected per-report log:**
```json
{
  "level": "info",
  "message": "DRY RUN - Report would be sent",
  "runId": "run-...",
  "agencyId": "abc-123",
  "agencyName": "Test Agency",
  "clientId": "client-456",
  "clientName": "Test Client",
  "dryRun": true
}
```

**Verify:**
- ✅ Logs show "DRY RUN" messages
- ✅ No email API calls made (check logs for "EMAIL (DEV MODE)" if present)
- ✅ No R2 writes (no PDF generation logs)
- ✅ Summary shows counts (as if reports were sent, but dryRun=true)

✅ **PASS:** Dev mode is dry-run only.

---

## Test 3: Structured Logs Include Required Fields

**Review logs from Test 2.** Every log must include:

**Kill-switch disabled:**
- ✅ `runId`
- ✅ `automationEnabled: false`

**Dry-run mode warning:**
- ✅ `runId`
- ✅ `dryRun: true`

**Run started:**
- ✅ `runId`
- ✅ `environment`
- ✅ `dryRun`
- ✅ `automationEnabled`

**Agency found:**
- ✅ `runId`
- ✅ `agencyId`
- ✅ `agencyName`

**Client processing:**
- ✅ `runId`
- ✅ `agencyId`
- ✅ `clientId`
- ✅ `clientName`

**Report result (dry-run):**
- ✅ `runId`
- ✅ `agencyId`
- ✅ `agencyName`
- ✅ `clientId`
- ✅ `clientName`
- ✅ `dryRun: true`
- ✅ `sentAt`

**Report result (error, if simulated):**
- ✅ `runId`
- ✅ `agencyId`
- ✅ `clientId`
- ✅ `error`
- ✅ `retries`

✅ **PASS:** All required fields present.

---

## Test 4: Production Mode Behavior (Simulation)

**Expected:** With `REPORTING_ENV=prod`, dry-run is disabled, real actions occur.

**IMPORTANT:** Do NOT test this with real production secrets locally. Instead, verify code path:

```bash
# Read src/handlers/scheduled.ts
# Line ~97: const isDryRun = env.REPORTING_ENV === 'dev';
# Line ~172-176: dryRun: isDryRun passed to sendClientReport
```

**Code verification:**
- ✅ `isDryRun` is `true` only when `REPORTING_ENV === 'dev'`
- ✅ When `REPORTING_ENV === 'prod'`, `isDryRun` is `false`
- ✅ `sendClientReport()` receives `dryRun: false` in production
- ✅ `sendClientReport()` skips dry-run logic when `dryRun === false`

✅ **PASS:** Production mode enables real sends.

---

## Test 5: Idempotency Still Works in Dry-Run

**Expected:** Second trigger in same ISO week skips reports.

```bash
# Ensure AUTOMATION_ENABLED=true and REPORTING_ENV=dev

# Trigger cron first time
curl "http://localhost:8787/__scheduled?cron=0+9+*+*+1"
# Observe: "DRY RUN - Report would be sent"

# Trigger cron second time (same week)
curl "http://localhost:8787/__scheduled?cron=0+9+*+*+1"
# Observe: "Report skipped (already sent)"
```

**Expected log (second run):**
```json
{
  "level": "info",
  "message": "Report skipped (already sent)",
  "runId": "run-...",
  "agencyId": "abc-123",
  "clientId": "client-456",
  "reason": "Already sent for week 2025-W50"
}
```

✅ **PASS:** Idempotency works in dry-run mode.

---

## Summary Checklist

Before enabling automation in production, verify:

- [ ] Test 1: Kill-switch disables automation by default
- [ ] Test 2: Dev mode runs dry-run only (no emails, no PDFs)
- [ ] Test 3: Structured logs include all required fields
- [ ] Test 4: Code review confirms production mode enables real sends
- [ ] Test 5: Idempotency works in dry-run mode

**All tests passed:** ✅ Safe to enable in production

**Any test failed:** ❌ Do NOT enable automation until fixed

---

## Exact Commands (Quick Reference)

```bash
# Test 1: Kill-switch
curl "http://localhost:8787/__scheduled?cron=0+9+*+*+1"
# Expect: "DISABLED by kill-switch"

# Test 2: Dry-run mode (edit .dev.vars first: AUTOMATION_ENABLED=true)
npm run dev
curl "http://localhost:8787/__scheduled?cron=0+9+*+*+1"
# Expect: "DRY-RUN mode" warning, no emails/PDFs

# Test 5: Idempotency (run Test 2 command twice)
curl "http://localhost:8787/__scheduled?cron=0+9+*+*+1"
curl "http://localhost:8787/__scheduled?cron=0+9+*+*+1"
# Second run: "Report skipped (already sent)"
```

---

**Verification complete:** Cron automation has correct safety gates.
