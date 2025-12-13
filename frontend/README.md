# RapidTools Frontend

Minimal, production-ready single-page onboarding application for RapidTools Automated Weekly Reports.

## Features

- **Pure HTML/CSS/JavaScript** - No build system required
- **Tailwind CDN** - Instant styling without npm
- **LocalStorage Persistence** - API keys stored locally
- **Autonomous-First Design** - API-driven workflow for agent consumption
- **Dev Mode Compatible** - Works with local backend at localhost:8787

## Project Structure

```
frontend/
├── index.html    # Main UI with 4-step onboarding flow
├── app.js        # Client-side logic and API integration
├── styles.css    # Minimal custom styles
└── README.md     # This file
```

## Running Locally

### Prerequisites

1. Backend must be running at `http://localhost:8787`
   ```bash
   cd ~/ai-stack/rapidtools/products/reporting-tool/backend
   npm run dev
   ```

### Option 1: Simple HTTP Server (Python)

```bash
cd ~/ai-stack/rapidtools/products/reporting-tool/frontend
python3 -m http.server 3000
```

Open http://localhost:3000 in your browser.

### Option 2: Simple HTTP Server (Node.js)

```bash
npx serve .
```

### Option 3: VS Code Live Server

Install "Live Server" extension and right-click `index.html` → "Open with Live Server"

## Deploying to Cloudflare Pages

### Step 1: Initialize Git Repository

```bash
cd ~/ai-stack/rapidtools/products/reporting-tool/frontend
git init
git add .
git commit -m "Initial frontend commit"
```

### Step 2: Push to GitHub

```bash
# Create a new repository on GitHub (e.g., rapidtools-frontend)
git remote add origin git@github.com:YOUR_USERNAME/rapidtools-frontend.git
git branch -M main
git push -u origin main
```

### Step 3: Deploy via Cloudflare Pages

1. Go to https://dash.cloudflare.com/
2. Navigate to **Pages** → **Create a project**
3. Select **Connect to Git**
4. Choose your GitHub repository (`rapidtools-frontend`)
5. Configure build settings:
   - **Framework preset**: None
   - **Build command**: (leave empty)
   - **Build output directory**: `/`
   - **Root directory**: (leave as root or set to `frontend` if monorepo)
6. Click **Save and Deploy**

### Step 4: Configure Production Backend URL

By default, `app.js` detects the environment:
- Local: Uses `http://localhost:8787`
- Production: Uses `https://api.rapidtools.com`

To override the backend URL, edit `app.js`:

```javascript
function getBackendUrl() {
  // Hardcode your production backend URL
  return 'https://your-backend-worker.workers.dev';
}
```

Or set it as a Cloudflare Pages environment variable and inject it via a script tag.

## User Flow

1. **Register Agency** - Enter name and email, receive API key
2. **Create Demo Client** - Generate test client data
3. **Generate Demo Report** - Upload sample GA4 CSV, preview metrics
4. **Upgrade to Paid** - Redirect to Stripe Checkout (£25/month Starter plan)

## API Integration

Frontend communicates with backend via:

- `POST /api/agency/register` - Create agency account
- `GET /api/agency/me` - Fetch agency details
- `POST /api/client` - Create client
- `POST /api/client/:id/ga4-csv` - Upload GA4 data
- `POST /api/client/:id/report/preview` - Generate report preview
- `POST /api/agency/checkout` - Create Stripe checkout session

All authenticated requests include `x-api-key` header.

## Development Notes

### Backend URL Detection

The frontend automatically detects whether it's running locally or in production:

```javascript
function getBackendUrl() {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:8787';
  }
  return 'https://api.rapidtools.com'; // Change to your production URL
}
```

### LocalStorage Keys

- `rapidtools_api_key` - API key from registration
- `rapidtools_agency_id` - Agency ID
- `rapidtools_demo_client_id` - Demo client ID for testing

### CORS Configuration

If deploying frontend and backend to different domains, ensure backend includes CORS headers:

```typescript
// In backend src/router.ts
import { cors } from 'hono/cors';

app.use('/*', cors({
  origin: ['https://your-frontend.pages.dev'],
  allowMethods: ['GET', 'POST', 'DELETE'],
  allowHeaders: ['Content-Type', 'x-api-key'],
}));
```

## Customization

### Branding

Edit `index.html`:
- Line 6: Update page title
- Line 15: Update heading
- Line 16: Update tagline
- Line 176: Update footer text

### Pricing

Edit `index.html` lines 148-158 to modify plan details and pricing.

### Styling

Add custom styles to `styles.css` or modify Tailwind classes in `index.html`.

## Troubleshooting

### Backend connection fails

1. Check backend is running: `curl http://localhost:8787/api/health`
2. Check browser console for CORS errors
3. Verify `BACKEND_URL` in `app.js` is correct

### API key not persisting

1. Check browser localStorage is enabled
2. Clear localStorage and re-register: `localStorage.clear()`

### Stripe checkout fails in dev mode

Dev mode returns mock checkout URL. Set `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID_STARTER` in backend `.dev.vars` for real Stripe integration.

## Next Steps

1. **Production Backend**: Deploy backend to Cloudflare Workers
2. **Custom Domain**: Configure custom domain for Pages deployment
3. **Analytics**: Add Cloudflare Web Analytics or Google Analytics
4. **Error Tracking**: Integrate Sentry or similar service
5. **SEO**: Add meta tags and Open Graph tags for social sharing

## Support

For issues or questions, refer to:
- Backend README: `~/ai-stack/rapidtools/products/reporting-tool/backend/README.md`
- Architecture docs: `~/ai-stack/rapidtools/ARCHITECTURE.md`
- Roadmap: `~/ai-stack/rapidtools/ROADMAP.md`
