# WWWMW API - What's Wrong With My Website

A standalone TypeScript Cloudflare Worker API that scans websites and returns comprehensive health reports.

**Live API:** https://wwwmw.captainpragmatic.com
**Frontend:** https://captainpragmatic.com/tools/website-scanner

## Features

- **8 Diagnostic Checks**: SSL, DNS, PageSpeed, Server Response, Mobile, HTTPS, Availability, Email Config
- **100-Point Scoring System**: Automatic health score with color-coded levels
- **Real-Time Analysis**: 6-15 second response time with parallel check execution
- **Smart Recommendations**: Actionable advice based on specific issues found
- **CORS Ready**: Pre-configured for frontend integration

## Architecture

```
src/
├── index.ts              # Main handler & request routing
├── types.ts              # TypeScript interfaces
├── services/             # Diagnostic services (6 modules)
│   ├── ssl-check.ts      # HTTPS/TLS verification
│   ├── dns-speed.ts      # DNS resolution timing
│   ├── pagespeed-check.ts # Google PageSpeed API
│   ├── server-response.ts # TTFB measurement
│   ├── availability-check.ts # Up/down status
│   └── email-config.ts   # MX record lookup
└── utils/                # Helper functions
    ├── validation.ts     # URL validation
    ├── cors.ts           # CORS headers
    ├── errors.ts         # Error responses
    └── scoring.ts        # Score calculation & recommendations
```

## API Reference

### Endpoints

#### `GET /?url=<target_url>`
Scan a website and return health report.

