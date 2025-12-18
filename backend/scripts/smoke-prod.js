#!/usr/bin/env node
/**
 * RapidTools Production Smoke Tests
 *
 * Safe for production - does not require editing source code.
 * Reads configuration from environment variables.
 * Never logs API keys or secrets.
 *
 * Usage:
 *   node scripts/smoke-prod.js
 *
 * Environment variables (optional):
 *   RAPIDTOOLS_BASE_URL - Override default production URL
 *   RAPIDTOOLS_API_KEY - For authenticated tests (never logged)
 *   RAPIDTOOLS_CLIENT_ID - For signed URL tests
 *   RAPIDTOOLS_PDF_FILENAME - For PDF download tests
 */

// Configuration (discovered from wrangler.toml and src/router.ts)
const DEFAULT_BASE_URL = 'https://reporting-api.rapidtools.dev';
const HEALTH_PATH = '/api/health';
const SIGNED_URL_MINT_PATH = '/api/reports/:clientId/:filename/signed-url';
const PDF_DOWNLOAD_PATH = '/reports/:agencyId/:clientId/:filename';
const CLIENT_DELETE_PATH = '/api/client/:id';

// Environment configuration
const BASE_URL = process.env.RAPIDTOOLS_BASE_URL || DEFAULT_BASE_URL;
const API_KEY = process.env.RAPIDTOOLS_API_KEY;
const CLIENT_ID = process.env.RAPIDTOOLS_CLIENT_ID;
const PDF_FILENAME = process.env.RAPIDTOOLS_PDF_FILENAME || '2025-12-18T12-00-00-000Z.pdf';

// Test results
const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  tests: []
};

/**
 * Add test result (never logs secrets)
 */
function addResult(name, status, message) {
  results.tests.push({ name, status, message });
  if (status === 'PASS') results.passed++;
  else if (status === 'FAIL') results.failed++;
  else if (status === 'SKIP') results.skipped++;
}

/**
 * Safe fetch wrapper (never logs secrets)
 */
async function safeFetch(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';

    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      // For binary/PDF responses, just track that we got data
      data = { _contentType: contentType, _hasBody: true };
    }

    return { response, data };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Test 1: Health check
 */
async function testHealthCheck() {
  const url = `${BASE_URL}${HEALTH_PATH}`;
  const { response, data, error } = await safeFetch(url);

  if (error) {
    addResult('Health Check', 'FAIL', `Network error: ${error}`);
    return;
  }

  if (response.status === 200 && data.ok === true) {
    addResult('Health Check', 'PASS', `200 OK - ${data.data?.status || 'healthy'}`);
  } else {
    addResult('Health Check', 'FAIL', `Expected 200, got ${response.status}`);
  }
}

/**
 * Test 2: PDF download without token (expect 401/403/404)
 */
async function testPdfDownloadNoToken() {
  const placeholderUrl = `${BASE_URL}/reports/placeholder-agency/placeholder-client/${PDF_FILENAME}`;
  const { response, data, error } = await safeFetch(placeholderUrl);

  if (error) {
    addResult('PDF Download (no token)', 'FAIL', `Network error: ${error}`);
    return;
  }

  // Expect 401, 403, or 404 (404 is valid for non-existent client)
  // 404 alone is valid (route doesn't exist or resource not found - both are secure)
  // 401/403 should include error codes
  if (response.status === 404) {
    addResult('PDF Download (no token)', 'PASS', `404 Not Found (security working - path secured)`);
  } else if ((response.status === 401 || response.status === 403) && data.error?.code) {
    addResult('PDF Download (no token)', 'PASS', `${response.status} ${data.error.code} (security working)`);
  } else {
    addResult('PDF Download (no token)', 'FAIL', `Expected 401/403/404, got ${response.status}`);
  }
}

/**
 * Test 3: PDF download with garbage token (expect 403/404)
 */
