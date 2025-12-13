/**
 * RapidTools Frontend - Onboarding Flow
 * Pure JavaScript with localStorage for API key management
 */

// Configuration
const BACKEND_URL = getBackendUrl();

// State
let apiKey = localStorage.getItem('rapidtools_api_key') || null;
let agencyId = localStorage.getItem('rapidtools_agency_id') || null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initializeUI();
  attachEventListeners();
});

/**
 * Detect backend URL based on environment
 */
function getBackendUrl() {
  // Check if running locally
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:8787';
  }

  // Production: Assume backend is deployed at api subdomain
  // e.g., frontend at rapidtools.pages.dev, backend at api.rapidtools.com
  return 'https://api.rapidtools.com';
}

/**
 * Initialize UI based on stored API key
 */
function initializeUI() {
  if (apiKey && agencyId) {
    // User already registered - show agency details
    fetchAndDisplayAgency();
    unlockAuthSections();
  }
}

/**
 * Attach event listeners to buttons
 */
function attachEventListeners() {
  // Registration
  document.getElementById('register-btn').addEventListener('click', handleRegister);

  // Copy API key
  document.getElementById('copy-api-key').addEventListener('click', copyApiKey);

  // Demo client
  document.getElementById('create-demo-client-btn').addEventListener('click', handleCreateDemoClient);

  // Demo report
  document.getElementById('generate-demo-report-btn').addEventListener('click', handleGenerateDemoReport);

  // Upgrade
  document.getElementById('upgrade-btn').addEventListener('click', handleUpgrade);
}

/**
 * Handle agency registration
 */
async function handleRegister() {
  const nameInput = document.getElementById('agency-name');
  const emailInput = document.getElementById('billing-email');
  const registerBtn = document.getElementById('register-btn');

  const name = nameInput.value.trim();
  const email = emailInput.value.trim();

  // Validation
  if (!name || !email) {
    showStatus('Please fill in all fields', 'error');
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showStatus('Invalid email format', 'error');
    return;
  }

  // Disable button during request
  registerBtn.disabled = true;
  registerBtn.textContent = 'Registering...';

  try {
    const response = await postJSON('/api/agency/register', { name, email });

    if (!response.success) {
      throw new Error(response.error || 'Registration failed');
    }

    const { agency } = response;

    // Store credentials
    apiKey = agency.apiKey;
    agencyId = agency.id;
    localStorage.setItem('rapidtools_api_key', apiKey);
    localStorage.setItem('rapidtools_agency_id', agencyId);

    // Update UI
    displayAgencyDetails(agency);
    unlockAuthSections();

    showStatus('Registration successful!', 'success');
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = 'Generate API Key';
  }
}

/**
 * Fetch and display agency details (for returning users)
 */
async function fetchAndDisplayAgency() {
  try {
    const response = await getJSON('/api/agency/me');

    if (response.success && response.agency) {
      displayAgencyDetails(response.agency);
    }
  } catch (error) {
    console.error('Failed to fetch agency:', error);
    // If auth fails, clear stored credentials
    localStorage.removeItem('rapidtools_api_key');
    localStorage.removeItem('rapidtools_agency_id');
    apiKey = null;
    agencyId = null;
  }
}

/**
 * Display agency details in UI
 */
function displayAgencyDetails(agency) {
  document.getElementById('agency-id').textContent = agency.id;
  document.getElementById('api-key').textContent = agency.apiKey;
  document.getElementById('subscription-status').textContent = agency.subscriptionStatus;

  // Show the details section
  document.getElementById('agency-details').classList.remove('hidden');
}

/**
 * Copy API key to clipboard
 */
function copyApiKey() {
  const apiKeyElement = document.getElementById('api-key');
  const apiKeyText = apiKeyElement.textContent;

  navigator.clipboard.writeText(apiKeyText).then(() => {
    showStatus('API key copied to clipboard', 'success');
  }).catch(err => {
    showStatus('Failed to copy API key', 'error');
    console.error('Copy failed:', err);
  });
}

/**
 * Unlock authenticated sections
 */
function unlockAuthSections() {
  const authSections = document.querySelectorAll('[data-requires-auth]');
  authSections.forEach(section => {
    section.classList.remove('opacity-50', 'pointer-events-none');
  });
}

/**
 * Handle demo client creation
 * TODO: Backend needs POST /api/demo/client endpoint
 */
