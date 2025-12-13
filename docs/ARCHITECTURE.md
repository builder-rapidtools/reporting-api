# Automated Weekly Client Reporting Tool – Technical Architecture

**Version:** 1.0 (MVP)
**Target:** Digital agencies needing automated weekly GA4 client reports
**Revenue Goal:** £2,000+/month MRR

---

## Overview

The Automated Weekly Client Reporting Tool is a hosted web application that enables digital agencies to automatically generate and email branded weekly PDF reports to their clients. The MVP accepts GA4 data via CSV upload, processes traffic and engagement metrics, generates a branded PDF, and delivers it via email on a weekly schedule. Agencies subscribe via Stripe (Starter £25/mo, Pro £49/mo) and manage multiple clients through a simple dashboard.

**Primary user:** Digital agency account manager who needs to send consistent, professional weekly reports without manual effort.

---

## Stack

| Component | Technology | Notes |
|-----------|------------|-------|
| **Backend** | Cloudflare Workers (TypeScript) | Serverless, globally distributed, low latency |
| **Storage** | Cloudflare KV + R2 | KV for metadata (agencies, clients, configs), R2 for large objects (CSVs, PDFs) |
| **PDF Generation** | Server-side library (e.g. Puppeteer, jsPDF, or HTML→PDF API) | Initial: lightweight library; can upgrade to headless Chrome if needed |
| **Email** | External provider via HTTP API | Provider-agnostic wrapper; use Resend, Postmark, or SES via env vars |
| **Auth** | Simple token/magic-link per agency | MVP: avoid complex auth system; single agency user per account initially |
| **Payments** | Stripe Subscriptions | Checkout Sessions + Webhooks; plans: Starter £25/mo, Pro £49/mo |
| **Frontend** | Cloudflare Pages (React/Next.js or vanilla TS) | Dashboard for agency to manage clients and view reports |
| **Scheduling** | Cloudflare Cron Triggers | Weekly trigger to generate and send reports |

---

## Data Model

### Entities

1. **Agency**
   - `id` (string, UUID)
   - `name` (string)
   - `email` (string)
   - `authToken` (string, hashed or JWT)
   - `stripeCustomerId` (string)
   - `subscriptionStatus` (enum: `trial`, `active`, `past_due`, `cancelled`)
   - `subscriptionPlan` (enum: `starter`, `pro`)
   - `createdAt` (ISO timestamp)
   - `trialEndsAt` (ISO timestamp)

2. **User** (future; MVP can skip)
   - Agency can have multiple users in v2

3. **Client**
   - `id` (string, UUID)
   - `agencyId` (string, FK to Agency)
   - `name` (string)
   - `email` (string, where report is sent)
   - `brandLogoUrl` (string, optional)
   - `reportSchedule` (enum: `weekly`, `biweekly`, `monthly`) – MVP: weekly only
   - `lastReportSentAt` (ISO timestamp)
   - `createdAt` (ISO timestamp)

4. **IntegrationConfig**
   - `clientId` (string, FK)
   - `ga4CsvLatestKey` (string, R2 object key)
   - `ga4CsvUploadedAt` (ISO timestamp)
   - Future: GA4 OAuth tokens

5. **ReportTemplate**
   - `agencyId` (string)
   - `templateId` (string, UUID)
   - `htmlTemplate` (string, Handlebars/Mustache template)
   - `isDefault` (boolean)
   - MVP: single default template per agency

6. **ReportRun**
   - `id` (string, UUID)
   - `clientId` (string, FK)
   - `agencyId` (string)
   - `generatedAt` (ISO timestamp)
   - `pdfUrl` (string, R2 public URL or signed URL)
   - `metrics` (JSON object: sessions, users, pageviews, topPages)
   - `status` (enum: `pending`, `generated`, `sent`, `failed`)
   - `emailSentAt` (ISO timestamp)

### Storage Strategy

**Cloudflare KV:**

Use namespaced key patterns for fast lookups:

```
agency:{agencyId}                    → Agency object (JSON)
agency:{agencyId}:clients            → Array of Client IDs (JSON)
client:{clientId}                    → Client object (JSON)
client:{clientId}:integration        → IntegrationConfig object (JSON)
client:{clientId}:reports            → Array of ReportRun IDs (JSON)
report:{reportId}                    → ReportRun metadata (JSON)
agency:{agencyId}:template           → ReportTemplate object (JSON)
```

**Cloudflare R2:**

Store large binary/text objects:

```
ga4-csv/{agencyId}/{clientId}/{timestamp}.csv   → Uploaded GA4 CSV
reports/{agencyId}/{clientId}/{reportId}.pdf    → Generated PDF reports
```

---

## API Endpoints (Phase 1 MVP)

