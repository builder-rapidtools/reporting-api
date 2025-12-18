#!/bin/bash
#
# Setup test data and run smoke tests
#

set -e

cd "$(dirname "$0")/.."

echo "📝 Creating test CSV data..."

cat > test-ga4-data.csv << 'CSVEOF'
date,sessions,users,pageviews,bounceRate,avgSessionDuration
2025-12-01,100,80,250,0.45,120
2025-12-02,120,95,280,0.42,135
2025-12-03,110,85,260,0.44,125
2025-12-04,105,82,255,0.43,122
2025-12-05,115,90,270,0.41,130
CSVEOF

echo "✅ Created test-ga4-data.csv"
echo ""

echo "📤 Uploading CSV to production (as raw body, not form data)..."
UPLOAD_RESULT=$(curl -s -X POST \
  https://reporting-api.rapidtools.dev/api/client/cdef8c62-9d99-49fc-9811-3860e66c45e3/ga4-csv \
  -H "x-api-key: de7aa94c-87fa-4252-82db-cc4b537529f9" \
  -H "Content-Type: text/csv" \
  --data-binary @test-ga4-data.csv)

echo "$UPLOAD_RESULT"
echo ""

if echo "$UPLOAD_RESULT" | grep -q '"ok":true'; then
  echo "✅ CSV uploaded successfully"
  echo ""
  echo "⏳ Waiting 3 seconds for PDF generation..."
  sleep 3
  echo ""
  echo "🧪 Running authenticated smoke tests..."
  echo ""
  ./scripts/run-smoke-tests-prod.sh
else
  echo "❌ Upload failed"
  exit 1
fi
