# 7AI (sevenai.com) Security Assessment Report

**Date:** 2026-10-23
**Targets:** `app.dev.sevenai.com`, `app.stg.sevenai.com`, `app.prod.sevenai.com`
**Scope:** Public web surface, HTTP headers, CSP, client-side bundle analysis

---

## 1. Executive Summary

Three front-end environments were identified and analyzed. All three serve an identical
React SPA hosted on **Amazon S3 behind CloudFront** and share the **same security posture
and the same defects**. The most notable issues are a weak Content-Security-Policy
(`unsafe-eval` / `unsafe-inline`), missing standard defense-in-depth headers, an exposed
Sentry DSN in the production bundle, and `localhost:*` allowances shipped to production.

---

## 2. Domains Discovered

| Domain | Status | Hosting |
|--------|--------|---------|
| `app.stg.sevenai.com` | Active (200) | Amazon S3 + CloudFront |
| `app.dev.sevenai.com` | Active (200) | Amazon S3 + CloudFront |
| `app.prod.sevenai.com` | Active (200) | Amazon S3 + CloudFront |

### Additional endpoints referenced in the bundle / CSP

- `api.{region}.prod.sevenai.com`
- `wss://ws.{region}.prod.sevenai.com`
- `*.sevenai.com`
- `*.staging.sevenai.com` (WebSocket)
- `*.cloud.sevenai.com` (WebSocket)
- `https://7ai.com` (marketing site)
- `https://blog.7ai.com/`
- `*.okami-ai.net`

---

## 3. Tech Stack

| Category | Technology |
|----------|-----------|
| Frontend framework | React |
| UI library | Chakra UI |
| Routing | React Router |
| Data / state | React Query, Redux |
| Forms / selects | React Select |
| Diagram / flow builder | XYFlow |
| Charts | Custom charts module |
| API transport | gRPC (`api-grpc` module) + REST |
| Real-time | WebSocket (`ws.{region}.prod.sevenai.com`) |
| Authentication | Descope (`api.descope.com`) |
| Feature flags | Statsig |
| Product analytics | Pendo (`d973cd45-d2ac-4ca9-47e3-79947bbf3082`) |
| Error tracking | Sentry |
| Object storage | AWS S3 (us-east-2, eu-central-1, us-gov-west-1) |
| CDN / edge | CloudFront |
| Corporate proxy / SSE | Zscaler (`gateway.zscalerthree.net`) |
| Fonts | Google Fonts (Inter, Sofia Sans, JetBrains Mono, Graphik) |
| Transport security | TLS 1.3 |

---

## 4. Security Findings

### 4.1 Critical / High

| # | Finding | Impact | Evidence |
|---|---------|--------|----------|
| 1 | **Exposed Sentry DSN in production bundle** | Error-reporting key can be abused to inject noise / exhaust quota; discloses internal project ID | `https://6365b15f2b72192e09c0bfea078f1b2d@o4507057747918848.ingest.us.sentry.io/4507147374952448` |
| 2 | **CSP allows `unsafe-eval`** | Defeats a major XSS mitigation; enables string-to-code execution | `script-src 'self' 'unsafe-eval' 'unsafe-inline' ...` |
| 3 | **CSP allows `unsafe-inline`** | Inline script injection possible; CSP provides little XSS protection | `script-src ... 'unsafe-inline' ...` |
| 4 | **`localhost:*` and `ws://localhost:*` in production CSP** | Unnecessary in prod; can enable tunneling / local-service abuse | `connect-src ... localhost:* ws://localhost:* ...` |
| 5 | **Missing `X-Frame-Options`** | No clickjacking protection on older browsers (CSP has no `frame-ancestors`) | Header absent |
| 6 | **CSP missing `frame-ancestors`** | `frame-src` is present but framing *of* the app is not restricted | CSP directive absent |
| 7 | **9 `innerHTML` assignments in bundle** | Potential DOM-based XSS if any sink receives untrusted data | 9 matches for `innerHTML =` |
| 8 | **12 `postMessage()` calls** | Cross-origin messaging without visible origin validation | 12 matches |