### Agency Management

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/agency/register` | Create new agency account, start free trial | No |
| POST | `/api/agency/stripe/webhook` | Handle Stripe subscription events | No (Stripe signature verification) |

### Client Management

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/client` | Create or update a client | Yes (agency token) |
| GET | `/api/clients` | List all clients for authenticated agency | Yes |
| DELETE | `/api/client/:id` | Remove a client | Yes |

### Data Upload

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/client/:id/ga4-csv` | Upload GA4 CSV data for client | Yes |

### Report Generation

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/client/:id/report/preview` | Generate preview report (JSON structure or PDF) | Yes |
| POST | `/api/client/:id/report/send` | Generate and email latest report to client | Yes |

### Scheduling (Internal)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/schedule/run` | Triggered by Cloudflare cron; sends weekly reports | No (internal trigger) |

### System

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/health` | Health check | No |

---

## GA4 Integration Approach (MVP)

### Phase 1: CSV Upload

To avoid OAuth complexity in MVP, accept manual CSV uploads from agencies:

**Required CSV columns:**
- `date` (YYYY-MM-DD)
- `sessions` (integer)
- `users` (integer)
- `pageviews` (integer)
- `page_path` (string)
- `page_views` (integer per page)

**Flow:**
1. Agency exports last 7 days of data from GA4 as CSV
2. POST to `/api/client/:id/ga4-csv` with CSV file
3. Backend parses CSV, validates structure
4. Stores raw CSV in R2: `ga4-csv/{agencyId}/{clientId}/{timestamp}.csv`
5. Updates `IntegrationConfig` with latest CSV key and timestamp
6. Aggregates metrics into JSON summary stored in KV

**Future (v2):** Replace with GA4 API OAuth integration; maintain same JSON summary format for backwards compatibility.

---

## Email Pipeline

### Design

Simple abstraction layer that wraps external email provider:

```typescript
interface EmailProvider {
  sendEmail(params: {
    to: string;
    from: string;
    subject: string;
    htmlBody: string;
    attachments?: Array<{ filename: string; content: Buffer }>;
  }): Promise<{ success: boolean; messageId?: string; error?: string }>;
}
```

### Implementation

MVP uses environment variables to configure provider:

```
EMAIL_PROVIDER_API_KEY    → API key for Resend/Postmark/SES
EMAIL_FROM_ADDRESS        → e.g. "reports@rapidtools.io"
```

Wrapper function in `src/services/email.ts`:

```typescript
async function sendReportEmail(
  clientEmail: string,
  clientName: string,
  pdfUrl: string,
  metrics: ReportMetrics
): Promise<void>
```

**HTML email template:** Simple, responsive design with:
- Agency branding (logo if provided)
- Summary metrics (sessions, users, pageviews)
- "View Full Report" CTA button linking to PDF
- PDF attached to email

---

## Stripe Integration

### Subscription Plans

| Plan | Price | Features |
|------|-------|----------|
| **Starter** | £25/mo | Up to 5 clients, weekly reports, email support |
| **Pro** | £49/mo | Unlimited clients, weekly reports, priority support, white-label option (future) |

### Flow

1. **Agency Registration:**
   - POST `/api/agency/register` → creates agency record with `subscriptionStatus: 'trial'`
   - Sets `trialEndsAt` to 14 days from now
   - Returns agency ID and auth token

2. **Subscription Creation:**
   - Frontend redirects to Stripe Checkout Session
   - Session includes agency ID in metadata
   - On success, Stripe webhook fires `checkout.session.completed`

3. **Webhook Handling:**
   - POST `/api/agency/stripe/webhook`
   - Verify Stripe signature using `STRIPE_WEBHOOK_SECRET`
   - Handle events:
     - `checkout.session.completed` → update agency: `subscriptionStatus: 'active'`, store `stripeCustomerId`
     - `customer.subscription.updated` → update plan or status
     - `customer.subscription.deleted` → set `subscriptionStatus: 'cancelled'`

4. **Access Control:**
   - Before generating/sending reports, check agency `subscriptionStatus`
   - If `trial` and `trialEndsAt` passed, block access
   - If `past_due` or `cancelled`, block access

### Environment Variables

```
STRIPE_SECRET_KEY         → sk_live_... or sk_test_...
STRIPE_WEBHOOK_SECRET     → whsec_...
```

---

## Scheduling: Weekly Report Automation

### Cloudflare Cron Triggers

Configure in `wrangler.toml`:

```toml
[triggers]
crons = ["0 9 * * 1"]  # Every Monday at 09:00 UTC
```

### Cron Handler Logic

When cron triggers `/api/schedule/run`:

1. Query all agencies with `subscriptionStatus: 'active'` or `trial` (if trial not expired)
2. For each agency:
   - Query all clients with `reportSchedule: 'weekly'`
   - Check `lastReportSentAt`:
     - If > 7 days ago (or never sent), generate report
3. For each eligible client:
   - Fetch latest GA4 data from KV (pre-processed from CSV)
   - Generate PDF report
   - Upload PDF to R2
   - Send email with PDF attachment
   - Update `lastReportSentAt` and create `ReportRun` record
4. Log success/failure counts for monitoring

### Error Handling

- If PDF generation fails: log error, mark `ReportRun.status: 'failed'`, skip email
- If email fails: log error, retry once after 5 minutes
- Surface failed reports in agency dashboard for manual retry

---

## Environment Variables (Complete List)

Required for deployment:

| Variable | Description | Example |
|----------|-------------|---------|
| `STRIPE_SECRET_KEY` | Stripe API secret key | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | `whsec_...` |
| `EMAIL_PROVIDER_API_KEY` | Email provider API key | `re_...` (Resend) |
| `EMAIL_FROM_ADDRESS` | Sender email address | `reports@rapidtools.io` |
| `BASE_URL` | Base URL for links in emails | `https://app.rapidtools.io` |
| `REPORTING_ENV` | Environment identifier | `dev` or `prod` |
| `AUTH_SECRET` | Secret for signing JWT tokens (if using JWT) | Random 32-char string |

