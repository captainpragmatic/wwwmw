# ADR-002: SSL Certificate Monitoring with Certificate Transparency Logs

**Status:** Accepted  
**Date:** 2025-11-20  
**Decision Makers:** Engineering Team  
**Related:** `src/services/ssl-check.ts`, `src/utils/scoring.ts`

---

## Context and Problem Statement

The original SSL check implementation could only verify that an HTTPS handshake succeeded, but provided no visibility into certificate health or upcoming expiration. This is a critical gap because:

1. **Expired certificates cause outages** - Sites go down when certs expire unexpectedly
2. **No proactive warnings** - Users had no way to know their certificate would expire soon
3. **Limited actionable insights** - "SSL works" isn't enough; users need expiry dates, issuer info
4. **Runtime limitations** - Cloudflare Workers' `fetch()` API doesn't expose certificate metadata (expiry, issuer, SANs, chain)

**The Core Challenge:**

Workers runtime is sandboxed and doesn't provide access to the TLS peer certificate object. Even the TCP socket API (available in Workers) doesn't expose certificate details. We needed a creative solution to surface certificate information without direct TLS inspection.

---

## Decision

Implement a **two-stage SSL check** combining real-time handshake validation with Certificate Transparency (CT) log lookups for expiration monitoring.

### Approach

#### **Stage 1: Real-Time HTTPS Handshake** (Primary Check)

```typescript
// Fast, confirms certificate works RIGHT NOW
const response = await fetch(`https://${hostname}`, { method: "HEAD" });
// Success = valid certificate in use
```

**What it tells us:**

- ✅ HTTPS is working right now
- ✅ Certificate is trusted by browsers
- ✅ No chain or validation errors
- ❌ **Cannot** see expiry date, issuer, SANs

#### **Stage 2: Certificate Transparency Log Lookup** (Enhanced Details)

```typescript
// Slower, provides historical certificate data
const response = await fetch(`https://crt.sh/?q=${hostname}&output=json`);
// Returns all certificates ever issued for domain
```

**What it tells us:**

- ✅ Certificate expiration date (`not_after`)
- ✅ Issue date (`not_before`)
- ✅ Certificate Authority / Issuer
- ✅ Subject Alternative Names (SANs)
- ✅ Certificate serial number
- ⚠️ Historical data (24-48 hour lag from issuance)

### Implementation Strategy

**Dual-phase execution:**

1. **Always** perform handshake test (fast, critical)
2. **Attempt** CT log lookup in parallel (slower, informational)
3. **Gracefully fall back** to handshake-only if CT fails

**Result prioritization:**

```typescript
if (handshakeFailed) {
  return { status: "fail", message: "SSL invalid" };
}

if (ctLogData && ctLogData.daysUntilExpiry < 0) {
  return { status: "warn", message: "Certificate expired" };
}

if (ctLogData && ctLogData.expiringSoon) {
  return { status: "warn", message: `Expires in ${days} days` };
}

if (ctLogData) {
  return { status: "pass", message: `Valid (expires in ${days} days)` };
}

// Fallback: CT lookup failed
return { status: "pass", message: "HTTPS enabled with valid certificate" };
```

---

## Certificate Transparency Logs: Why They Work

### What are CT Logs?

Since 2018, all publicly-trusted SSL certificates **must** be logged to public Certificate Transparency logs before browsers will trust them. This is a security requirement (RFC 6962) designed to detect mis-issued certificates.

**Key properties:**

- 🌐 **Public and free** - No authentication, no rate limits (within reason)
- 📝 **Comprehensive** - Contains all publicly-trusted certificates
- 🔍 **Searchable** - Query by domain, serial, fingerprint
- 📊 **Standardized** - JSON API with consistent schema
- ⚡ **Fast enough** - 200-500ms typical response time

### Why crt.sh?

**crt.sh** is a Certificate Transparency log search engine operated by Sectigo (major CA).

**Advantages:**

- ✅ Aggregates multiple CT logs (Google, Cloudflare, DigiCert, etc.)
- ✅ Simple JSON API - no API key required
- ✅ Battle-tested - used by security researchers, compliance tools
- ✅ Generous rate limits (~100-200 req/min for reasonable use)
- ✅ Low maintenance - operated by a CA with vested interest in reliability

**Limitations:**

- ⚠️ **24-48 hour lag** - New certificates take time to propagate
- ⚠️ **Historical data** - Shows expired certs too (we filter)
- ⚠️ **No revocation status** - Doesn't check OCSP/CRL
- ⚠️ **Dependency** - External service (hence fallback strategy)

---

## Alternatives Considered

### Alternative 1: Run a TLS Inspection Service (Node.js/Python)

**Architecture:**

```
Worker → [Your API] → TLS.connect() → Target
                ↓
          Read cert metadata
