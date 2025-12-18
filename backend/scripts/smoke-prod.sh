#!/bin/bash
#
# RapidTools Production Smoke Test Wrapper
# Safe for production - never echoes API keys
#
# Usage:
#   ./scripts/smoke-prod.sh
#
# To run authenticated tests, set environment variables BEFORE running:
#   export RAPIDTOOLS_API_KEY="your-api-key"
#   export RAPIDTOOLS_CLIENT_ID="your-client-id"
#   export RAPIDTOOLS_PDF_FILENAME="2025-12-18T12-00-00-000Z.pdf"
#   ./scripts/smoke-prod.sh
#

set -e

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed or not in PATH"
    echo "   Please install Node.js 18+ to run smoke tests"
    exit 1
fi

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 RapidTools Production Smoke Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Show configuration (NEVER log the API key)
if [ -n "$RAPIDTOOLS_BASE_URL" ]; then
    echo "Base URL: $RAPIDTOOLS_BASE_URL (override)"
else
    echo "Base URL: https://reporting-api.rapidtools.dev (default)"
fi

if [ -n "$RAPIDTOOLS_API_KEY" ]; then
    echo "API Key: ****** (set - authenticated tests enabled)"
else
    echo "API Key: (not set - only running non-auth tests)"
fi

if [ -n "$RAPIDTOOLS_CLIENT_ID" ]; then
    echo "Client ID: $RAPIDTOOLS_CLIENT_ID"
fi

if [ -n "$RAPIDTOOLS_PDF_FILENAME" ]; then
    echo "PDF Filename: $RAPIDTOOLS_PDF_FILENAME"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run the smoke tests
node "$SCRIPT_DIR/smoke-prod.js"

# Exit code is passed through from node script
