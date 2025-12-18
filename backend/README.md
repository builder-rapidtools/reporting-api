# RapidTools Reporting Tool - Backend API

**Phase 2: PDF Generation & Email Sending**

Cloudflare Workers backend for the Automated Weekly Client Reporting Tool.

---

## Architecture

- **Runtime:** Cloudflare Workers (TypeScript)
- **Storage:** Cloudflare KV (metadata) + R2 (CSV/PDF files)
- **Framework:** Hono (lightweight router for Workers)
- **Language:** TypeScript

---

## Prerequisites

Before running this backend locally or deploying to production, ensure you have:

1. **Node.js 18+** installed
2. **npm** or **yarn** installed
3. **Wrangler CLI** installed globally:
   ```bash
   npm install -g wrangler
   ```
4. **Cloudflare account** with Workers enabled

---

## Setup

### 1. Install Dependencies

```bash
cd ~/ai-stack/rapidtools/products/reporting-tool/backend
npm install
```

### 2. Create Cloudflare Resources

#### Create KV Namespace

```bash
wrangler kv:namespace create REPORTING_KV
```

Output will show namespace ID like:
```
{ binding = "REPORTING_KV", id = "abc123..." }
```

Copy the `id` and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "REPORTING_KV"
id = "abc123..."  # Replace with your actual ID
```

#### Create R2 Bucket

```bash
wrangler r2 bucket create rapidtools-reports
```

### 3. Configure Environment Variables

For local development, create `.dev.vars` file in the backend directory:

```bash
touch .dev.vars
```

Add the following environment variables:

```
REPORTING_ENV=dev
EMAIL_FROM_ADDRESS=reports@rapidtools.io
BASE_URL=http://localhost:8787
# EMAIL_PROVIDER_API_KEY=   # Optional: Leave commented for dev mode
```

**Environment Variables Explained:**

- `REPORTING_ENV`: Environment identifier (`dev` or `prod`)
- `EMAIL_FROM_ADDRESS`: Sender email address for reports
- `BASE_URL`: Base URL for links in emails (e.g., PDF download links)
- `EMAIL_PROVIDER_API_KEY`: (Optional) API key for email provider (Resend). If not set, emails are logged to console in **dev mode** instead of being sent.

**Note:** Stripe and auth secrets will be added in Phase 3.

---

## Running Locally

Start the development server:

```bash
npm run dev
```

This runs `wrangler dev` which starts a local Cloudflare Workers environment on `http://localhost:8787`.

---

## API Endpoints (Phase 1)

### Health Check

**GET** `/api/health`

**Response:**
```json
{
  "status": "ok",
  "env": "dev",
  "timestamp": "2025-12-07T10:30:00.000Z"
}
```

---

### Create Client

**POST** `/api/client`

**Request Body:**
```json
{
  "name": "Acme Corp",
  "email": "reports@acmecorp.com",
  "brandLogoUrl": "https://example.com/logo.png",
  "reportSchedule": "weekly"
}
```

**Response:**
```json
{
  "success": true,
  "client": {
    "id": "uuid-here",
    "agencyId": "dev-agency",
    "name": "Acme Corp",
    "email": "reports@acmecorp.com",
    "brandLogoUrl": "https://example.com/logo.png",
    "reportSchedule": "weekly",
    "createdAt": "2025-12-07T10:30:00.000Z"
  }
}
```

---

### List Clients

**GET** `/api/clients`

**Response:**
```json
{
  "success": true,
  "clients": [
    {
      "id": "uuid-1",
      "agencyId": "dev-agency",
      "name": "Acme Corp",
      "email": "reports@acmecorp.com",
      "reportSchedule": "weekly",
      "createdAt": "2025-12-07T10:30:00.000Z"
    }
  ]
}
```

---

### Delete Client

**DELETE** `/api/client/:id`

**Response:**
```json
{
  "success": true
}
```

---

### Upload GA4 CSV

**POST** `/api/client/:id/ga4-csv`

**Request Body:** Raw CSV text

**Expected CSV format:**
```csv
date,sessions,users,pageviews,page_path,page_views
2025-12-01,150,120,450,/home,200
2025-12-01,150,120,450,/about,100
2025-12-02,180,140,520,/home,250
```

**Response:**
```json
{
  "success": true,
  "uploadedAt": "2025-12-07T10:35:00.000Z",
  "rowsProcessed": 3
}
```

---

### Report Preview

**POST** `/api/client/:id/report/preview`

**Response:**
```json
{
  "success": true,
  "preview": {
    "client": {
      "id": "uuid-here",
      "name": "Acme Corp",
      "email": "reports@acmecorp.com"
    },
    "metrics": {
      "periodStart": "2025-12-01",
      "periodEnd": "2025-12-07",
      "sessions": 1200,
      "users": 950,
      "pageviews": 3500,
      "topPages": [
        { "path": "/home", "pageviews": 1200 },
        { "path": "/about", "pageviews": 800 }
      ]
    },
    "generatedAt": "2025-12-07T10:40:00.000Z"
  }
}
```

