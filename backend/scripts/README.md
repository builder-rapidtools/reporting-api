# Backend Scripts

## fix-and-verify-agency-key.sh

**Purpose**: Rotate an exposed API key automatically.

**Usage**:

```bash
cd ~/ai-stack/rapidtools/products/reporting-tool/backend
./scripts/fix-and-verify-agency-key.sh
```

**What it does**:
1. Prompts for current API key (hidden input)
2. Looks up agency in production KV
3. Generates new UUID v4 key
4. Updates production KV (with --remote --preview=false)
5. Deletes old key
6. Verifies old key fails
7. Verifies new key works on /api/clients
8. Prints only: ✅ SUCCESS and new key

**Example**:

```bash
$ ./scripts/fix-and-verify-agency-key.sh
Enter current API key: [hidden]
✅ SUCCESS

New API key: f2b4d8e1-9c7a-4f3d-b5e6-1a2c3d4e5f67
```

No secrets are printed during execution.

---

## recover-agency-api-key.sh

**Purpose**: Regenerate API key for agency `0700c1a2-c15d-4d36-baaf-5a94e84b5c15` when access is lost.

**Usage**:

```bash
cd ~/ai-stack/rapidtools/products/reporting-tool/backend
./scripts/recover-agency-api-key.sh
```

**What it does**:
1. Fetches agency record from production KV
2. Generates new UUID v4 API key
3. Updates agency record with new key
4. Creates new lookup entry `agency_api_key:{newKey}` → `agencyId`
5. Deletes old lookup entry
6. Verifies new key works on `/api/clients` (HTTP 200)
7. Prints only: ✅ SUCCESS and new key

**Example**:

```bash
$ ./scripts/recover-agency-api-key.sh
✅ SUCCESS
New Agency API key: f2b4d8e1-9c7a-4f3d-b5e6-1a2c3d4e5f67
```

**Idempotent**: Safe to run multiple times. Each run generates a fresh key and cleans up the previous one.

---

## test-admin-rotate-key.sh

**Purpose**: Test the admin API key rotation endpoint.

**Usage**:

```bash
cd ~/ai-stack/rapidtools/products/reporting-tool/backend
./scripts/test-admin-rotate-key.sh
```

**What it tests**:
1. Missing admin secret (expect 403)
2. Invalid admin secret (expect 403)
3. Invalid agency ID (expect 404)
4. Valid rotation (expect 200 with new key)
5. New key works correctly (expect 200 on `/api/clients`)

**Example**:

```bash
$ ./scripts/test-admin-rotate-key.sh
🧪 Testing Admin API Key Rotation Endpoint
==========================================

Enter ADMIN_SECRET: [hidden]

Test 1: Missing admin secret (expect 403)...
✓ PASS: Correctly rejected request without admin secret

Test 2: Invalid admin secret (expect 403)...
✓ PASS: Correctly rejected request with invalid admin secret

Test 3: Invalid agency ID (expect 404)...
✓ PASS: Correctly returned 404 for non-existent agency

Test 4: Valid rotation (expect 200)...
✓ PASS: Rotation succeeded
✓ New API key generated: f2b4d8e1...4e5f67

Test 5: Verify new key works (expect 200)...
✓ PASS: New API key works correctly

==========================================
✅ All tests passed!
```

**Prerequisites**: Requires valid `ADMIN_SECRET` configured in production.
