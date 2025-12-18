# Contract Tests

Contract tests for the RapidTools Reporting API.

## Running Tests

### Prerequisites

Set required environment variables:

```bash
export TEST_BASE_URL="https://reporting-tool-api.jamesredwards89.workers.dev"
export TEST_API_KEY="your-api-key"
export TEST_CLIENT_ID="your-client-id"
```

### Run All Tests

```bash
npm test
```

### Run Specific Test File

```bash
npm test tests/idempotency-contract.test.ts
```

### Run in Watch Mode

```bash
npm test -- --watch
```

## Test Files

### `idempotency-contract.test.ts`

Tests idempotency behavior for the `/api/client/:id/report/send` endpoint:

- **Same key + same payload** → Returns cached response with `replayed: true`
- **Same key + different payload** → Returns `409 IDEMPOTENCY_KEY_REUSE_MISMATCH`
- **Different keys + same payload** → Creates new reports (not cached)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TEST_BASE_URL` | No | API base URL (default: https://reporting-tool-api.jamesredwards89.workers.dev) |
| `TEST_API_KEY` | Yes | Valid API key for testing |
| `TEST_CLIENT_ID` | Yes | Valid client ID with uploaded GA4 data |

**Note**: Tests will be skipped if `TEST_API_KEY` or `TEST_CLIENT_ID` are not set.

## CI/CD Integration

For CI/CD pipelines, set environment variables as secrets:

```yaml
env:
  TEST_BASE_URL: https://reporting-tool-api.jamesredwards89.workers.dev
  TEST_API_KEY: ${{ secrets.TEST_API_KEY }}
  TEST_CLIENT_ID: ${{ secrets.TEST_CLIENT_ID }}
```

## Test Data Requirements

The `TEST_CLIENT_ID` must:
- Belong to an agency with an active or trial subscription
- Have GA4 CSV data uploaded
- Be accessible with the provided `TEST_API_KEY`