---

### Report Send (Phase 2: Full Implementation)

**POST** `/api/client/:id/report/send`

Generates a branded PDF report and sends it via email.

**Response (Dev Mode - no EMAIL_PROVIDER_API_KEY set):**
```json
{
  "success": true,
  "clientId": "uuid-here",
  "sentTo": "reports@acmecorp.com",
  "pdfKey": "reports/dev-agency/uuid-here/2025-12-07T10-45-00-000Z.pdf",
  "pdfSizeBytes": 45230,
  "devMode": true,
  "sentAt": "2025-12-07T10:45:00.000Z"
}
```

**Response (Production Mode - with EMAIL_PROVIDER_API_KEY):**
```json
{
  "success": true,
  "clientId": "uuid-here",
  "sentTo": "reports@acmecorp.com",
  "pdfKey": "reports/dev-agency/uuid-here/2025-12-07T10-45-00-000Z.pdf",
  "pdfSizeBytes": 45230,
  "devMode": false,
  "provider": "resend",
  "messageId": "msg_abc123",
  "sentAt": "2025-12-07T10:45:00.000Z"
}
```

**Dev Mode Behavior:**

When `EMAIL_PROVIDER_API_KEY` is not set in `.dev.vars`, the endpoint will:
1. Generate the PDF and store it in R2
2. Log the email content to the console (visible in `wrangler dev` output)
3. Return `devMode: true` in the response
4. NOT actually send an email

This allows full testing of the report generation flow without requiring email credentials.

---

## Testing the API

### Using curl

**Health check:**
```bash
curl http://localhost:8787/api/health
```

**Create client:**
```bash
curl -X POST http://localhost:8787/api/client \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Client",
    "email": "test@example.com",
    "reportSchedule": "weekly"
  }'
```

**List clients:**
```bash
curl http://localhost:8787/api/clients
```

**Upload CSV:**
```bash
curl -X POST http://localhost:8787/api/client/CLIENT_ID_HERE/ga4-csv \
  -H "Content-Type: text/csv" \
  --data-binary @sample.csv
```

**Generate preview:**
```bash
curl -X POST http://localhost:8787/api/client/CLIENT_ID_HERE/report/preview
```

**Send report (Phase 2):**
```bash
curl -X POST http://localhost:8787/api/client/CLIENT_ID_HERE/report/send
```

---

## Phase 2 Testing Guide

### Complete End-to-End Test

1. **Start dev server** (if not already running):
   ```bash
   npm run dev
   ```

2. **Create a test client:**
   ```bash
   curl -X POST http://localhost:8787/api/client \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Test Agency Client",
       "email": "client@testagency.com",
       "reportSchedule": "weekly"
     }'
   ```
   Copy the `id` from the response.

3. **Create test CSV file:**
   ```bash
   cat > ~/test-ga4.csv << 'EOF'
   date,sessions,users,pageviews,page_path,page_views
   2025-12-01,150,120,450,/home,200
   2025-12-01,150,120,450,/about,100
   2025-12-02,180,140,520,/home,250
   2025-12-02,180,140,520,/products,150
   EOF
   ```

4. **Upload CSV:**
   ```bash
   curl -X POST http://localhost:8787/api/client/CLIENT_ID/ga4-csv \
     -H "Content-Type: text/csv" \
     --data-binary @~/test-ga4.csv
   ```

5. **Generate and send report:**
   ```bash
   curl -X POST http://localhost:8787/api/client/CLIENT_ID/report/send
   ```

6. **Check console output** - You should see:
   - PDF generation progress
   - Email logged to console (in dev mode)
   - JSON response with `pdfKey` and `devMode: true`

---

## Project Structure

```
backend/
├── src/
│   ├── index.ts              # Cloudflare Worker entrypoint
│   ├── router.ts             # API route definitions
│   ├── types.ts              # TypeScript type definitions
│   ├── storage.ts            # KV/R2 storage abstraction
│   ├── pdf.ts                # PDF generation module (Phase 2)
│   ├── email.ts              # Email abstraction module (Phase 2)
│   └── handlers/
│       ├── health.ts         # Health check handler
│       ├── clients.ts        # Client CRUD handlers
│       ├── uploads.ts        # GA4 CSV upload handler
│       └── reports.ts        # Report generation handlers
├── package.json
├── tsconfig.json
├── wrangler.toml             # Cloudflare Workers config
├── .dev.vars                 # Local env vars (gitignored)
└── README.md
```

---

## Current Limitations (Phase 2)

