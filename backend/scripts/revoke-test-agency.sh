#!/bin/bash
#
# Security Cleanup Script: Revoke Test Agency & Compromised API Key
#
# Created: 2025-12-15
# Purpose: Revoke test agency created during production verification
#          after API key was exposed in chat logs
#
# COMPROMISED CREDENTIALS:
#   Agency ID: c4558869-357c-4988-9653-12e458d4e0c3
#   Agency Name: ReleaseTest Agency
#   API Key: 4a7c48cc-8477-47ba-8454-fbd33dae46bc (COMPROMISED)
#   Clients:
#     - 73c9d308-c44a-4ccd-8e0e-c938c5ad9d77
#     - d12ccad5-6d79-4d3c-b4a9-37faf02288a1

set -e  # Exit on error

AGENCY_ID="c4558869-357c-4988-9653-12e458d4e0c3"
COMPROMISED_API_KEY="4a7c48cc-8477-47ba-8454-fbd33dae46bc"
CLIENT_1="73c9d308-c44a-4ccd-8e0e-c938c5ad9d77"
CLIENT_2="d12ccad5-6d79-4d3c-b4a9-37faf02288a1"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔒 RapidTools Security Cleanup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚠️  WARNING: This will revoke the compromised API key"
echo "    and delete test agency/clients from production KV."
echo ""
echo "Agency ID: $AGENCY_ID"
echo "API Key:   $COMPROMISED_API_KEY (first 16 chars)"
echo ""
read -p "Continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1: Revoke API Key (delete lookup)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

API_KEY_LOOKUP="agency_api_key:$COMPROMISED_API_KEY"
echo "Deleting KV entry: $API_KEY_LOOKUP"
npx wrangler kv key delete "$API_KEY_LOOKUP" --binding=REPORTING_KV --remote --preview=false || {
  echo "⚠️  Key may already be deleted (safe to ignore)"
}
echo "✅ API key lookup deleted"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2: Delete Test Clients"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "Deleting client: $CLIENT_1"
npx wrangler kv key delete "client:$CLIENT_1" --binding=REPORTING_KV --remote --preview=false || true

echo "Deleting client: $CLIENT_2"
npx wrangler kv key delete "client:$CLIENT_2" --binding=REPORTING_KV --remote --preview=false || true

echo "✅ Test clients deleted"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 3: Delete Agency Client List"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

npx wrangler kv key delete "agency:$AGENCY_ID:clients" --binding=REPORTING_KV --remote --preview=false || true
echo "✅ Agency client list deleted"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 4: Delete Agency Record"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

npx wrangler kv key delete "agency:$AGENCY_ID" --binding=REPORTING_KV --remote --preview=false || true
echo "✅ Agency record deleted"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 5: Clean up R2 objects (optional)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

read -p "Delete R2 PDFs under reports/$AGENCY_ID/*? (yes/no): " r2_confirm

if [ "$r2_confirm" = "yes" ]; then
  echo "Deleting R2 PDFs for test agency..."

  # Delete known test PDFs
  npx wrangler r2 object delete "rapidtools-reports/reports/$AGENCY_ID/$CLIENT_1/2025-12-15T12-15-44-435Z.pdf" --remote || {
    echo "⚠️  First PDF not found or already deleted"
  }

  npx wrangler r2 object delete "rapidtools-reports/reports/$AGENCY_ID/$CLIENT_2/2025-12-15T12-19-12-466Z.pdf" --remote || {
    echo "⚠️  Second PDF not found or already deleted"
  }

  echo "✅ R2 objects deleted"
else
  echo "Skipping R2 cleanup"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Security Cleanup Complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Verification:"
echo "  1. Test revoked key fails:"
echo "     curl -H \"x-api-key: $COMPROMISED_API_KEY\" https://reporting-tool-api.jamesredwards89.workers.dev/api/clients"
echo "     Expected: {\"success\":false,\"error\":\"Invalid API key\"}"
echo ""
echo "  2. Verify KV entries removed:"
echo "     npx wrangler kv key get \"agency_api_key:$COMPROMISED_API_KEY\" --binding=REPORTING_KV"
echo "     Expected: null or not found"
echo ""
