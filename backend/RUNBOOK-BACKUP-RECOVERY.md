# RUNBOOK: Backup & Recovery
**RapidTools Reporting API - Operational Procedures**

**Last Updated**: 2025-12-18
**Status**: Authoritative
**Phase**: Hostile Audit Phase 4 - Governance & Resilience

---

## PURPOSE

This runbook defines procedures for:
1. Exporting KV data (agencies, clients, reports)
2. Exporting R2 data (CSVs, PDFs)
3. Recovering from data loss
4. Admin secret rotation

**Target Audience**: Operations team, future maintainers

**Assumption**: You have `wrangler` CLI installed and authenticated with appropriate Cloudflare credentials.

---

## BACKUP PROCEDURES

### 1. Export KV Data (Agencies & Clients)

**Objective**: Export all agency and client records from Cloudflare KV to local JSON files.

**Frequency**: Weekly (automated) or on-demand before major migrations

**Prerequisites**:
- `wrangler` CLI authenticated
- KV namespace ID: Check `wrangler.toml` for `REPORTING_KV` binding

**Commands**:

```bash
# Set KV namespace ID (find in wrangler.toml or Cloudflare dashboard)
export KV_NAMESPACE_ID="your-kv-namespace-id"

# Create backup directory
mkdir -p backups/kv/$(date +%Y-%m-%d)
cd backups/kv/$(date +%Y-%m-%d)

# List all keys (paginated)
wrangler kv:key list --namespace-id=$KV_NAMESPACE_ID > all-keys.json

# Extract agency keys
cat all-keys.json | jq -r '.[] | select(.name | startswith("agency:")) | .name' > agency-keys.txt

# Extract client keys
cat all-keys.json | jq -r '.[] | select(.name | startswith("client:")) | .name' > client-keys.txt

# Extract report keys
cat all-keys.json | jq -r '.[] | select(.name | startswith("report:")) | .name' > report-keys.txt

# Extract admin audit keys
cat all-keys.json | jq -r '.[] | select(.name | startswith("admin_audit:")) | .name' > audit-keys.txt

# Export all agency data
while IFS= read -r key; do
  wrangler kv:key get --namespace-id=$KV_NAMESPACE_ID "$key" > "$(echo $key | sed 's/:/_/g').json"
done < agency-keys.txt

# Export all client data
while IFS= read -r key; do
  wrangler kv:key get --namespace-id=$KV_NAMESPACE_ID "$key" > "$(echo $key | sed 's/:/_/g').json"
done < client-keys.txt

# Export all report metadata
while IFS= read -r key; do
  wrangler kv:key get --namespace-id=$KV_NAMESPACE_ID "$key" > "$(echo $key | sed 's/:/_/g').json"
done < report-keys.txt

# Create manifest
echo "{\"exported_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"agency_count\": $(wc -l < agency-keys.txt), \"client_count\": $(wc -l < client-keys.txt), \"report_count\": $(wc -l < report-keys.txt)}" > manifest.json

echo "KV export complete. Files saved to $(pwd)"
```

**Output Structure**:
```
backups/kv/2025-12-18/
├── all-keys.json
├── agency-keys.txt
├── client-keys.txt
├── report-keys.txt
├── audit-keys.txt
├── agency_{agencyId}.json
├── agency_{agencyId}_clients.json
├── client_{clientId}.json
├── client_{clientId}_integration.json
├── client_{clientId}_reports.json
├── report_{reportId}.json
└── manifest.json
```

---

### 2. Export R2 Data (CSVs and PDFs)

**Objective**: Download all CSV and PDF files from R2 bucket to local storage.

**Frequency**: Weekly (automated) or on-demand before major migrations

**Prerequisites**:
- `wrangler` CLI authenticated
- R2 bucket name: Check `wrangler.toml` for `REPORTING_R2` binding

**Commands**:

```bash
# Set R2 bucket name (find in wrangler.toml)
export R2_BUCKET_NAME="your-r2-bucket-name"

# Create backup directory
mkdir -p backups/r2/$(date +%Y-%m-%d)
cd backups/r2/$(date +%Y-%m-%d)

# List all objects in R2 bucket
wrangler r2 object list "$R2_BUCKET_NAME" --limit 1000 > objects.json

# Extract CSV file paths
cat objects.json | jq -r '.[] | select(.key | startswith("ga4-csv/")) | .key' > csv-files.txt

# Extract PDF file paths
cat objects.json | jq -r '.[] | select(.key | startswith("reports/")) | .key' > pdf-files.txt

# Download all CSV files
echo "Downloading CSV files..."
mkdir -p ga4-csv
while IFS= read -r key; do
  # Create directory structure
  mkdir -p "$(dirname "$key")"
  wrangler r2 object get "$R2_BUCKET_NAME/$key" --file="$key"
done < csv-files.txt

# Download all PDF files
echo "Downloading PDF files..."
mkdir -p reports
while IFS= read -r key; do
  # Create directory structure
  mkdir -p "$(dirname "$key")"
  wrangler r2 object get "$R2_BUCKET_NAME/$key" --file="$key"
done < pdf-files.txt

# Create manifest
echo "{\"exported_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"csv_count\": $(wc -l < csv-files.txt), \"pdf_count\": $(wc -l < pdf-files.txt), \"total_size_bytes\": $(du -sb . | cut -f1)}" > manifest.json

echo "R2 export complete. Files saved to $(pwd)"
```

**Output Structure**:
```
backups/r2/2025-12-18/
├── objects.json
├── csv-files.txt
├── pdf-files.txt
├── ga4-csv/
│   └── {agencyId}/
│       └── {clientId}/
│           └── {timestamp}.csv
├── reports/
│   └── {agencyId}/
│       └── {clientId}/
│           └── {reportId}.pdf
└── manifest.json
```

---

### 3. Encrypt and Store Backups

**Objective**: Securely store backups off-Cloudflare.

**Frequency**: After each backup

**Prerequisites**:
- GPG key for encryption (or use `age` tool)
- S3-compatible storage or secure file server

**Commands**:

```bash
# Navigate to backup root
cd backups

# Compress backup directory
tar -czf backup-$(date +%Y-%m-%d).tar.gz kv/$(date +%Y-%m-%d) r2/$(date +%Y-%m-%d)

# Encrypt with GPG (replace with your key ID)
gpg --encrypt --recipient your-gpg-key-id backup-$(date +%Y-%m-%d).tar.gz

# Upload to S3 (or equivalent)
aws s3 cp backup-$(date +%Y-%m-%d).tar.gz.gpg s3://your-backup-bucket/rapidtools-reporting/

# Verify upload
aws s3 ls s3://your-backup-bucket/rapidtools-reporting/backup-$(date +%Y-%m-%d).tar.gz.gpg

# Clean up local unencrypted backup (keep encrypted copy)
rm backup-$(date +%Y-%m-%d).tar.gz

echo "Backup encrypted and uploaded to S3"
```

**Alternative: Use `age` for encryption**:

```bash
# Install age: https://github.com/FiloSottile/age
# Generate key: age-keygen -o backup-key.txt

# Encrypt backup
age -r $(cat backup-key.txt.pub) backup-$(date +%Y-%m-%d).tar.gz > backup-$(date +%Y-%m-%d).tar.gz.age

# Upload to S3
aws s3 cp backup-$(date +%Y-%m-%d).tar.gz.age s3://your-backup-bucket/rapidtools-reporting/
```

---

### 4. Backup Schedule Recommendation

**Recommended Schedule**:

| Data Type | Frequency | Retention | Automation |
|-----------|-----------|-----------|------------|
| KV data (agencies, clients) | Weekly | 90 days | Cron job or GitHub Action |
| R2 data (CSVs, PDFs) | Weekly | 90 days | Cron job or GitHub Action |
| Admin audit logs | Weekly | 90 days | Cron job or GitHub Action |

