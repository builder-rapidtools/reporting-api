# Deployment Checklist: Admin API Key Rotation Endpoint

## Pre-Deployment

- [x] TypeScript compilation passes (`npm run typecheck`)
- [x] Handler created: `src/handlers/admin-rotate-agency-key.ts`
- [x] Route registered in `src/router.ts`
- [x] `ADMIN_SECRET` added to `Env` interface
- [x] Documentation added to `README.md`
- [x] Test script created: `scripts/test-admin-rotate-key.sh`

## Deployment Steps

### 1. Configure Admin Secret

**IMPORTANT**: Set `ADMIN_SECRET` in production before deploying.

```bash
cd ~/ai-stack/rapidtools/products/reporting-tool/backend
wrangler secret put ADMIN_SECRET
```

When prompted, enter a strong secret (recommend: 32+ character random string).

### 2. Deploy Worker

```bash
npm run build  # If build step exists
wrangler deploy
```

### 3. Verify Deployment

Check health endpoint:

```bash
curl https://reporting-tool-api.jamesredwards89.workers.dev/api/health
```

Expected response:
```json
{
  "status": "ok",
  "env": "prod",
  "timestamp": "2025-12-15T..."
}
```

### 4. Test Admin Endpoint

Run the test script:

```bash
./scripts/test-admin-rotate-key.sh
```

Or manually test with curl:

```bash
# Test 1: Missing secret (expect 403)
curl -X POST https://reporting-tool-api.jamesredwards89.workers.dev/api/admin/agency/AGENCY_ID/rotate-key

# Test 2: Valid request (expect 200)
curl -X POST https://reporting-tool-api.jamesredwards89.workers.dev/api/admin/agency/AGENCY_ID/rotate-key \
  -H "x-admin-secret: YOUR_ADMIN_SECRET"
```

## Post-Deployment

- [ ] Verify old scripts still work: `./scripts/fix-and-verify-agency-key.sh`
- [ ] Verify old scripts still work: `./scripts/recover-agency-api-key.sh`
- [ ] Test admin endpoint with valid agency ID
- [ ] Test admin endpoint with invalid agency ID (expect 404)
- [ ] Test admin endpoint without auth (expect 403)
- [ ] Verify new API key works after rotation

## Rollback Procedure

If issues occur:

```bash
# 1. Revert to previous deployment
git checkout <previous-commit-sha>
wrangler deploy

# 2. Or rollback via Cloudflare Dashboard:
# - Navigate to Workers & Pages → reporting-tool-api → Deployments
# - Click "Rollback" on previous deployment
```

## Security Notes

- `ADMIN_SECRET` is stored as a Cloudflare Worker secret (encrypted at rest)
- Secrets are never logged or returned in responses
- Admin endpoint has no rate limiting (consider adding if needed)
- Only administrators should have access to `ADMIN_SECRET`

## Emergency Key Rotation

If `ADMIN_SECRET` is compromised:

```bash
# Immediately rotate the admin secret
wrangler secret put ADMIN_SECRET

# Verify new secret works
./scripts/test-admin-rotate-key.sh
```

## Files Changed

### New Files
- `src/handlers/admin-rotate-agency-key.ts` - Admin handler
- `scripts/test-admin-rotate-key.sh` - Test script
- `scripts/example-rotate-key-curl.sh` - Example usage
- `DEPLOYMENT-CHECKLIST-ADMIN-ENDPOINT.md` - This file

### Modified Files
- `src/types.ts` - Added `ADMIN_SECRET` to `Env`
- `src/router.ts` - Registered admin endpoint
- `README.md` - Added admin endpoint documentation
- `scripts/README.md` - Added test script documentation

## Integration with Existing Scripts

The admin endpoint complements existing scripts:

1. **fix-and-verify-agency-key.sh**: Interactive rotation with current key
2. **recover-agency-api-key.sh**: Hardcoded agency rotation
3. **Admin endpoint**: Programmatic rotation via HTTP API

All three methods achieve the same result: rotating an agency's API key safely.

## Support

For issues or questions:
- Check logs: `wrangler tail`
- Review handler: `src/handlers/admin-rotate-agency-key.ts`
- Test locally: `npm run dev` then test against localhost:8787
