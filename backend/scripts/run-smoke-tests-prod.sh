#!/bin/bash
#
# Run authenticated production smoke tests
# Uses existing production credentials
#

set -e

echo "🧪 Running authenticated production smoke tests..."
echo ""

# Production test credentials (Smoke Test Agency)
export RAPIDTOOLS_BASE_URL="https://reporting-api.rapidtools.dev"
export RAPIDTOOLS_API_KEY="de7aa94c-87fa-4252-82db-cc4b537529f9"
export RAPIDTOOLS_CLIENT_ID="cdef8c62-9d99-49fc-9811-3860e66c45e3"
export RAPIDTOOLS_PDF_FILENAME="2025-12-18T17-22-37-912Z.pdf"

# Run the smoke tests
./scripts/smoke-prod.sh