- **No authentication:** All requests use hardcoded `dev-agency` ID
- **No Stripe integration:** Payment flow not implemented yet
- **No scheduling:** Cron triggers not configured yet

These features will be implemented in subsequent phases.

---

## Production Safety

**Production Safety Milestone A** implements environment validation and security hardening to ensure the worker fails fast if required secrets are missing or if security checks fail.

### Operating Principles

This backend follows strict operating principles defined in `/OPERATING-PRINCIPLES.md`:

- **Correctness over speed** - Production must not start if it cannot run safely
- **Safety over growth** - No insecure payment paths or dev-mode bypasses in production
- **Observability over automation** - All webhooks and events are logged and validated
- **Fail-fast behavior** - Missing secrets cause immediate startup failure with clear errors

### Required Production Secrets

The following secrets **must** be configured before production deployment. The worker will fail to start if any are missing when `REPORTING_ENV=prod`.

| Secret | Purpose | How to Set |
|--------|---------|------------|
| `STRIPE_SECRET_KEY` | Stripe API authentication | `wrangler secret put STRIPE_SECRET_KEY` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification | `wrangler secret put STRIPE_WEBHOOK_SECRET` |
| `STRIPE_PRICE_ID_STARTER` | Stripe price ID for Starter plan | `wrangler secret put STRIPE_PRICE_ID_STARTER` |
| `EMAIL_PROVIDER_API_KEY` | Resend API key for sending emails | `wrangler secret put EMAIL_PROVIDER_API_KEY` |

**Optional configuration (with defaults):**

- `EMAIL_FROM_ADDRESS` - Defaults to `reports@rapidtools.io`
- `BASE_URL` - Defaults to `https://app.rapidtools.io`

**Environment identifier (must be set in wrangler.toml or .dev.vars):**

- `REPORTING_ENV` - Must be `dev` or `prod`

### Environment Modes

**Development Mode (`REPORTING_ENV=dev`):**
- Authentication bypass enabled (no API key required)
- Stripe checkout returns mock URL
- Stripe webhooks are logged but not processed
- Emails are logged to console instead of sent
- Missing secrets are allowed (dev mode fallbacks activate)

**Production Mode (`REPORTING_ENV=prod`):**
- All dev-mode bypasses **disabled**
- All required secrets **must** be configured
- Stripe webhooks require valid HMAC signature verification
- Emails sent via Resend API
- Worker fails to start if any required secret is missing

### Security Features

#### 1. Stripe Webhook Signature Verification

All Stripe webhooks are verified using HMAC SHA-256 signature verification:
- Validates `stripe-signature` header
- Computes HMAC of `timestamp.payload` using webhook secret
- Rejects requests with invalid or missing signatures
- Prevents replay attacks by checking timestamp (must be within 5 minutes)

#### 2. Webhook Idempotency

Prevents duplicate processing of webhook events:
- Event IDs stored in KV with 24-hour TTL
- Duplicate events return success immediately without reprocessing
- Prevents double-charging or duplicate report sends

#### 3. Environment Validation

On worker startup (first request), the environment is validated:
- Checks that `REPORTING_ENV` is set to `dev` or `prod`
- In production, validates all required secrets are present
- Validates email format and URL format if provided
- Returns HTTP 503 with error details if validation fails

### What Will Fail Fast (Production)

The following conditions cause immediate worker failure in production:

1. **Missing `REPORTING_ENV`** - Worker returns 503
2. **Invalid `REPORTING_ENV` value** - Worker returns 503
3. **Missing any required secret** - Worker returns 503 with list of missing secrets
4. **Invalid `EMAIL_FROM_ADDRESS` format** - Worker returns 503
5. **Invalid `BASE_URL` format** - Worker returns 503
6. **Missing KV or R2 binding** - Worker returns 503

**Example error response:**
```json
{
  "error": "Service configuration error",
  "message": "Worker cannot start - environment validation failed",
  "details": "Production requires STRIPE_SECRET_KEY but it is not set and no default is available"
}
```

### Deployment Process

Use the safe deployment script:

```bash
# From repository root
./infrastructure/deploy.sh production
```

The deployment script performs the following checks:

1. **Pre-flight validation:**
   - Verifies git working directory is clean
   - Confirms wrangler CLI is installed
   - Validates Cloudflare authentication

2. **Secret validation:**
   - Checks all required secrets are configured
   - Lists missing secrets if any

3. **Type checking:**
   - Runs `npm run typecheck` to catch TypeScript errors

4. **Deployment:**
   - Runs `wrangler publish`
   - Deploys worker to Cloudflare

5. **Post-deployment verification:**
   - Checks `/api/health` endpoint
   - Verifies worker responds with HTTP 200

6. **Rollback instructions:**
   - Prints git SHA for current deployment
   - Provides exact rollback commands

### Manual Deployment Steps

If you need to deploy manually (not recommended):

#### 1. Configure Production Secrets