**Automation Example (GitHub Actions)**:

```yaml
# .github/workflows/backup.yml
name: Weekly Backup

on:
  schedule:
    - cron: '0 2 * * 0' # Every Sunday at 2 AM UTC

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install Wrangler
        run: npm install -g wrangler
      - name: Authenticate Wrangler
        run: wrangler login
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      - name: Run backup script
        run: ./scripts/backup-all.sh
      - name: Upload to S3
        run: aws s3 sync backups/ s3://your-backup-bucket/rapidtools-reporting/
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

---

## RECOVERY PROCEDURES

### 1. Restore KV Data

**Scenario**: KV namespace lost or corrupted.

**Prerequisites**:
- Backup files from export procedure
- `wrangler` CLI authenticated
- Empty or new KV namespace

**Commands**:

```bash
# Navigate to backup directory
cd backups/kv/2025-12-18  # Use appropriate date

# Set KV namespace ID
export KV_NAMESPACE_ID="your-kv-namespace-id"

# Restore all JSON files to KV
for file in *.json; do
  # Extract key name from filename (reverse the sed from export)
  key=$(basename "$file" .json | sed 's/_/:/g')

  # Skip manifest and list files
  if [[ "$key" == "manifest" ]] || [[ "$key" == "all-keys" ]]; then
    continue
  fi

  # Put key back into KV
  wrangler kv:key put --namespace-id=$KV_NAMESPACE_ID "$key" --path="$file"
  echo "Restored: $key"
done

echo "KV restore complete"
```

**Verification**:

```bash
# List keys to verify restoration
wrangler kv:key list --namespace-id=$KV_NAMESPACE_ID

# Verify specific agency
wrangler kv:key get --namespace-id=$KV_NAMESPACE_ID "agency:{agencyId}"
```

---

### 2. Restore R2 Data

**Scenario**: R2 bucket lost or corrupted.

**Prerequisites**:
- Backup files from export procedure
- `wrangler` CLI authenticated
- Empty or new R2 bucket

**Commands**:

```bash
# Navigate to backup directory
cd backups/r2/2025-12-18  # Use appropriate date

# Set R2 bucket name
export R2_BUCKET_NAME="your-r2-bucket-name"

# Restore all CSV files
while IFS= read -r key; do
  if [ -f "$key" ]; then
    wrangler r2 object put "$R2_BUCKET_NAME/$key" --file="$key"
    echo "Restored: $key"
  fi
done < csv-files.txt

# Restore all PDF files
while IFS= read -r key; do
  if [ -f "$key" ]; then
    wrangler r2 object put "$R2_BUCKET_NAME/$key" --file="$key"
    echo "Restored: $key"
  fi
done < pdf-files.txt

echo "R2 restore complete"
```

**Verification**:

```bash
# List objects to verify restoration
wrangler r2 object list "$R2_BUCKET_NAME" --limit 100

# Verify specific file
wrangler r2 object get "$R2_BUCKET_NAME/ga4-csv/{agencyId}/{clientId}/{timestamp}.csv" --file=test.csv
```

---

### 3. Point-in-Time Recovery

**Scenario**: Need to restore to a specific date.

**Process**:
1. Identify backup date closest to desired recovery point
2. Follow restore procedures above using that backup
3. Verify data integrity with known records
4. Document recovery in admin audit log

**Validation**:

```bash
# Compare backup manifest with current state
wrangler kv:key list --namespace-id=$KV_NAMESPACE_ID | jq 'length'
cat backups/kv/2025-12-18/manifest.json | jq '.agency_count + .client_count + .report_count'

