# ADR-001: DNS Speed Check Enhancement

**Status:** Accepted  
**Date:** 2025-11-20  
**Decision Makers:** Engineering Team  
**Related:** `src/services/dns-speed.ts`, `src/utils/scoring.ts`

---

## Context and Problem Statement

The original DNS speed check implementation was too lenient in its performance thresholds and provided limited diagnostic information. It used a single DNS provider (Cloudflare) and considered response times up to 200ms as "fast," which doesn't reflect modern DNS performance standards. Users needed more actionable insights about their DNS configuration, including security (DNSSEC) and infrastructure (CDN) considerations.

**Key Issues with Original Implementation:**

- Single DNS provider (no redundancy or cross-validation)
- Too lenient: 200ms considered "fast" (modern DNS should be <75ms)
- No DNSSEC validation information
- No CDN detection
- Limited diagnostic details for troubleshooting

---

## Decision

We enhanced the DNS speed check to provide a "just right" balance between simplicity and actionable insights, avoiding over-engineering while delivering real user value.

### Changes Implemented

#### 1. **Dual DNS Provider Queries**

- Query both **Cloudflare DNS** (`cloudflare-dns.com`) and **Google Public DNS** (`dns.google`) in parallel
- Use results from whichever provider(s) succeed
- Calculate min/max/average response times across providers
- Provides redundancy and cross-validation

**Rationale:** Two providers give reliability without adding significant complexity or latency (parallel execution adds only ~50-100ms vs single provider).

#### 2. **Tightened Performance Thresholds**

| Threshold | Status | Score | Label                        | Rationale                            |
| --------- | ------ | ----- | ---------------------------- | ------------------------------------ |
| < 75ms    | Pass   | 10    | "Excellent" (<20ms) / "Fast" | Modern DNS with CDN/edge locations   |
| 75-149ms  | Warn   | 5     | "Moderate"                   | Acceptable but improvable            |
| ≥ 150ms   | Fail   | 0     | "Slow"                       | Noticeable impact on user experience |

**Previous thresholds:** <200ms = pass, <500ms = warn, ≥500ms = fail

**Rationale:** Updated to reflect 2025 DNS performance standards. Most premium DNS providers (Cloudflare, Google, Route53) deliver <50ms globally with edge/Anycast infrastructure.

#### 3. **DNSSEC Validation**

- Check `AD` (Authenticated Data) flag in DNS-over-HTTPS response
- Add `dnssecValid: boolean` to response details
- Include in message: "DNSSEC not enabled" when false
- Generate recommendation: "Enable DNSSEC for tamper protection"

**Rationale:** DNSSEC prevents DNS spoofing/cache poisoning attacks. While not universally adopted, it's a best practice for security-conscious sites. Informational only—doesn't affect pass/fail status.

#### 4. **CDN Detection**

- Pattern-match DNS answers against known CDN IP ranges and CNAMEs:
  - Cloudflare: `104.16-31.*`, `172.64-127.*`, `cloudflare` patterns
  - Fastly: `151.101.*`, `fastly` patterns
  - Akamai: `akamai`, `edgekey`, `edgesuite` patterns
  - AWS CloudFront: `cloudfront` patterns
  - Generic: `/cdn/i` patterns
- Add `cdnDetected: boolean` to response details
- Generate recommendation if slow DNS + no CDN detected

**Rationale:** CDN usage correlates with better global performance. Detecting it provides context for DNS speed and actionable recommendations.

#### 5. **Backward-Compatible Response Structure**

```typescript
details: {
  responseTime: 68,      // ← PRESERVED: average (backward compat)
  averageTime: 68,       // NEW: explicit average
  minTime: 45,           // NEW: fastest provider
  maxTime: 92,           // NEW: slowest provider
  records: 2,            // Existing: A record count
  dnssecValid: false,    // NEW: DNSSEC status
  cdnDetected: true,     // NEW: CDN detection
  ttl: 300               // NEW: DNS TTL in seconds
}
```

**Rationale:** Existing frontends expect `responseTime` field. We preserve it (as average) while adding new fields for enhanced UX. No breaking changes.

#### 6. **Context-Aware Recommendations**

Enhanced recommendations in `scoring.ts`:

- **Fail status:** "Move to faster DNS provider (Cloudflare/Google)"
- **Warn status:** "Optimize DNS with Anycast resolver"
- **No DNSSEC:** "Enable DNSSEC for tamper protection"
- **Slow + No CDN:** "Consider CDN for edge caching and faster global access"

**Rationale:** Actionable, specific recommendations based on detected conditions rather than generic advice.

---

## Alternatives Considered

### Alternative 1: Four DNS Providers with Statistical Analysis

**Description:** Query Cloudflare, Google, Quad9, and OpenDNS; calculate mean, median, standard deviation, consistency scores.