```bash
# Navigate to backend directory
cd products/reporting-tool/backend

# Set required secrets
wrangler secret put STRIPE_SECRET_KEY
# Enter your Stripe secret key when prompted

wrangler secret put STRIPE_WEBHOOK_SECRET
# Enter your Stripe webhook secret when prompted

wrangler secret put STRIPE_PRICE_ID_STARTER
# Enter your Stripe price ID when prompted

wrangler secret put EMAIL_PROVIDER_API_KEY
# Enter your Resend API key when prompted
```

#### 2. Verify Secret Configuration

```bash
wrangler secret list
```

Should show:
```
┌─────────────────────────┐
│ Secret Name             │
├─────────────────────────┤
│ STRIPE_SECRET_KEY       │
│ STRIPE_WEBHOOK_SECRET   │
│ STRIPE_PRICE_ID_STARTER │
│ EMAIL_PROVIDER_API_KEY  │
└─────────────────────────┘
```

#### 3. Deploy Worker

```bash
wrangler publish
```

#### 4. Verify Deployment

```bash
# Test health endpoint
curl https://reporting-tool-api.workers.dev/api/health

# Expected response:
# {
#   "status": "ok",
#   "env": "prod",
#   "timestamp": "2025-12-13T12:00:00.000Z"
# }
```

### Rollback Procedure

If a deployment needs to be rolled back:

1. **Identify the previous working commit SHA**
2. **Checkout that commit:**
   ```bash
   git checkout <previous-commit-sha>
   ```
3. **Re-deploy:**
   ```bash
   ./infrastructure/deploy.sh production
   ```
4. **Return to main branch:**
   ```bash
   git checkout main
   ```

Alternatively, use the Cloudflare dashboard:
- Navigate to: https://dash.cloudflare.com/
- Workers & Pages → reporting-tool-api → Deployments
- Click "Rollback" on a previous deployment

### Configure Custom Domain

In Cloudflare dashboard:
- Workers → reporting-tool-api → Triggers
- Add custom domain (e.g. `api.rapidtools.io`)

---

## Stripe Test Mode Runbook

This runbook proves the end-to-end Stripe payment loop works in production TEST mode:
**Checkout → Webhook (verified + idempotent) → Agency activation → Paid endpoints unlock**

### Prerequisites

- Worker deployed to production (see Deployment Process above)
- Stripe account with test mode enabled
- Custom domain configured (or use `*.workers.dev` URL)

### Step 1: Create Stripe Product and Price (Test Mode)

1. **Go to Stripe Dashboard:** https://dashboard.stripe.com/test/products

2. **Create Product:**
   - Click "Add product"
   - Product name: `RapidTools Starter Plan`
   - Description: `Automated weekly client reporting - Up to 5 clients`
   - Click "Add pricing"

3. **Configure Pricing:**
   - Pricing model: `Standard pricing`
   - Price: `25.00 GBP`
   - Billing period: `Monthly`
   - Click "Save product"

4. **Copy Price ID:**
   - Find the price in the product details
   - Copy the price ID (starts with `price_...`)
   - You will need this for `STRIPE_PRICE_ID_STARTER`

### Step 2: Configure Stripe Webhook Endpoint

1. **Go to Webhooks:** https://dashboard.stripe.com/test/webhooks

2. **Add Endpoint:**
   - Click "Add endpoint"
   - Endpoint URL: `https://your-worker-url.workers.dev/api/agency/stripe/webhook`
     - Replace `your-worker-url` with your actual worker URL
     - Or use custom domain: `https://api.rapidtools.io/api/agency/stripe/webhook`

3. **Select Events to Listen For:**
   - Click "Select events"
   - Select the following events:
     - ✅ `checkout.session.completed`
     - ✅ `customer.subscription.deleted`
   - Click "Add events"

4. **Add Endpoint:**
   - Click "Add endpoint"

5. **Copy Webhook Signing Secret:**
   - Click on the newly created endpoint
   - Click "Reveal" under "Signing secret"
   - Copy the secret (starts with `whsec_...`)
   - You will need this for `STRIPE_WEBHOOK_SECRET`

### Step 3: Configure Production Secrets

Navigate to backend directory:

```bash
cd ~/ai-stack/rapidtools/products/reporting-tool/backend
```

Set required Stripe secrets:

```bash
# Set Stripe secret key (test mode)
wrangler secret put STRIPE_SECRET_KEY
# When prompted, paste your Stripe test secret key (sk_test_...)

# Set Stripe webhook secret
wrangler secret put STRIPE_WEBHOOK_SECRET
# When prompted, paste the webhook signing secret from Step 2 (whsec_...)

# Set Stripe price ID
wrangler secret put STRIPE_PRICE_ID_STARTER
# When prompted, paste the price ID from Step 1 (price_...)

# Verify secrets are set
wrangler secret list
```

