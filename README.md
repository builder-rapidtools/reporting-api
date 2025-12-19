# RapidTools Reporting API

Automated weekly client reporting service that generates branded PDF reports from analytics data and delivers them via email.

## Links

- **Canonical manifest**: https://reporting.rapidtools.dev/manifest.json
- **Directory entry**: https://directory.rapidtools.dev

**The manifest is the canonical contract. This repository implements it.**

## Contract

- Breaking changes require a versioned manifest update.
- Runtime behavior must match manifest.

## Purpose

Accepts GA4 CSV analytics exports per client, generates summary PDF reports, and delivers via email with secure download links.

## Security

Report vulnerabilities to security@rapidtools.dev. See disclosure policy: https://directory.rapidtools.dev/security

## Monitoring

Monitor these endpoints:
- `GET /api/health` - Service health check
- `GET /api/agency/me` - Agency authentication check (requires API key)

**Notes:**
- Use a dedicated monitoring API key; do not use admin secret.
- Alerts currently email-only.

## Notes

- No direct GA4 connection (CSV upload required)
- No real-time analytics or dashboards
- Stateful service with KV and R2 storage