# Verify specific agency still exists
wrangler kv:key get --namespace-id=$KV_NAMESPACE_ID "agency:{agencyId}"
```

---

## ADMIN SECRET ROTATION

**Objective**: Rotate the `ADMIN_SECRET` environment variable without downtime.

**Frequency**: Every 90 days or on-demand after suspected compromise

**Current Limitation**: Single admin secret supported (no overlap window)

**Procedure**:

### Step 1: Generate New Secret

```bash
# Generate secure random secret (32 bytes = 256 bits)
NEW_ADMIN_SECRET=$(openssl rand -base64 32)
echo "New admin secret: $NEW_ADMIN_SECRET"

# Save to secure location (e.g., password manager)
echo "$NEW_ADMIN_SECRET" > new-admin-secret.txt
chmod 600 new-admin-secret.txt
```

### Step 2: Update Wrangler Secret

```bash
# Navigate to backend directory
cd products/reporting-tool/backend

# Set new admin secret in Cloudflare Workers
echo "$NEW_ADMIN_SECRET" | wrangler secret put ADMIN_SECRET

# Verify secret is set (will not display value)
wrangler secret list
```

### Step 3: Update Local Environment

```bash
# Update .dev.vars for local development
echo "ADMIN_SECRET=$NEW_ADMIN_SECRET" >> .dev.vars

# Update any automation scripts or CI/CD secrets
# GitHub: Settings > Secrets and variables > Actions > ADMIN_SECRET
# GitLab: Settings > CI/CD > Variables > ADMIN_SECRET
```

### Step 4: Verify Rotation

```bash
# Test admin endpoint with new secret
curl -X POST "https://reporting-api.rapidtools.dev/api/admin/agency/{agencyId}/rotate-key" \
  -H "x-admin-secret: $NEW_ADMIN_SECRET"

# Expected: 200 OK with new API key

# Test with old secret (should fail)
curl -X POST "https://reporting-api.rapidtools.dev/api/admin/agency/{agencyId}/rotate-key" \
  -H "x-admin-secret: OLD_SECRET"

# Expected: 403 Forbidden
```

### Step 5: Document Rotation

```bash
# Log rotation in admin audit (Hostile Audit Phase 4 feature)
# This is automatic - rotation will be logged to KV with:
# - admin_audit:{auditId}
# - admin_audit:agency:{agencyId}

# Manually verify audit log
wrangler kv:key list --namespace-id=$KV_NAMESPACE_ID --prefix="admin_audit:"
```

### Step 6: Secure Cleanup

```bash
# Securely delete old secret from local files
shred -u new-admin-secret.txt

# Update password manager with new secret
# Remove old secret from any documentation
```

**Recovery from Lost Admin Secret**:

If admin secret is lost and no backup exists:
1. Generate new secret: `openssl rand -base64 32`
2. Update via Cloudflare dashboard:
   - Workers & Pages > reporting-tool-api > Settings > Variables > Edit `ADMIN_SECRET`
3. Update local `.dev.vars`
4. No API downtime (only affects admin endpoints)

---

## MONITORING AND ALERTS

**Health Checks**:

```bash
# Verify API is responding
curl https://reporting-api.rapidtools.dev/api/health

# Expected: {"ok": true, "data": {"status": "ok", ...}}
```

**Backup Verification**:

```bash
# Check backup directory size
du -sh backups/kv/$(date +%Y-%m-%d)
du -sh backups/r2/$(date +%Y-%m-%d)

# Verify backup was uploaded to S3
aws s3 ls s3://your-backup-bucket/rapidtools-reporting/ --recursive | grep $(date +%Y-%m-%d)
```

**Audit Log Review**:

```bash
# List recent admin actions
wrangler kv:key list --namespace-id=$KV_NAMESPACE_ID --prefix="admin_audit:"