Expected output:
```
┌─────────────────────────┐
│ Secret Name             │
├─────────────────────────┤
│ STRIPE_SECRET_KEY       │
│ STRIPE_WEBHOOK_SECRET   │
│ STRIPE_PRICE_ID_STARTER │
│ EMAIL_PROVIDER_API_KEY  │
└─────────────────────────┘
```

### Step 4: End-to-End Test Commands

Replace `YOUR_WORKER_URL` with your actual worker URL throughout these commands.

#### 4.1: Register Test Agency

```bash
curl -X POST https://YOUR_WORKER_URL/api/agency/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Agency",
    "billingEmail": "test@example.com"
  }'
```

**Expected response:**
```json
{
  "success": true,
  "agency": {
    "id": "abc-123-def-456",
    "name": "Test Agency",
    "billingEmail": "test@example.com",
    "apiKey": "xyz-789-uvw-012",
    "subscriptionStatus": "trial",
    "createdAt": "2025-12-13T12:00:00.000Z"
  }
}
```

**Save the `apiKey` for subsequent requests.**

#### 4.2: Verify Initial Status

```bash
curl https://YOUR_WORKER_URL/api/agency/me \
  -H "x-api-key: YOUR_API_KEY_FROM_STEP_4.1"
```

**Expected response:**
```json
{
  "success": true,
  "agency": {
    "id": "abc-123-def-456",
    "name": "Test Agency",
    "billingEmail": "test@example.com",
    "subscriptionStatus": "trial",
    ...
  }
}
```

**Confirm:** `subscriptionStatus` is `"trial"`

#### 4.3: Create Stripe Checkout Session

```bash
curl -X POST https://YOUR_WORKER_URL/api/agency/checkout \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY_FROM_STEP_4.1" \
  -d '{}'
```

**Expected response:**
```json
{
  "success": true,
  "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_...",
  "sessionId": "cs_test_..."
}
```

#### 4.4: Complete Stripe Checkout (Manual Step)

1. **Open the `checkoutUrl` in your browser**
2. **Complete checkout using Stripe test card:**
   - Card number: `4242 4242 4242 4242`
   - Expiry: Any future date (e.g., `12/34`)
   - CVC: Any 3 digits (e.g., `123`)
   - ZIP: Any 5 digits (e.g., `12345`)
3. **Click "Subscribe"**
4. **Wait for redirect to success page**

**What happens behind the scenes:**
- Stripe sends `checkout.session.completed` webhook to your worker
- Worker verifies webhook signature (HMAC SHA-256)
- Worker checks idempotency (prevents duplicate processing)
- Worker updates agency:
  - Sets `stripeCustomerId`
  - Sets `stripeSubscriptionId`
  - Sets `subscriptionStatus: "active"`

#### 4.5: Verify Agency is Activated

Wait ~5 seconds for webhook processing, then:

```bash
curl https://YOUR_WORKER_URL/api/agency/me \
  -H "x-api-key: YOUR_API_KEY_FROM_STEP_4.1"
```

**Expected response:**
```json
{
  "success": true,
  "agency": {
    "id": "abc-123-def-456",
    "name": "Test Agency",
    "billingEmail": "test@example.com",
    "subscriptionStatus": "active",
    "stripeCustomerId": "cus_...",
    "stripeSubscriptionId": "sub_...",
    ...
  }
}
```

**Confirm:** `subscriptionStatus` is now `"active"`

#### 4.6: Verify Paid Endpoints Work

Test that endpoints requiring active subscription now work:

**Create a client:**
```bash
curl -X POST https://YOUR_WORKER_URL/api/client \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY_FROM_STEP_4.1" \
  -d '{
    "name": "Test Client",
    "email": "client@example.com",
    "reportSchedule": "weekly"
  }'
```

**Expected:** HTTP 201 with client details

**Before activation, this would return:**
```json
{
  "success": false,
  "error": "Subscription inactive. Status: trial"
}
```

**After activation, this returns:**
```json
{
  "success": true,
  "client": {
    "id": "client-uuid",
    "name": "Test Client",
    ...
  }
}
```

### Step 5: Test Subscription Cancellation (Optional)

1. **Go to Stripe Dashboard:** https://dashboard.stripe.com/test/subscriptions
2. **Find the test subscription** (search by email: `test@example.com`)
3. **Click on the subscription**
4. **Click "Cancel subscription"**
5. **Confirm cancellation**

**What happens:**
- Stripe sends `customer.subscription.deleted` webhook
- Worker verifies signature and checks idempotency
- Worker finds agency by `stripeCustomerId`
- Worker sets `subscriptionStatus: "canceled"`

**Verify cancellation:**

```bash
curl https://YOUR_WORKER_URL/api/agency/me \
  -H "x-api-key: YOUR_API_KEY_FROM_STEP_4.1"
```