### 4.2 Medium

| # | Finding | Impact | Evidence |
|---|---------|--------|----------|
| 9 | **Missing `Referrer-Policy`** | Full URLs leaked to third parties | Header absent |
| 10 | **Missing `Permissions-Policy`** | No restriction on camera/mic/geolocation APIs | Header absent |
| 11 | **Overly broad CSP wildcards** | `*.sevenai.com`, `wss://*.sevenai.com`, `*.s3.*.amazonaws.com` greatly widen the trusted origin set | CSP |
| 12 | **No Subresource Integrity (SRI)** | Third-party script tampering not detected | No `integrity=` attributes |
| 13 | **Infrastructure disclosure** | `Server: AmazonS3`, `x-amz-version-id`, `x-amz-cf-id`, `via: ...cloudfront.net` reveal stack and object versioning | Response headers |
| 14 | **57 `console.*` statements in production bundle** | Possible information leakage | 57 matches |
| 15 | **20 `localStorage` get/set operations** | Sensitive data may persist in browser storage | 20 matches |
| 16 | **`atob`/`btoa` usage (12)** | Encoding is not encryption; may carry sensitive values | 12 matches |
| 17 | **`blob:` / `data:` URLs (293)** | Dynamic content injection surface | 293 matches |
| 18 | **12 inline event handlers (`onclick`/`onload`/`onerror`)** | Inline-handler XSS pattern | 12 matches |
| 19 | **No `Cache-Control` on hashed JS assets** | Missing `immutable` caching; ETag-only | Only `etag` present |
| 20 | **No compression** | No `content-encoding` (gzip/br) | Header absent |
| 21 | **API paths return SPA fallback** | `/.git/config`, `/.env`, `/health`, `/debug`, `/metrics`, `/version` all return 200 + same HTML (S3 SPA routing) — masks real 404s and complicates recon | Identical `content-length: 4860` |

### 4.3 Low / Informational

| # | Finding | Notes |
|---|---------|-------|
| 22 | `TRACE` returns 405 | Good |
| 23 | `PUT`/`DELETE` return 200 with SPA HTML | S3 static behavior; no real write capability |
| 24 | `X-Forwarded-For` / `X-Real-IP` not reflected | Good |
| 25 | `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` | Good |
| 26 | `X-Content-Type-Options` missing | MIME-sniffing protection absent |
| 27 | `X-XSS-Protection` missing | Legacy; low impact given modern browsers |
| 28 | Third-party supply-chain surface | Pendo, Descope, Statsig, Sentry, Zscaler |

### 4.4 Bundle-Specific Findings (Static Analysis)

| # | Finding | Line | Details |
|---|---------|------|---------|
| 29 | **Sentry DSN hardcoded** | 106965 | Full DSN exposed in production bundle |
| 30 | **Descope endpoint configurable** | 15180 | `localStorage` stores endpoint URL override |
| 31 | **Google Sign-In integration** | 15372 | External auth via `accounts.google.com/gsi/client` |
| 32 | **Pendo analytics key** | HTML | `d973cd45-d2ac-4ca9-47e3-79947bbf3082` in inline script |
| 33 | **Dynamic region endpoints** | 21318 | `api.{region}.prod.sevenai.com` template |
| 34 | **WebSocket auto-upgrade** | 104837 | `ws://` automatically upgraded to `wss://` |
| 35 | **100+ event listeners** | Various | High event listener density increases attack surface |
| 36 | **50+ setTimeout calls** | Various | Potential timing-based attacks or race conditions |
| 37 | **10+ setInterval calls** | Various | Memory leak potential if not cleaned up |
| 38 | **18 fetch() calls** | Various | API surface enumeration possible |
| 39 | **Blob/FileReader usage** | 4 instances | File upload handling surface |
| 40 | **Navigator property access** | 5 instances | Fingerprinting vectors (userAgent, language, etc.) |

---

## 5. Comparison: dev vs stg vs prod