# Retrieve specific audit entry
wrangler kv:key get --namespace-id=$KV_NAMESPACE_ID "admin_audit:{auditId}"
```

---

## DISASTER RECOVERY PLAN

### Scenario 1: Complete Data Loss (KV + R2)

**RTO (Recovery Time Objective)**: 4 hours
**RPO (Recovery Point Objective)**: 7 days (weekly backup)

**Steps**:
1. Provision new KV namespace and R2 bucket
2. Restore KV data from most recent backup
3. Restore R2 data from most recent backup
4. Update `wrangler.toml` with new resource IDs
5. Deploy Workers with updated bindings
6. Verify health check and test agency authentication
7. Notify customers of potential data loss (last 7 days)

### Scenario 2: Partial Data Loss (Single Client)

**RTO**: 1 hour
**RPO**: 7 days (weekly backup)

**Steps**:
1. Identify client ID from support ticket
2. Extract client data from backup:
   ```bash
   cd backups/kv/2025-12-18
   cat client_{clientId}.json
   ```
3. Restore client KV entries:
   ```bash
   wrangler kv:key put --namespace-id=$KV_NAMESPACE_ID "client:{clientId}" --path="client_{clientId}.json"
   wrangler kv:key put --namespace-id=$KV_NAMESPACE_ID "client:{clientId}:integration" --path="client_{clientId}_integration.json"
   ```
4. Restore client R2 objects:
   ```bash
   cd backups/r2/2025-12-18
   wrangler r2 object put "$R2_BUCKET_NAME/ga4-csv/{agencyId}/{clientId}/" --file="ga4-csv/{agencyId}/{clientId}/*.csv"
   ```
5. Verify client is accessible via API
6. Notify customer of restoration

### Scenario 3: Accidental Client Deletion

**RTO**: 30 minutes
**RPO**: Real-time (if backup exists)

**Steps**:
1. **If cascade delete was NOT used**: Client KV entry deleted but R2 objects remain
   - Restore client KV entry from backup
   - R2 objects still accessible

2. **If cascade delete WAS used**: All data deleted
   - Restore client KV entry from backup
   - Restore R2 objects from backup

**Prevention**: Hostile Audit Phase 4 added cascade delete option via `X-Cascade-Delete: true` header. Default behavior (without header) preserves R2 objects. Client-scoped guardrails prevent agency-wide deletion.

---

## APPENDIX

### A. KV Key Patterns

**Documentation Reference**: `src/storage.ts` lines 9-18

```
agency:{agencyId}                    → Agency object
agency_api_key:{apiKey}              → AgencyId (for lookups by API key)
agency_stripe_customer:{customerId}  → AgencyId (for Stripe lookups)
agency:{agencyId}:clients            → Array of Client IDs
client:{clientId}                    → Client object
client:{clientId}:integration        → IntegrationConfig object
client:{clientId}:reports            → Array of ReportRun IDs
report:{reportId}                    → ReportRun metadata
admin_audit:{auditId}                → Admin audit entry (Phase 4)
admin_audit:agency:{agencyId}        → List of audit IDs for agency (Phase 4)
registration_ratelimit:{ip}          → Rate limit counter for IP (Phase 1)
idempotency:{agencyId}:{clientId}:{key} → Idempotency cache (Phase 2)
```

### B. R2 Object Patterns

**Documentation Reference**: `src/storage.ts` lines 252-283

```
ga4-csv/{agencyId}/{clientId}/{timestamp}.csv  → CSV analytics data
reports/{agencyId}/{clientId}/{reportId}.pdf   → Generated PDF reports
```

### C. Estimated Backup Sizes

**Typical Agency** (5 clients, 20 reports):
- KV data: ~50 KB (JSON metadata)
- R2 CSV files: ~5 MB per client = 25 MB total
- R2 PDF files: ~500 KB per report = 10 MB total
- **Total per agency**: ~35 MB

**100 Agencies**:
- KV data: ~5 MB
- R2 data: ~3.5 GB
- **Total**: ~3.5 GB

**Storage Cost** (S3 Standard):
- 3.5 GB × $0.023/GB/month = **$0.08/month**

---

## MAINTENANCE

**Last Reviewed**: 2025-12-18
**Next Review**: 2026-03-18 (90 days)
**Owner**: Operations Team

**Change Log**:
- 2025-12-18: Initial version (Hostile Audit Phase 4)

---

**End of Runbook**