---

## Security Considerations

1. **Authentication:**
   - MVP: simple bearer token per agency stored in KV (hashed)
   - Future: upgrade to JWT with expiration and refresh tokens

2. **Authorization:**
   - All client/report endpoints verify agency owns the resource
   - Check `client.agencyId === authenticatedAgencyId`

3. **Input Validation:**
   - Validate CSV structure and size (max 10MB)
   - Sanitize client names/emails to prevent injection
   - Rate limit API endpoints (Cloudflare rate limiting)

4. **Secrets Management:**
   - Never commit secrets to repo
   - Use Wrangler secrets for production: `wrangler secret put STRIPE_SECRET_KEY`
   - Use `.dev.vars` for local development (gitignored)

5. **Stripe Webhook Verification:**
   - Always verify signature before processing events
   - Prevent replay attacks

---

## Deployment Plan

### Phase 1: Development Environment

1. Install dependencies:
   - Node.js 18+
   - npm or yarn
   - Wrangler CLI: `npm install -g wrangler`

2. Configure Cloudflare:
   - Create KV namespace: `wrangler kv:namespace create REPORTING_KV`
   - Create R2 bucket: `wrangler r2 bucket create rapidtools-reports`
   - Update `wrangler.toml` with namespace IDs

3. Local development:
   - Create `.dev.vars` file with environment variables
   - Run `wrangler dev` to start local server
   - Test endpoints with curl or Postman

### Phase 2: Production Deployment

1. Set production secrets:
   ```bash
   wrangler secret put STRIPE_SECRET_KEY
   wrangler secret put STRIPE_WEBHOOK_SECRET
   wrangler secret put EMAIL_PROVIDER_API_KEY
   wrangler secret put AUTH_SECRET
   ```

2. Deploy worker:
   ```bash
   wrangler publish
   ```

3. Configure custom domain in Cloudflare dashboard

4. Set up Stripe webhook endpoint pointing to `https://api.rapidtools.io/api/agency/stripe/webhook`

5. Test end-to-end flow with Stripe test mode

---

## MVP Constraints & Future Enhancements

### MVP Deliberately Excludes:

- Multi-user per agency (single agency user only)
- GA4 OAuth integration (CSV upload only)
- Customizable report templates (single default template)
- White-label branding (Pro plan feature for v2)
- Advanced analytics (just core metrics)
- In-app notification system
- Client portal (clients receive PDF via email only)

### Post-MVP Roadmap (v2):

1. GA4 OAuth integration to replace CSV uploads
2. Google Search Console integration for keyword data
3. Customizable report templates with drag-and-drop builder
4. Multi-user support per agency
5. Client portal for self-service report access
6. Slack/Discord integration for notifications
7. API for third-party integrations
8. White-label option for Pro plan

---

## Metrics & Success Criteria

### Technical Metrics:

- API endpoint latency: p95 < 500ms
- PDF generation time: < 5 seconds
- Email delivery success rate: > 98%
- Cron job completion rate: 100% (with retry logic)

### Business Metrics (tracked in `~/ai-stack/rapidtools/operations/data/metrics.json`):

- MRR (Monthly Recurring Revenue)
- Churn rate
- Trial → paid conversion rate
- Average reports sent per agency per week
- Customer support ticket volume

**Target:** £2,000+ MRR within 6-12 months = 40 Starter customers OR 20 Starter + 20 Pro customers

---

**End of Architecture Document**
