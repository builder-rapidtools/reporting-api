#!/bin/bash
#
# Generate a PDF report for testing
#

set -e

echo "📄 Generating PDF report for client..."

RESULT=$(curl -s -X POST \
  https://reporting-api.rapidtools.dev/api/client/cdef8c62-9d99-49fc-9811-3860e66c45e3/report/send \
  -H "x-api-key: de7aa94c-87fa-4252-82db-cc4b537529f9" \
  -H "Content-Type: application/json")

echo "$RESULT" | python3 -m json.tool 2>/dev/null || echo "$RESULT"
echo ""

if echo "$RESULT" | grep -q '"ok":true'; then
  echo "✅ Report generated successfully"

  # Extract the filename from the response
  FILENAME=$(echo "$RESULT" | grep -o '"filename":"[^"]*"' | cut -d'"' -f4)

  if [ -n "$FILENAME" ]; then
    echo "📝 PDF filename: $FILENAME"
    echo ""
    echo "To run smoke tests with this PDF:"
    echo "export RAPIDTOOLS_PDF_FILENAME=\"$FILENAME\""
    echo "./scripts/run-smoke-tests-prod.sh"
  fi
else
  echo "❌ Report generation failed"
  exit 1
fi