**Rejected because:**

- Over-engineered for a general website scanner
- Adds ~150-200ms to every scan (4 parallel queries)
- Statistical metrics confuse non-technical users
- Only valuable for specialized DNS monitoring tools
- Maintenance burden tracking 4 provider APIs

### Alternative 2: Geographic Multi-Location Testing

**Description:** Test DNS from multiple global edge locations (US, EU, Asia).

**Rejected because:**

- Requires distributed infrastructure (complex, costly)
- Significantly increases scan time (3-5 locations = 3-5x latency)
- Out of scope for a simple website health checker
- Better suited for dedicated uptime monitoring services

### Alternative 3: Keep Original Implementation

**Description:** No changes; maintain single provider + lenient thresholds.

**Rejected because:**

- 200ms threshold doesn't reflect modern DNS performance
- Single provider has no redundancy
- Misses actionable insights (DNSSEC, CDN)
- Provides inadequate diagnostic value

---

## Consequences

### Positive

✅ **More accurate DNS assessment** with modern thresholds  
✅ **Redundancy** via dual providers (better reliability)  
✅ **Actionable security insight** via DNSSEC detection  
✅ **Infrastructure awareness** via CDN detection  
✅ **Backward compatible** with existing frontend integrations  
✅ **Minimal performance impact**: +50-100ms vs single provider (parallel execution)  
✅ **Better recommendations** tailored to detected conditions

### Negative

⚠️ **Slightly increased latency**: ~50-100ms per scan (acceptable tradeoff)  
⚠️ **More complex code**: dual queries + pattern matching (manageable)  
⚠️ **API dependency**: now dependent on 2 DNS providers (mitigated by fallback logic)

### Neutral

📝 **New fields in API response**: optional for frontend to consume  
📝 **Stricter thresholds**: may cause more sites to "fail" DNS check (accurate reflection of reality)

---

## Implementation Notes

### Query Strategy

```typescript
// Both providers queried in parallel (Promise.all)
// Fallback logic: use whichever succeeds
// If both fail: return error with fastest failure time
```

### Timeout Strategy

- **Per-provider timeout:** 3 seconds (prevents one slow provider from blocking)
- **Total timeout:** Naturally limited to ~3s by parallel execution

### CDN Pattern Matching

- Uses regex patterns for IP ranges and CNAME keywords
- Designed for high recall (catch most CDNs) over precision
- False positives acceptable (informational only, doesn't affect scoring)

### DNSSEC Detection

- Based on `AD` (Authenticated Data) flag in DoH response
- Only indicates resolver validated DNSSEC chain, not domain's own DNSSEC status
- Good enough for informational purposes

---

## Validation and Testing

### Test Scenarios

1. **Fast DNS with CDN + DNSSEC:** `cloudflare.com` (should be <20ms, both flags true)
2. **Fast DNS without CDN:** `example.com` (should be fast, no CDN)
3. **Slow DNS:** Small hosting provider sites (should warn/fail)
4. **No DNSSEC:** Most sites (DNSSEC adoption is ~30% as of 2025)
5. **Provider failure:** Graceful fallback to working provider

### Monitoring

- Track dual-provider success rate
- Monitor average response time distribution
- Validate CDN detection accuracy with known CDN sites
- Monitor DNSSEC flag accuracy

---

## Future Considerations

### Potential Enhancements (Deferred)

- **IPv6 DNS checks** (AAAA records in addition to A records)
- **DNS propagation check** (query multiple public resolvers for consistency)
- **TTL optimization recommendations** (warn about very short TTLs)
- **Authoritative nameserver checks** (validate NS records, check diversity)

### Not Planned (Out of Scope)

- Geographic multi-location testing (requires distributed infrastructure)
- 4+ DNS provider testing (over-engineering)
- Statistical analysis of consistency (too technical for target audience)

---

## References

- [Cloudflare DNS-over-HTTPS API](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/)
- [Google Public DNS-over-HTTPS API](https://developers.google.com/speed/public-dns/docs/doh)
- [DNSSEC Best Practices (RFC 6781)](https://www.rfc-editor.org/rfc/rfc6781)
- Modern DNS Performance Standards: [DNSPerf Rankings 2025](https://www.dnsperf.com/)

---

## Decision Log

| Date       | Change                                    | Reason                                                       |
| ---------- | ----------------------------------------- | ------------------------------------------------------------ |
| 2025-11-20 | Initial implementation                    | Enhance DNS check with dual providers, DNSSEC, CDN detection |
| 2025-11-20 | Tightened thresholds to 75/150ms          | Reflect modern DNS performance standards                     |
| 2025-11-20 | Added backward-compatible response fields | Prevent breaking frontend integrations                       |
