# RapidTools Reporting API

![Status](https://img.shields.io/badge/status-limited--testing-yellow)
![Version](https://img.shields.io/badge/version-1.0.0--beta-blue)

## Intended Audience

This service is designed for:
- **Marketing agencies** managing multiple client analytics accounts
- **Developers** integrating automated reporting into agency management systems
- **Automation platforms** orchestrating multi-client analytics workflows

Prerequisites: GA4 data export access, ability to generate CSV files, email infrastructure for client delivery.

## Service Overview

Automated weekly client reporting API that converts GA4 CSV analytics data into branded PDF reports delivered via email.

## API Capabilities

### Inputs
- **Format:** CSV (text/csv)
- **Source:** Google Analytics 4 timeseries exports
- **Required headers:** date, sessions, users, pageviews

### Outputs
- **Format:** PDF (application/pdf)
- **Delivery:** Email + secure HTTPS link
- **Branding:** Agency white-label customization

### Automation
- **Schedule:** Weekly (configurable cron: `0 9 * * 1`)
- **Idempotency:** Request deduplication via idempotency keys
- **Failure handling:** Automatic retry with fallback logging

## API Reference

### Authentication
- **Method:** API key (x-api-key header)
- **Scope:** Per-agency access control

### Endpoints

- `GET /api/health` - Service health check
- `POST /api/client` - Register new client
- `GET /api/clients` - List all clients for agency
- `POST /api/client/{id}/ga4-csv` - Upload GA4 CSV data
- `GET /api/client/{id}/report/preview` - Generate preview PDF
- `POST /api/client/{id}/report/send` - Send report via email

## Data Handling

### Storage
- **Metadata:** Cloudflare KV (agency/client configuration)
- **Files:** Cloudflare R2 (CSV uploads, generated PDFs)

### Retention
Minimum required for reporting purposes (CSV source files + generated PDF archives).

### Privacy
No data used for model training (training_use: false).

## Pricing
- **Model:** Monthly subscription (GBP)
- **Billing:** Flat rate per agency with client limits
- **Contact:** reports@rapidtools.dev

## Technical Stack

- **Platform:** Cloudflare Workers
- **Language:** TypeScript
- **Framework:** Hono

## Manifest
Canonical service manifest: `https://reporting.rapidtools.dev/manifest.json`

## Terms of Service
https://reporting.rapidtools.dev/terms.html

---

For implementation details and source code, see the [GitHub repository](https://github.com/builder-rapidtools/rapidtools-reporting).