```

**Advantages:**

- Full control over TLS inspection
- Real-time certificate data
- Can check revocation (OCSP)
- Can analyze cipher suites, protocols

**Rejected because:**

- ❌ Requires separate infrastructure (cost, maintenance)
- ❌ Adds ~200-500ms latency anyway
- ❌ Single point of failure
- ❌ Scalability concerns (need to handle all user requests)
- ❌ Over-engineering for a simple health check tool

### Alternative 2: SSL Labs API (Qualys)

**Service:** https://api.ssllabs.com/api/v3/analyze

**Advantages:**

- Comprehensive SSL analysis (A+ grading, vulnerabilities)
- Trusted industry standard
- Detailed protocol/cipher information

**Rejected because:**

- ❌ **Extremely slow** (30-120 seconds per scan)
- ❌ **Aggressive rate limits** (25 assessments/day on free tier)
- ❌ **Not real-time** - Can't queue scans for on-demand user requests
- ❌ **Overkill** - We don't need A+ grading, just expiry dates

### Alternative 3: Parse HTML Error Pages

**Idea:** Trigger a cert error and parse browser error message

**Rejected because:**

- ❌ Unreliable - error formats vary by browser
- ❌ Doesn't work if cert is valid
- ❌ Provides no structured data
- ❌ Hacky and unmaintainable

### Alternative 4: Accept Runtime Limitations (Handshake Only)

**Keep original implementation:** Just test if HTTPS works.

**Rejected because:**

- ❌ Misses critical user need (expiry warnings)
- ❌ No actionable insights for certificate management
- ❌ Users can't proactively renew before expiry
- ❌ Competitive disadvantage (other tools show expiry)

### Alternative 5: Use Cloudflare's Certificate Edge API

**Idea:** Query Cloudflare's own certificate data via API

**Rejected because:**

- ❌ Only works for sites on Cloudflare
- ❌ Requires authentication
- ❌ Doesn't help for non-Cloudflare sites (vast majority)

---

## Consequences

### Positive

✅ **Proactive expiry warnings** - Users get 30-day advance notice  
✅ **Zero infrastructure** - Uses free public CT logs  
✅ **No API keys** - No authentication or quotas to manage  
✅ **Graceful degradation** - Falls back to handshake-only if CT fails  
✅ **Backward compatible** - Old frontend sees standard SSL check  
✅ **Actionable recommendations** - "Renew in 15 days" messaging  
✅ **Trust indicators** - Shows certificate authority (Let's Encrypt, DigiCert)  
✅ **Still within Worker limits** - Only +3.9 KB bundle size

### Negative

⚠️ **External dependency** - Relies on crt.sh availability (mitigated by fallback)  
⚠️ **24-48 hour lag** - Newly issued certs won't show immediately (acceptable)  
⚠️ **No revocation check** - Doesn't detect revoked certificates (rare edge case)  
⚠️ **Potential rate limits** - High volume could hit crt.sh limits (future: add caching)  
⚠️ **Performance variance** - CT lookup adds 200-500ms (timeout after 3s)

### Neutral

📝 **More complex code** - Two-stage check vs simple handshake  
📝 **Historical data** - Shows old certificates (we filter to active ones)  
📝 **Multiple CAs** - Different issuers have different CT log behaviors

---

## Implementation Details

### Timeout Strategy

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 3000);
// 3-second timeout prevents slow CT logs from blocking
```

**Rationale:**

- 3 seconds is generous (most CT queries: 200-500ms)
- Prevents blocking user experience
- Falls back gracefully on timeout

### Certificate Selection Logic

```typescript
// Find most recent non-expired certificate
const activeCert = certs
  .filter((cert) => new Date(cert.not_after) > now)
  .sort((a, b) => new Date(b.not_before) - new Date(a.not_before))[0];
```

**Why this approach:**

- Domains often have multiple certs (renewals, backups)
- Most recent non-expired = currently in use
- Handles overlap during renewal period

### Fallback Handling

```typescript
if (!ctLogData) {
  return {
    status: "pass",
    message: "HTTPS enabled with valid SSL/TLS certificate",
    details: {
      certTransparency: false, // Signals CT lookup failed
    },
  };
}
```

**Frontend can detect:**

- `certTransparency: false` = CT data unavailable (show basic status only)
- `certTransparency: true` = CT data available (show expiry details)

### Scoring System

| Condition        | Status | Score | Message                          |
| ---------------- | ------ | ----- | -------------------------------- |
| No HTTPS         | Fail   | 0     | "Site not using HTTPS"           |
| Handshake fails  | Fail   | 0     | "Certificate invalid/expired"    |
| Cert expired     | Warn   | 5     | "Certificate expired X days ago" |
| Expires <30 days | Warn   | 8     | "Expires in X days"              |
| Valid + >30 days | Pass   | 10    | "Valid (expires in X days)"      |

**Rationale:**

- Cert expiring soon = warn (8 points) - still works but needs attention
- Cert expired = warn (5 points) - might work due to CT lag, but urgent
- No HTTPS = fail (0 points) - critical security issue

