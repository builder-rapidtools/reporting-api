# HOSTILE AUDIT PHASE 3 - FINDINGS (Truth Alignment)
**Date**: 2025-12-18
**Status**: Investigation Complete

---

## CONTRADICTIONS FOUND

### 1. Rate Limiting Enforcement (CRITICAL)

**Manifest** (`manifest.json` line 130):
```json
"enforced": false
```

**README** (`README.md` line 183):
```
- **Enforcement**: Enabled
```

**Implementation Reality** (`src/handlers/agency.ts` line 18):
```typescript
const RATE_LIMIT_MAX = 3; // Max registrations per window
```

**Truth**:
- **General API rate limiting**: NOT ENFORCED (60/min, burst 10 is documented but not implemented)
- **Registration endpoint only**: ENFORCED (3 per IP per hour)
- Manifest is CORRECT with clarification in notes
- README is WRONG

---

### 2. CSV Size Limit (CRITICAL)

**Manifest** (`manifest.json` line 134):
```json
"max_bytes": 5242880  // 5MB
```

**README** (`README.md` line 188):
```
- **Max CSV size**: 10,485,760 bytes (10MB)
```

**Implementation Reality** (`src/handlers/uploads.ts` line 48):
```typescript
const MAX_CSV_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
```

**Truth**:
- Actual limit is 5MB (5,242,880 bytes)
- Manifest is CORRECT
- README is WRONG (claims 10MB)

---

### 3. Stability Status (MEDIUM)

**Manifest** (`manifest.json` line 207):
```json
"level": "stable"
```

**README** (`README.md` line 34):
```
- **Stability**: Beta level with 30-day advance notice for breaking changes
```

**Truth**:
- Service is in limited testing with real customers
- "stable" is aspirational, "Beta" is honest
- Manifest should be "limited_testing" (which it already has on line 10 as `"status": "limited_testing"` but contradicts itself on line 207)
- Internal contradiction in manifest itself

---

### 4. Capability Count (MINOR)

**README** (`README.md` line 47):
```
The service exposes 6 operations (see manifest for full details):
```

**Manifest** (`manifest.json` line 18-110):
Lists 8 capabilities (includes Phase 2 PDF endpoints)

**Truth**:
- 8 capabilities exist after Phase 2
- README is outdated

---

### 5. "No Orphaned Data" Principle Violation (CRITICAL)

**OPERATING-PRINCIPLES.md** (line 48):
```
**No orphaned data** - When a client is deleted, their reports and CSV files must be deleted or archived.
```

**Implementation Reality** (`src/storage.ts` line 165-166):
```typescript
// Note: Reports are kept for historical reference
// Future enhancement: cascade delete or archive
```

**Truth**:
- Principle states "No orphaned data" as NON-NEGOTIABLE
- Implementation violates this (leaves CSV and PDF files orphaned)
- This is aspirational in OPERATING-PRINCIPLES, not enforced

---

### 6. Idempotency Ambiguity (MEDIUM)

**Manifest** (`manifest.json` line 152):
```json
"supported": "optional"
```

**Manifest** (`manifest.json` line 64-65):
```json
"idempotent": true,
"idempotency_support": "optional_via_header"
```

**Issue**:
- `send_report` capability says `idempotent: true` (misleading - it's conditionally idempotent)
- Should be `idempotent: false` with note "Becomes idempotent when Idempotency-Key header provided"

---

## AMBIGUOUS CAPABILITY CLAIMS

### 1. Conditional Idempotency (send_report)

**Current** (`manifest.json` line 59-69):
```json
{
  "id": "send_report",
  "idempotent": true,
  "idempotency_support": "optional_via_header",
  "idempotency_header": "idempotency-key",
  "notes": "Idempotent when Idempotency-Key header is provided..."
}
```

**Problem**:
- Machine agent sees `"idempotent": true` and assumes safe to retry
- But without header, duplicate emails are sent
- Misleading

**Fix**:
```json
{
  "id": "send_report",
  "idempotent": false,
  "idempotency": {
    "supported": true,
    "requires_header": "Idempotency-Key",
    "scope": "per_agency_per_client",
    "ttl_seconds": 86400
  },
  "notes": "Not idempotent by default. Becomes idempotent when Idempotency-Key header is provided. Without header, duplicate requests send duplicate emails."
}
```

---

### 2. Rate Limit Scope Ambiguity

**Current** (`manifest.json` line 127-132):
```json
"rate_limits": {
  "requests_per_minute": 60,
  "burst": 10,
  "enforced": false,
  "notes": "Rate limiting not enforced at API level. Registration endpoint has IP-based rate limit (3 per hour)."
}
```

**Problem**:
- Says `enforced: false` but then mentions a specific endpoint IS enforced
- Ambiguous what "enforced: false" means

**Fix**:
```json
"rate_limits": {
  "global": {
    "requests_per_minute": 60,
    "burst": 10,
    "enforced": false,
    "notes": "General API rate limiting not implemented"
  },
  "endpoint_specific": {
    "agency_registration": {
      "limit": 3,
      "window_seconds": 3600,
      "scope": "per_ip",
      "enforced": true,
      "error_code": "RATE_LIMIT_EXCEEDED"
    }
  }
}
```

---

## ASPIRATIONAL LANGUAGE IN DOCS

### 1. OPERATING-PRINCIPLES.md

**Line 48 - "No orphaned data"**:
- Stated as NON-NEGOTIABLE
- Not implemented
- Must be moved to "Goals" or marked as "Known Deviation"

**Recommendation**:
Add section to OPERATING-PRINCIPLES.md:
```markdown
## Known Deviations

The following principles are not yet enforced but are roadmap priorities:

- **No orphaned data**: Client deletion currently orphans CSV files and PDFs in R2. Cascade deletion scheduled for Phase 4. (Risk: low - storage costs minimal, data not exposed)
```

---

### 2. README.md

**Multiple instances**:
- Line 31: "enforced: true" for rate limits (FALSE)
- Line 34: "Beta level" contradicts manifest "stable"
- Line 188: "10MB" contradicts implementation "5MB"

All need correction.

---

## MANIFEST INTERNAL CONTRADICTIONS

**Contradiction** (`manifest.json`):
- Line 10: `"status": "limited_testing"`
- Line 207: `"level": "stable"`

These contradict each other. Truth: service is in limited testing, not stable.

---

## SUMMARY OF REQUIRED CHANGES

### Manifest Updates:
1. Change `stability.level` from "stable" to "limited_testing"
2. Restructure `rate_limits` to distinguish global vs endpoint-specific
3. Change `send_report.idempotent` from `true` to structured object
4. Keep all other values (already correct)

### README Updates:
1. Change rate limit enforcement from "Enabled" to "Partial (registration only)"
2. Change CSV size from "10MB" to "5MB"
3. Change stability from "Beta" to "Limited Testing"
4. Update capability count from "6" to "8"
5. Add clarification about conditional idempotency

### OPERATING-PRINCIPLES Updates:
1. Add "Known Deviations" section
2. Document "No orphaned data" as unimplemented (with mitigation plan)

---

**Next Steps**: Apply corrections to all documents

---

**Document Version**: 1.0
**Date**: 2025-12-18
**Auditor**: Claude Code (Hostile Audit Mode)