**Expected:** `subscriptionStatus` is now `"canceled"`

**Verify paid endpoints are blocked:**

```bash
curl -X POST https://YOUR_WORKER_URL/api/client \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY_FROM_STEP_4.1" \
  -d '{
    "name": "Another Client",
    "email": "another@example.com"
  }'
```

**Expected:**
```json
{
  "success": false,
  "error": "Subscription inactive. Status: canceled"
}
```

### Webhook Events Subscribed

The following Stripe events are handled by the webhook endpoint:

| Event | Handler | Action |
|-------|---------|--------|
| `checkout.session.completed` | ✅ Implemented | Sets `subscriptionStatus: "active"`, stores Stripe customer/subscription IDs |
| `customer.subscription.deleted` | ✅ Implemented | Sets `subscriptionStatus: "canceled"` |

**Events NOT handled (out of scope for minimal loop):**
- `customer.subscription.updated` - Status changes (past_due, etc.) logged but not processed
- `customer.subscription.created` - Redundant with checkout.session.completed

### Troubleshooting

**Webhook not received:**
- Check Stripe Dashboard → Webhooks → Your endpoint → Events
- Verify endpoint URL is correct and publicly accessible
- Check worker logs: `wrangler tail`

**Webhook signature verification failed:**
- Verify `STRIPE_WEBHOOK_SECRET` matches the signing secret from Stripe Dashboard
- Check worker logs for error details

**Agency not activated after checkout:**
- Check Stripe Dashboard → Webhooks → Events → `checkout.session.completed`
- Verify event includes `metadata.agencyId`
- Check worker logs for errors during webhook processing

**Paid endpoints still blocked:**
- Verify `subscriptionStatus` is `"active"` via `/api/agency/me`
- Check that API key used matches the registered agency

---

## Automated Weekly Reports (Cloudflare Cron)

The worker includes a scheduled handler that automatically sends weekly reports to all active agencies.

### How It Works

**Schedule:** Every Monday at 09:00 UTC (configured in `wrangler.toml`)

**Process:**
1. Find all agencies with `subscriptionStatus: "active"`
2. For each agency, find clients with `reportSchedule: "weekly"`
3. For each client:
   - Check idempotency (skip if already sent this week)
   - Generate PDF report from latest GA4 CSV data
   - Send email with report
   - Mark as sent for this week (60-day TTL)
4. Log structured summary with success/failure counts

**Safety Features:**
- **Kill-switch:** `AUTOMATION_ENABLED` must be explicitly set to `true` (defaults to disabled)
- **Dry-run mode:** Dev environment (`REPORTING_ENV=dev`) runs logs-only, no emails/PDFs
- **Idempotent:** Each client receives at most one report per ISO week
- **Bounded retries:** Up to 2 retries per report with exponential backoff
- **Visible failures:** All errors logged with structured context
- **No infinite loops:** Failed reports are logged but don't block other clients

### Kill-Switch and Dry-Run Mode

**Operating Principle:** Automation must be explicitly enabled and safe by default.

#### AUTOMATION_ENABLED Kill-Switch

The scheduled handler will NOT run unless `AUTOMATION_ENABLED=true` is set.

**Default behavior (kill-switch active):**
```bash
# Cron trigger fires
# Log: "Scheduled report run DISABLED by kill-switch"
# No reports sent, no agencies processed
# Run completes successfully with zero counts
```

**To enable automation:**

```bash
# Development (.dev.vars file):
AUTOMATION_ENABLED=true

# Production:
wrangler secret put AUTOMATION_ENABLED
# Enter: true
```

**To disable automation:**

```bash
# Production:
wrangler secret put AUTOMATION_ENABLED
# Enter: false

# Or delete the secret:
wrangler secret delete AUTOMATION_ENABLED
```

**Why this exists:** Prevents accidental automation when testing, provides instant shut-off for emergencies.

#### Dev Mode Dry-Run

When `REPORTING_ENV=dev`, scheduled runs operate in **dry-run mode**:

**What happens in dry-run:**
- ✅ Agency and client iteration runs normally
- ✅ Idempotency checks run normally
- ✅ Structured logs emitted for every action
- ❌ **NO PDFs generated** (no R2 writes)
- ❌ **NO emails sent** (no API calls to Resend)
- ✅ Logs show "DRY RUN - Report would be sent"

**Example dry-run log:**
```json
{
  "level": "info",
  "message": "DRY RUN - Report would be sent",
  "timestamp": "2025-12-13T09:00:00.000Z",
  "runId": "run-...",
  "agencyId": "abc-123",
  "agencyName": "Test Agency",
  "clientId": "client-456",
  "clientName": "Test Client",
  "dryRun": true
}
```

**Why this exists:** Allows testing cron logic locally without side effects. Compliance with operating principle "dev mode bypasses must not exist in production."

