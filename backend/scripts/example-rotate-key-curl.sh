#!/bin/bash
# Example: Rotate agency API key using admin endpoint
# Replace ADMIN_SECRET and AGENCY_ID with actual values

ADMIN_SECRET="your-admin-secret-here"
AGENCY_ID="0700c1a2-c15d-4d36-baaf-5a94e84b5c15"
WORKER_URL="https://reporting-tool-api.jamesredwards89.workers.dev"

curl -X POST "$WORKER_URL/api/admin/agency/$AGENCY_ID/rotate-key" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  | jq .