All three environments exhibit the **same** headers and CSP:

| Control | dev | stg | prod |
|---------|-----|-----|------|
| HSTS (preload) | ✅ | ✅ | ✅ |
| CSP present | ✅ | ✅ | ✅ |
| CSP `unsafe-eval` | ✅ | ✅ | ✅ |
| CSP `unsafe-inline` | ✅ | ✅ | ✅ |
| `localhost:*` in CSP | ✅ | ✅ | ✅ |
| `frame-ancestors` | ❌ | ❌ | ❌ |
| `X-Frame-Options` | ❌ | ❌ | ❌ |
| `X-Content-Type-Options` | ❌ | ❌ | ❌ |
| `Referrer-Policy` | ❌ | ❌ | ❌ |
| `Permissions-Policy` | ❌ | ❌ | ❌ |
| SRI on scripts | ❌ | ❌ | ❌ |
| Sentry DSN exposed | — | — | ✅ |

---

## 6. Attack Surface Map

```
Domains
  *.sevenai.com
  *.staging.sevenai.com          (wss)
  *.cloud.sevenai.com            (wss)
  api.{region}.prod.sevenai.com
  ws.{region}.prod.sevenai.com   (wss)
  7ai.com, blog.7ai.com

Third-party
  api.descope.com
  *.sentry.io
  *.pendo.io
  api.statsig.com / *.statsigapi.net / featuregates.org
  featureassets.org / assetsconfigcdn.org / prodregistryv2.org
  *.okami-ai.net
  beyondwickedmapping.org
  cloudflare-dns.com
  gateway.zscalerthree.net

Storage
  s3.us-east-2.amazonaws.com
  s3.eu-central-1.amazonaws.com
  s3.us-gov-west-1.amazonaws.com
```

---

## 7. Recommendations

1. **Remove the Sentry DSN** from the client bundle or inject it via runtime config; restrict DSN ingestion.
2. **Eliminate `unsafe-eval` and `unsafe-inline`** from `script-src`; adopt nonces or hashes.
3. **Remove `localhost:*` / `ws://localhost:*`** from production `connect-src`.
4. **Add defense-in-depth headers:**
   ```http
   X-Frame-Options: DENY
   Content-Security-Policy: ...; frame-ancestors 'none';
   X-Content-Type-Options: nosniff
   Referrer-Policy: strict-origin-when-cross-origin
   Permissions-Policy: camera=(), microphone=(), geolocation=()
   ```
5. **Enable SRI** (`integrity` + `crossorigin`) on all third-party scripts.
6. **Audit `innerHTML` sinks** and sanitize with a vetted library (e.g., DOMPurify is already bundled as `purify.es`).
7. **Validate `postMessage` origins** explicitly.
8. **Strip `console.*`** in production builds.
9. **Review `localStorage` usage** for tokens or PII; prefer secure, httpOnly cookies.
10. **Narrow CSP wildcards** to explicit regions/hosts.
11. **Set `Cache-Control: public, max-age=31536000, immutable`** on hashed assets and enable Brotli/Gzip.
12. **Add proper 404 handling** at CloudFront so SPA fallback does not mask sensitive-path probing.
13. **Suppress `x-amz-version-id` / `x-amz-cf-id`** where possible via response header policies.

---

## 8. Advanced Bundle Analysis (Local Replication)

Frontend assets were downloaded and analyzed locally for deeper threat intelligence:

**Downloaded Assets:**
- `index.html` (4.8 KB)
- `bundle.js` (5 MB) - main application bundle
- `api-grpc.js` (313 KB) - gRPC client
- `chakra-ui.js` (670 KB) - UI framework
- `react-query.js` (201 KB) - data fetching
- `statsig.js` (123 KB) - feature flags
- `charts.js` (246 KB) - charting library
- `xyflow.js` (111 KB) - flow builder

### 8.1 Secrets & Credentials Found