**Production mode (`REPORTING_ENV=prod`):**
- ✅ PDFs generated and stored in R2
- ✅ Emails sent via Resend
- ✅ Real automation

### Testing Cron Locally

Cloudflare Workers provides a way to test scheduled handlers locally.

**Trigger cron handler manually:**

```bash
cd ~/ai-stack/rapidtools/products/reporting-tool/backend

# Trigger the scheduled handler once
curl "http://localhost:8787/__scheduled?cron=0+9+*+*+1"
```

**Expected console output:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 SCHEDULED REPORT RUN TRIGGERED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cron: 0 9 * * 1
Scheduled Time: 2025-12-13T09:00:00.000Z
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{"level":"info","message":"Scheduled report run started","timestamp":"...","runId":"run-..."}
{"level":"info","message":"Active agencies found","timestamp":"...","runId":"run-...","agencyCount":2}
{"level":"info","message":"Processing agency","timestamp":"...","runId":"run-...","agencyId":"...","agencyName":"Test Agency"}
{"level":"info","message":"Weekly clients found","timestamp":"...","runId":"run-...","agencyId":"...","weeklyClientCount":3}
{"level":"info","message":"Sending report","timestamp":"...","runId":"run-...","clientId":"...","clientName":"Client 1"}
{"level":"info","message":"Report sent successfully","timestamp":"...","runId":"run-...","pdfKey":"reports/...","sentAt":"..."}
...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ SCHEDULED REPORT RUN SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Run ID: run-2025-12-13T09:00:00.000Z-abc123
Agencies processed: 2
Clients processed: 5
Reports sent: 3
Reports skipped: 2
Reports failed: 0
Duration: 2340ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Viewing Cron Logs in Production

**Real-time tail (recommended for testing):**

```bash
cd ~/ai-stack/rapidtools/products/reporting-tool/backend

# Tail logs in real-time
wrangler tail

# Tail only scheduled events
wrangler tail --format=pretty | grep "SCHEDULED"
```

**Check past cron runs in Cloudflare Dashboard:**
1. Go to: https://dash.cloudflare.com/
2. Workers & Pages → reporting-tool-api
3. Logs → Cron Triggers
4. View execution history and logs

### Idempotency Protection

Each report send is tracked by ISO week to prevent duplicates:

**KV Key Pattern:**
```
report_sent:{agencyId}:{clientId}:{yearWeek}
```

**Example:**
```
report_sent:abc-123:client-456:2025-W50
```

**TTL:** 60 days (5,184,000 seconds)

**Effect:**
- If a client already received a report this week, subsequent cron runs will skip them
- Manual sends via `/api/client/:id/report/send` bypass idempotency (for testing)

### Retry Logic

**Bounded retries:** Maximum 2 retries per report

**Backoff strategy:** Exponential (1s, 2s)

**Example:**
```
Attempt 1: Fails immediately
  Wait 1 second
Attempt 2: Fails
  Wait 2 seconds
Attempt 3: Fails
  → Report marked as failed, logged with error
```

**Failure recording:**
- Error logged with structured context (agencyId, clientId, error message)
- Optionally sent to Sentry if `SENTRY_DSN` is configured
- Next cron run will retry (no persistent failure state)

### Structured Logging

All cron events emit JSON logs for observability:

```json
{
  "level": "info",
  "message": "Report sent successfully",
  "timestamp": "2025-12-13T09:00:05.123Z",
  "runId": "run-2025-12-13T09:00:00.000Z-abc123",
  "agencyId": "abc-123",
  "agencyName": "Test Agency",
  "clientId": "client-456",
  "clientName": "Client Name",
  "pdfKey": "reports/abc-123/client-456/2025-12-13T09-00-05-123Z.pdf",
  "sentAt": "2025-12-13T09:00:05.123Z",
  "retries": 0
}
```

**Log levels:**
- `info` - Normal operations (started, agency found, report sent, completed)
- `warn` - Skipped reports (idempotency)
- `error` - Failed reports, fatal errors

### Error Capture (Optional Sentry Integration)

For production monitoring, configure Sentry error tracking:

```bash
# Optional: Enable Sentry error capture
wrangler secret put SENTRY_DSN
# Paste your Sentry DSN (e.g., https://<key>@<org>.ingest.sentry.io/<project>)
```

**When to use:**
- Production deployments where you need error alerting
- High-volume agencies where manual log review is impractical

**What gets captured:**
- Failed report sends (after all retries exhausted)
- Fatal cron run errors
- Context includes: runId, agencyId, clientId, error message

**When NOT to use:**
- Development/testing (logs are sufficient)
- Low-volume deployments (under 10 agencies)

### Disabling Cron Safely

If you need to temporarily disable automated reports:

**Option 1: Comment out cron trigger (recommended)**