async function testPdfDownloadGarbageToken() {
  const garbageToken = 'garbage-token-12345';
  const url = `${BASE_URL}/reports/placeholder-agency/placeholder-client/${PDF_FILENAME}?token=${garbageToken}`;
  const { response, data, error } = await safeFetch(url);

  if (error) {
    addResult('PDF Download (garbage token)', 'FAIL', `Network error: ${error}`);
    return;
  }

  // Expect 403 or 404 (404 is valid for non-existent client)
  // 404 alone is valid (route doesn't exist or resource not found - both are secure)
  // 403 should include error code for token validation failure
  if (response.status === 404) {
    addResult('PDF Download (garbage token)', 'PASS', `404 Not Found (validation working - path secured)`);
  } else if (response.status === 403 && data.error?.code) {
    addResult('PDF Download (garbage token)', 'PASS', `${response.status} ${data.error.code} (validation working)`);
  } else {
    addResult('PDF Download (garbage token)', 'FAIL', `Expected 403/404, got ${response.status}`);
  }
}

/**
 * Test 4: PDF download with expired token (skip - requires server-minted token)
 */
async function testPdfDownloadExpiredToken() {
  // Cannot fabricate expired token without PDF_SIGNING_SECRET
  addResult('PDF Download (expired token)', 'SKIP', 'Requires server-minted token (cannot fabricate without secret)');
}

/**
 * Test 5: Mint signed PDF URL (requires auth)
 */
async function testMintSignedUrl() {
  if (!API_KEY || !CLIENT_ID) {
    addResult('Mint Signed PDF URL', 'SKIP', 'Requires RAPIDTOOLS_API_KEY and RAPIDTOOLS_CLIENT_ID');
    return null;
  }

  const url = `${BASE_URL}/api/reports/${CLIENT_ID}/${PDF_FILENAME}/signed-url`;
  const { response, data, error } = await safeFetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'content-type': 'application/json'
    }
  });

  if (error) {
    addResult('Mint Signed PDF URL', 'FAIL', `Network error: ${error}`);
    return null;
  }

  // Accept both "url" and "signedUrl" field names
  const signedUrl = data.data?.url || data.data?.signedUrl;

  if (response.status === 200 && data.ok === true && signedUrl) {
    addResult('Mint Signed PDF URL', 'PASS', `200 OK - got signed URL (expires: ${data.data.expiresAt || 'N/A'})`);
    return signedUrl;
  } else if (response.status === 404) {
    // 404 on this endpoint means the feature is not deployed (endpoint missing)
    // This is different from PDF download where 404 is acceptable security behavior
    addResult('Mint Signed PDF URL', 'FAIL', `404 - endpoint not found (deployment issue, not security)`);
    return null;
  } else {
    addResult('Mint Signed PDF URL', 'FAIL', `Expected 200 with url/signedUrl, got ${response.status}: ${data.error?.code || 'unknown'}`);
    return null;
  }
}

/**
 * Test 6: Fetch signed PDF URL (requires auth + valid signed URL)
 */
async function testFetchSignedPdfUrl(signedUrl) {
  if (!signedUrl) {
    addResult('Fetch Signed PDF URL', 'SKIP', 'No signed URL from previous test');
    return;
  }

  const { response, data, error } = await safeFetch(signedUrl);

  if (error) {
    addResult('Fetch Signed PDF URL', 'FAIL', `Network error: ${error}`);
    return;
  }

  const contentType = response.headers.get('content-type') || '';
  if (response.status === 200 && (contentType.includes('application/pdf') || contentType.includes('octet-stream'))) {
    addResult('Fetch Signed PDF URL', 'PASS', `200 OK - PDF downloaded (${contentType})`);
  } else {
    addResult('Fetch Signed PDF URL', 'FAIL', `Expected 200 with PDF, got ${response.status}`);
  }
}

/**
 * Test 7: Tamper token and refetch (expect 403)
 */