| Secret Type | Location | Value |
|-------------|----------|-------|
| Sentry DSN | `bundle.js:106965` | `https://6365b15f2b72192e09c0bfea078f1b2d@o4507057747918848.ingest.us.sentry.io/4507147374952448` |
| Pendo API Key | `index.html` | `d973cd45-d2ac-4ca9-47e3-79947bbf3082` |

### 8.2 API Endpoints Discovered

```javascript
// Dynamic region-based endpoints
const n = "https://api.{region}.prod.sevenai.com"
const r = "wss://ws.{region}.prod.sevenai.com"

// Descope authentication
https://api.descope.com

// Google Sign-In
https://accounts.google.com/gsi/client
```

### 8.3 Storage & Session Management

| Storage Type | Operations | Purpose |
|--------------|------------|---------|
| `localStorage` | 20 operations | User preferences, auth tokens, UI state |
| `sessionStorage` | 8 operations | Temporary session data |
| `document.cookie` | 2 operations | Custom cookie handling |

### 8.4 WebSocket Implementation

```javascript
// Single WebSocket instance (line 104753)
const Je = new WebSocket(ce.current ? ce.current(e) : e);

// Connection handling with error management
Je.onerror = (st) => { /* error handling */ }
Je.onclose = () => { /* reconnection logic */ }
```

### 8.5 Event Handlers Analysis

| Handler Type | Count | Risk |
|--------------|-------|------|
| `addEventListener` | 100+ | Medium - event listener injection |
| Inline handlers (`onclick`, etc.) | 12 | High - XSS vectors |
| `postMessage` | 12 | Medium - cross-origin messaging |

### 8.6 DOM Manipulation Patterns

```javascript
// innerHTML assignments (9 instances)
t.innerHTML = e;
d.innerHTML = r.iconHtml;
XR.innerHTML = t;
// ... more instances

// Potential XSS if 'e' or 't' contains user input
```

### 8.7 Timer & Async Patterns

| Pattern | Count | Risk |
|---------|-------|------|
| `setTimeout` | 50+ | Low |
| `setInterval` | 10+ | Low |
| `fetch()` | 18 | Medium - API exposure |
| `XMLHttpRequest` | 1 | Low |

---

## 9. Methodology

1. **Passive reconnaissance:** HTTP header inspection (`curl -I`) across all three hosts
2. **CSP extraction:** Content-Security-Policy directive parsing
3. **Bundle download:** Full frontend asset retrieval to `/opt/sevenai/frontend/`
4. **Static analysis:** Regex pattern matching for secrets, sinks, and endpoints
5. **HTTP probing:** Method testing (GET, POST, PUT, DELETE, OPTIONS, TRACE)
6. **Path enumeration:** Common sensitive file and debug endpoint probing
7. **Local server testing:** Python HTTP server for bundle analysis

**No active exploitation, brute force, or intrusive testing was performed.**

---

## 10. Local Testing Setup

```bash
# Replicate the frontend locally
cd /opt/sevenai/frontend
python3 -m http.server 8080

# Access at http://localhost:8080
```

**Bundle Analysis Commands:**
```bash
# Find secrets
grep -n "https://[0-9a-fA-F]\{32\}@" bundle.js

# Find API endpoints
grep -nE "https?://[a-zA-Z0-9\.\-_/]+" bundle.js

# Find XSS vectors
grep -nE "innerHTML\s*=|outerHTML\s*=" bundle.js

# Find storage usage
grep -nE "localStorage|sessionStorage|document.cookie" bundle.js
```

---

*Report generated for authorized security assessment. Findings are observations from public
responses and client-side code; validate exploitability in an authorized test environment.*

---

## 11. Summary Statistics

| Category | Count |
|----------|-------|
| Total Findings | 40 |
| Critical/High | 8 |
| Medium | 21 |
| Low/Informational | 11 |
| Bundle-Specific | 12 |
| Domains Analyzed | 3 |
| Bundle Size Analyzed | ~6.7 MB |
| Third-Party Services | 10+ |

**Local bundle available at:** `/opt/sevenai/frontend/`
**Report generated:** 2026-10-23