Edit `wrangler.toml`:
```toml
# Cron triggers for weekly report automation
# Sends reports every Monday at 09:00 UTC
# To disable cron: comment out the [triggers] section and redeploy
# [triggers]
# crons = ["0 9 * * 1"]  # Every Monday at 09:00 UTC
```

Then redeploy:
```bash
./infrastructure/deploy.sh production
```

**Option 2: Remove cron trigger via Cloudflare Dashboard**

1. Go to: https://dash.cloudflare.com/
2. Workers & Pages → reporting-tool-api
3. Triggers → Cron Triggers
4. Delete the trigger

**Note:** Manual report sends via HTTP endpoint will continue to work.

### Changing Cron Schedule

Edit `wrangler.toml` and change the cron expression:

```toml
[triggers]
crons = ["0 9 * * 1"]  # Every Monday at 09:00 UTC
```

**Common schedules:**

```toml
# Every Monday at 09:00 UTC (weekly)
crons = ["0 9 * * 1"]

# Every day at 09:00 UTC (daily)
crons = ["0 9 * * *"]

# Every Sunday at 18:00 UTC (weekly, end of week)
crons = ["0 18 * * 0"]

# First day of month at 09:00 UTC (monthly)
crons = ["0 9 1 * *"]
```

After editing, redeploy:
```bash
./infrastructure/deploy.sh production
```

### Troubleshooting

**Cron not triggering:**
- Check Cloudflare Dashboard → Workers → reporting-tool-api → Triggers
- Verify cron trigger is enabled and shows next scheduled run
- Check worker logs: `wrangler tail`

**Reports not being sent:**
- Check structured logs for errors
- Verify agencies have `subscriptionStatus: "active"`
- Verify clients have `reportSchedule: "weekly"`
- Check that clients have GA4 CSV data uploaded

**Duplicate reports being sent:**
- Check idempotency keys in KV: `report_sent:{agencyId}:{clientId}:{yearWeek}`
- Verify ISO week calculation is correct
- Check if idempotency TTL has expired (60 days)

**All reports failing:**
- Check email provider API key is configured: `wrangler secret list`
- Check R2 bucket access
- Review error logs for specific failure reason

---

## Phase 3 Roadmap

1. **Stripe Subscription Flow:** Implement agency registration and subscription handling
2. **Stripe Webhooks:** Handle subscription events (trial, active, cancelled)
3. **Authentication:** Replace hardcoded agency ID with JWT auth
4. **Cron Triggers:** Enable weekly automation with scheduled reports

---

## Operational Scripts

### API Key Rotation

If an agency API key is accidentally exposed:

```bash
./scripts/fix-and-verify-agency-key.sh
```

Prompts for current key (hidden), rotates in production, verifies old key fails and new key works.
Prints only success/failure and new key at the end.

---

## Admin Endpoints

### Rotate Agency API Key

**POST** `/api/admin/agency/:agencyId/rotate-key`

Rotate an agency's API key. Requires admin authentication.

**Headers:**
```
x-admin-secret: <ADMIN_SECRET>
```

**Request:**
```bash
curl -X POST https://reporting-tool-api.jamesredwards89.workers.dev/api/admin/agency/AGENCY_ID/rotate-key \
  -H "x-admin-secret: YOUR_ADMIN_SECRET"
```

**Response (Success):**
```json
{
  "success": true,
  "newApiKey": "f2b4d8e1-9c7a-4f3d-b5e6-1a2c3d4e5f67"
}
```

**Response (Forbidden):**
```json
{
  "success": false,
  "error": "Forbidden"
}
```

**Response (Not Found):**
```json
{
  "success": false,
  "error": "Agency not found"
}
```

**Configuration:**

Set the admin secret in production:
```bash
wrangler secret put ADMIN_SECRET
```

**What it does:**
1. Authenticates admin request using `x-admin-secret` header
2. Fetches agency record from KV
3. Generates new UUID v4 API key
4. Updates agency record with new key
5. Creates new lookup `agency_api_key:{newKey}` → `agencyId`
6. Deletes old lookup `agency_api_key:{oldKey}`
7. Returns new API key

**Security:**
- Returns HTTP 403 if `x-admin-secret` is missing or incorrect
- Does not log secrets
- Old API key is immediately invalidated

---

## Troubleshooting

### KV namespace not found
- Ensure you've created the KV namespace and updated `wrangler.toml` with correct ID
- Run `wrangler kv:namespace list` to see your namespaces

### R2 bucket errors
- Verify bucket exists: `wrangler r2 bucket list`
- Ensure R2 binding in `wrangler.toml` matches bucket name

### TypeScript errors
- Run `npm run typecheck` to see full error details
- Ensure `@cloudflare/workers-types` is installed

---

**Built by RapidTools | Target: £2,000+/month MRR**