async function handleCreateDemoClient() {
  const btn = document.getElementById('create-demo-client-btn');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    // For now, create a real client with demo data
    const response = await postJSON('/api/client', {
      name: 'Demo Client',
      email: 'demo@example.com',
      reportSchedule: 'weekly'
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to create demo client');
    }

    const { client } = response;

    // Store demo client ID for report generation
    localStorage.setItem('rapidtools_demo_client_id', client.id);

    // Display demo client details
    document.getElementById('demo-client-id').textContent = client.id;
    document.getElementById('demo-client-details').classList.remove('hidden');

    showStatus('Demo client created successfully', 'success');
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Demo Client';
  }
}

/**
 * Handle demo report generation
 * TODO: Backend needs POST /api/demo/ga4-csv and POST /api/demo/report endpoints
 */
async function handleGenerateDemoReport() {
  const btn = document.getElementById('generate-demo-report-btn');
  const demoClientId = localStorage.getItem('rapidtools_demo_client_id');

  if (!demoClientId) {
    showStatus('Please create a demo client first', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Generating...';

  try {
    // Step 1: Upload demo GA4 CSV data
    const demoCSV = generateDemoCSV();

    const uploadResponse = await fetch(`${BACKEND_URL}/api/client/${demoClientId}/ga4-csv`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/csv',
        'x-api-key': apiKey
      },
      body: demoCSV
    });

    const uploadResult = await uploadResponse.json();

    if (!uploadResult.success) {
      throw new Error(uploadResult.error || 'Failed to upload demo data');
    }

    // Step 2: Generate preview
    const previewResponse = await postJSON(`/api/client/${demoClientId}/report/preview`, {});

    if (!previewResponse.success) {
      throw new Error(previewResponse.error || 'Failed to generate report preview');
    }

    // Display report details
    const { preview } = previewResponse;
    document.getElementById('pdf-key').textContent = `Preview generated for ${preview.metrics.sessions} sessions`;
    document.getElementById('report-status').textContent = 'Ready';

    // For dev mode, show a mock download link
    const downloadLink = document.getElementById('pdf-download-link');
    downloadLink.href = '#';
    downloadLink.textContent = 'View Report Preview (JSON)';
    downloadLink.onclick = (e) => {
      e.preventDefault();
      alert(JSON.stringify(preview.metrics, null, 2));
    };

    document.getElementById('report-details').classList.remove('hidden');

    showStatus('Demo report generated successfully', 'success');
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Demo Report';
  }
}

/**
 * Generate demo CSV data
 */
function generateDemoCSV() {
  const today = new Date();
  const rows = [];

  // Header
  rows.push('date,sessions,users,pageviews,page_path,page_views');

  // Generate 7 days of demo data
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const sessions = 100 + Math.floor(Math.random() * 50);
    const users = 80 + Math.floor(Math.random() * 40);
    const pageviews = 300 + Math.floor(Math.random() * 100);

    rows.push(`${dateStr},${sessions},${users},${pageviews},,`);
  }

  // Add some page-specific data
  rows.push(`${today.toISOString().split('T')[0]},,,,/home,150`);
  rows.push(`${today.toISOString().split('T')[0]},,,,/about,80`);
  rows.push(`${today.toISOString().split('T')[0]},,,,/contact,45`);

  return rows.join('\n');
}

/**
 * Handle upgrade flow
 */
async function handleUpgrade() {
  const btn = document.getElementById('upgrade-btn');
  btn.disabled = true;
  btn.textContent = 'Redirecting...';

  try {
    const response = await postJSON('/api/agency/checkout', {});

    if (!response.success) {
      throw new Error(response.error || 'Failed to create checkout session');
    }

    const { checkoutUrl } = response;

    // Redirect to Stripe Checkout
    window.location.href = checkoutUrl;
  } catch (error) {
    showStatus(error.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Upgrade Now';
  }
}

/**
 * Helper: POST JSON to backend
 */
async function postJSON(endpoint, data) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const response = await fetch(`${BACKEND_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return await response.json();
}

/**
 * Helper: GET JSON from backend
 */
async function getJSON(endpoint) {
  const headers = {};

  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const response = await fetch(`${BACKEND_URL}${endpoint}`, {
    method: 'GET',
    headers
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return await response.json();
}

/**
 * Show status message
 */
function showStatus(message, type = 'info') {
  const container = document.getElementById('status-container');

  const statusDiv = document.createElement('div');
  statusDiv.className = `px-4 py-3 rounded-md shadow-lg ${
    type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' :
    type === 'error' ? 'bg-red-100 text-red-800 border border-red-200' :
    'bg-blue-100 text-blue-800 border border-blue-200'
  }`;
  statusDiv.textContent = message;

  container.appendChild(statusDiv);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    statusDiv.remove();
  }, 5000);
}