---

## Future Considerations

### Potential Enhancements (Deferred)

**1. KV Caching for CT Log Results**

```typescript
// Cache CT results for 6-12 hours per domain
const cacheKey = `ct:${hostname}`;
const cached = await env.RATE_LIMITER.get(cacheKey);
if (cached) return JSON.parse(cached);
```

**Benefits:** Reduces CT log queries, faster response  
**When:** If we hit rate limits or want sub-200ms responses

**2. OCSP Revocation Check**
Query Online Certificate Status Protocol to detect revoked certificates  
**When:** If users request it or we see revoked certs in production

**3. Multiple CT Log Providers**
Add fallback to Google CT, Cloudflare CT if crt.sh is down  
**When:** If crt.sh reliability becomes an issue

**4. Certificate Chain Analysis**
Validate intermediate certificates, check for weak signatures  
**When:** If we want deeper security analysis (moves toward SSL Labs territory)

**5. TLS Protocol/Cipher Analysis**
Detect outdated TLS 1.0/1.1, weak ciphers  
**Requires:** Separate inspection service (can't do in Workers)

### Not Planned (Out of Scope)

- ❌ Full SSL Labs-style grading (A-F scores)
- ❌ Vulnerability scanning (Heartbleed, POODLE, etc.)
- ❌ Certificate pinning validation
- ❌ CAA record checking
- ❌ DANE/TLSA record validation

**Why:** WWWMW is a simple website health checker, not a comprehensive security scanner. These features would require significant complexity and external services.

---

## Validation and Testing

### Test Scenarios

1. **Standard case:** Site with valid cert >30 days

   - Example: `cloudflare.com`
   - Expected: Pass, shows expiry in X days

2. **Expiring soon:** Cert <30 days from expiry

   - Test: Look for sites in CT logs with near-expiry dates
   - Expected: Warn status, "expires in X days" message

3. **Expired cert:** Certificate past expiration

   - Test: Known expired domains
   - Expected: Warn status, "expired X days ago"

4. **No HTTPS:** HTTP-only site

   - Example: `http://example.com` (redirects to HTTPS, use HTTP-only test site)
   - Expected: Fail status, "not using HTTPS"

5. **CT log unavailable:** Simulate timeout or 500 error

   - Test: Block crt.sh in dev/staging
   - Expected: Pass with `certTransparency: false`, handshake-only result

6. **New certificate:** Recently issued (<24 hours)
   - Expected: Handshake passes, CT may not have data (fallback graceful)

### Monitoring Recommendations

**Metrics to track:**

- CT log success rate (should be >95%)
- CT log response time (p50, p95, p99)
- Fallback frequency (if >5%, investigate crt.sh health)
- Certificates expiring within 7/14/30 days (trend analysis)

**Alerts:**

- CT log success rate drops below 90% (may indicate crt.sh outage)
- Average CT response time >1s (performance degradation)

---

## Decision Rationale Summary

**We chose CT logs over alternatives because:**

1. ✅ **No infrastructure** - Leverages existing public service
2. ✅ **Good enough accuracy** - 24-48 hour lag is acceptable for expiry monitoring
3. ✅ **Zero cost** - Free, no API keys, no quotas
4. ✅ **Graceful degradation** - Works without CT data if needed
5. ✅ **Battle-tested** - Used by security industry for years

**The two-stage approach works because:**

1. ✅ **Real-time validation** (handshake) catches immediate issues
2. ✅ **Historical data** (CT logs) provides expiry context
3. ✅ **Independence** - Each stage can succeed/fail independently
4. ✅ **Performance** - Parallel execution, timeout protection

**This is the "just right" solution:**

- Not too simple (handshake-only misses expiry warnings)
- Not too complex (separate TLS service is over-engineering)
- Provides real user value (proactive expiry notifications)
- Maintains reliability (fallback to handshake-only)

---

## References

- [RFC 6962: Certificate Transparency](https://datatracker.ietf.org/doc/html/rfc6962)
- [crt.sh Certificate Search](https://crt.sh/)
- [Certificate Transparency Log List](https://www.certificate-transparency.org/known-logs)
- [Cloudflare Workers Fetch API](https://developers.cloudflare.com/workers/runtime-apis/fetch/)
- [Google Certificate Transparency](https://certificate.transparency.dev/)

---

## Decision Log

| Date       | Change                                  | Reason                                        |
| ---------- | --------------------------------------- | --------------------------------------------- |
| 2025-11-20 | Initial implementation                  | Add certificate expiry monitoring via CT logs |
| 2025-11-20 | 3-second timeout on CT lookup           | Prevent blocking on slow/unavailable service  |
| 2025-11-20 | Graceful fallback to handshake-only     | Ensure reliability when CT unavailable        |
| 2025-11-20 | Warn status for certs expiring <30 days | Give users advance notice to renew            |