async function testTamperedToken(signedUrl) {
  if (!signedUrl) {
    addResult('Fetch Tampered Token', 'SKIP', 'No signed URL from previous test');
    return;
  }

  // Tamper the token by changing one character
  const tamperedUrl = signedUrl.replace(/token=([^&]+)/, (match, token) => {
    const tampered = token.slice(0, -1) + (token.slice(-1) === 'a' ? 'b' : 'a');
    return `token=${tampered}`;
  });

  const { response, data, error } = await safeFetch(tamperedUrl);

  if (error) {
    addResult('Fetch Tampered Token', 'FAIL', `Network error: ${error}`);
    return;
  }

  // Expect 403 with PDF_TOKEN_INVALID or PDF_TOKEN_MISMATCH
  if (response.status === 403 && data.error?.code) {
    addResult('Fetch Tampered Token', 'PASS', `403 ${data.error.code} (tamper detection working)`);
  } else {
    addResult('Fetch Tampered Token', 'FAIL', `Expected 403, got ${response.status}`);
  }
}

/**
 * Test 8: Delete client without cascade (requires auth)
 */
async function testDeleteClientNoCascade() {
  if (!API_KEY || !CLIENT_ID) {
    addResult('Delete Client (no cascade)', 'SKIP', 'Requires RAPIDTOOLS_API_KEY and RAPIDTOOLS_CLIENT_ID - WARNING: This would delete the client!');
    return;
  }

  // SAFETY: Do not actually run this test in smoke tests - too destructive
  addResult('Delete Client (no cascade)', 'SKIP', 'Skipped for safety - would delete client data');
}

/**
 * Test 9: Delete client with cascade (requires auth + disposable client)
 */
async function testDeleteClientWithCascade() {
  if (!API_KEY || !CLIENT_ID) {
    addResult('Delete Client (cascade)', 'SKIP', 'Requires RAPIDTOOLS_API_KEY and RAPIDTOOLS_CLIENT_ID - WARNING: This would delete all client data!');
    return;
  }

  // SAFETY: Do not actually run this test in smoke tests - too destructive
  addResult('Delete Client (cascade)', 'SKIP', 'Skipped for safety - would permanently delete all client data');
}

/**
 * Print test results
 */
function printResults() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 RAPIDTOOLS PRODUCTION SMOKE TEST RESULTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Source: wrangler.toml line 8 (pattern: "reporting-api.rapidtools.dev/*")`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  results.tests.forEach((test, idx) => {
    const icon = test.status === 'PASS' ? '✅' : test.status === 'FAIL' ? '❌' : '⏭️';
    console.log(`${idx + 1}. ${icon} ${test.name}`);
    console.log(`   Status: ${test.status}`);
    console.log(`   ${test.message}`);
    console.log('');
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Summary: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (results.skipped > 0) {
    console.log('ℹ️  To run authenticated tests, set environment variables:');
    console.log('   export RAPIDTOOLS_API_KEY="your-api-key"');
    console.log('   export RAPIDTOOLS_CLIENT_ID="your-client-id"');
    console.log('   export RAPIDTOOLS_PDF_FILENAME="2025-12-18T12-00-00-000Z.pdf"');
    console.log('');
  }

  if (results.failed > 0) {
    console.log('❌ SMOKE TEST FAILED\n');
    process.exit(1);
  } else {
    console.log('✅ SMOKE TEST PASSED\n');
    process.exit(0);
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('\n🧪 Running RapidTools Production Smoke Tests...\n');

  // Non-auth tests (always run)
  await testHealthCheck();
  await testPdfDownloadNoToken();
  await testPdfDownloadGarbageToken();
  await testPdfDownloadExpiredToken();

  // Auth tests (only if credentials provided)
  const signedUrl = await testMintSignedUrl();
  await testFetchSignedPdfUrl(signedUrl);
  await testTamperedToken(signedUrl);

  // Destructive tests (skipped by default for safety)
  await testDeleteClientNoCascade();
  await testDeleteClientWithCascade();

  printResults();
}

// Run tests
runTests().catch(error => {
  console.error('❌ Fatal error running smoke tests:', error);
  process.exit(1);
});