**Parameters:**
- `url` (required): Website URL to scan (http:// or https://)

**Response:**
```json
{
  "url": "https://example.com",
  "timestamp": "2024-01-15T10:30:00Z",
  "overallScore": 85,
  "scoreLevel": "GOOD - Minor improvements needed",
  "scoreColor": "#17a2b8",
  "checks": {
    "ssl": { "status": "pass", "message": "...", "score": 10, "details": {} },
    "dns": { "status": "pass", "message": "...", "score": 10, "details": {} },
    "serverResponse": { "status": "pass", "message": "...", "score": 15, "details": {} },
    "pageSpeed": { "status": "warn", "message": "...", "score": 10, "details": {} },
    "mobile": { "status": "pass", "message": "...", "score": 15, "details": {} },
    "https": { "status": "pass", "message": "...", "score": 10, "details": {} },
    "availability": { "status": "pass", "message": "...", "score": 15, "details": {} },
    "email": { "status": "pass", "message": "...", "score": 10, "details": {} }
  },
  "criticalIssues": [],
  "recommendations": ["Consider optimizing images..."]
}
```

**Status Codes:**
- `200`: Scan successful
- `400`: Invalid URL or missing parameter
- `404`: Endpoint not found
- `500`: Internal server error

#### `GET /health`
Health check endpoint.

**Response:**
```
OK
```

## Setup

### Prerequisites

- Node.js 18+
- Cloudflare account with Workers enabled
- Google Cloud account for PageSpeed API

### Installation

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/captainpragmatic/wwwmw.git
   cd wwwmw
   npm install
   ```

2. **Login to Cloudflare:**
   ```bash
   npx wrangler login
   ```

3. **Get Google PageSpeed API Key:**
   - Go to https://console.cloud.google.com/apis/credentials
   - Enable "PageSpeed Insights API"
   - Create Credentials → API Key
   - Restrict key to PageSpeed Insights API
   - Copy the key

4. **Configure secrets for local development:**
   ```bash
   # Wrangler uses .dev.vars for local development secrets
   echo "GOOGLE_PAGESPEED_API_KEY=your_api_key_here" > .dev.vars
   ```

   **Note:** `.dev.vars` is git-ignored. Never commit API keys!

### Local Development

```bash
# Start dev server
npm run dev

# Test endpoints
curl "http://localhost:8787/health"
curl "http://localhost:8787/?url=https://google.com"
```

## Deployment

### Option 1: Automatic (GitHub Actions)

1. **Add GitHub Secrets:**
   - Go to https://github.com/captainpragmatic/wwwmw/settings/secrets/actions
   - Add `CLOUDFLARE_API_TOKEN`:
     - Cloudflare Dashboard → My Profile → API Tokens
     - Create Token → "Edit Cloudflare Workers" template
     - Zone Resources: Include → captainpragmatic.com
     - Copy token → Add as secret
   - Add `GOOGLE_PAGESPEED_API_KEY`:
     - Use API key from setup step above

2. **Deploy:**
   ```bash
   git add .
   git commit -m "Update worker"
   git push origin main
   # GitHub Actions automatically deploys!
   ```

3. **Monitor deployment:**
   - Go to https://github.com/captainpragmatic/wwwmw/actions
   - View deployment logs

### Option 2: Manual Deployment

```bash
# Deploy to production
npm run deploy
```

### Configure Production Secrets

```bash
# Set secrets in Cloudflare Workers
npx wrangler secret put GOOGLE_PAGESPEED_API_KEY
# Paste your API key when prompted
```

## DNS Configuration

Configure custom domain in Cloudflare Dashboard:

1. Log into Cloudflare
2. Select domain: `captainpragmatic.com`
3. Go to: **Workers & Pages** → **Routes**
4. Add route: `wwwmw.captainpragmatic.com/*` → Worker: `wwwmw-api`

Or configure via `wrangler.toml` (already set):
```toml
routes = [
  { pattern = "wwwmw.captainpragmatic.com/*", zone_name = "captainpragmatic.com" }
]
```

## Testing

### Manual Tests

```bash
# Health check
curl https://wwwmw.captainpragmatic.com/health

# Scan a site
curl "https://wwwmw.captainpragmatic.com/?url=https://google.com"

# Test different scenarios
curl "https://wwwmw.captainpragmatic.com/?url=http://example.com"  # HTTP site
curl "https://wwwmw.captainpragmatic.com/?url=invalid"              # Invalid URL
curl "https://wwwmw.captainpragmatic.com/"                          # Missing param
```

### Expected Results

- Response time: 6-15 seconds (mostly waiting on PageSpeed API)
- CPU time: <5ms (under Cloudflare's 10ms limit)
- All checks return real data
- CORS headers present
- Errors are user-friendly

## Scoring System

**Total: 100 points**

| Check | Points | Criteria |
|-------|--------|----------|
| SSL | 10 | HTTPS enabled & valid certificate |
| DNS | 10 | <200ms=pass, 200-500ms=warn, >500ms=fail |
| Server Response | 15 | TTFB <200ms=pass, 200-500ms=warn, >500ms=fail |
| PageSpeed | 15 | Score ≥90=pass, 50-89=warn, <50=fail |
| Mobile | 15 | Derived from PageSpeed mobile score |
| HTTPS | 10 | Secure protocol & valid SSL |
| Availability | 15 | 2xx status code |
| Email Config | 10 | MX records configured |

**Score Levels:**
- 85-100: EXCELLENT - Great website health! (green #28a745)
- 70-84: GOOD - Minor improvements needed (blue #17a2b8)
- 50-69: NEEDS WORK - Several issues to fix (yellow #ffc107)
- 0-49: POOR - Serious problems detected (red #dc3545)

## Monitoring

View analytics in Cloudflare Dashboard:
- Workers & Pages → wwwmw-api → Analytics
- Metrics: Requests, CPU time, errors, duration

Real-time logs:
```bash
npx wrangler tail
```

## Cost

**Free tier (up to 100k requests/day):**
- Cloudflare Workers: $0
- Google PageSpeed API: $0 (25,000 queries/day free)

**Expected usage:**
- <10k requests/month initially
- $0/month cost

## Troubleshooting

### API returns 500 error
- Check Cloudflare Workers logs: `npx wrangler tail`
- Verify `GOOGLE_PAGESPEED_API_KEY` secret is set
- Check PageSpeed API quota: https://console.cloud.google.com/apis/api/pagespeedonline.googleapis.com/quotas

### CORS errors in browser
- Verify CORS origin in `src/utils/cors.ts`
- Check response headers include `Access-Control-Allow-Origin`

### PageSpeed check times out
- API has 30-second timeout
- Slow sites may exceed this
- System gracefully degrades (returns warning with 8 points)

### DNS checks fail
- Cloudflare DNS-over-HTTPS may be blocked in some networks
- Check firewall rules

## Development

### Project Structure

- `src/index.ts` - Main entry point, routes requests
- `src/services/` - Each check is isolated in its own module
- `src/utils/` - Shared utilities (validation, scoring, CORS)
- `src/types.ts` - TypeScript type definitions

### Adding a New Check

1. Create service file: `src/services/new-check.ts`
2. Export async function returning `CheckResult`
3. Import in `src/index.ts` and add to `Promise.all()`
4. Update scoring in `src/utils/scoring.ts`
5. Add points to total (adjust other checks to maintain 100 points)

### Code Style

- TypeScript strict mode enabled
- Async/await for all I/O
- 5-30 second timeouts on external calls
- Graceful degradation on API failures
- Never expose API keys in responses

## Frontend Integration

See: https://github.com/captainpragmatic/captainpragmatic.com

Update `assets/js/tools/website-scanner-alpine.js`:

```javascript
async scan() {
  this.isScanning = true;

  try {
    const response = await fetch(
      `https://wwwmw.captainpragmatic.com/?url=${encodeURIComponent(this.inputs.url)}`
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    this.results = this.formatResults(data);
    this.showResults = true;
  } catch (error) {
    alert(`Scan failed: ${error.message}`);
  } finally {
    this.isScanning = false;
  }
}
```

## License

MIT

## Support

Issues: https://github.com/captainpragmatic/wwwmw/issues
Main site: https://captainpragmatic.com
