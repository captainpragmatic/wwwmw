# ADR-003: User-Agent Identification for HTTP Requests

**Date:** 2025-11-21  
**Status:** Accepted  
**Decision Makers:** Captain Pragmatic

## Context

The WWWMW tool makes HEAD requests to target websites for availability and performance checks. Server logs showed these requests appearing without proper identification:

```
2a06:98c0:3600::103 - - [21/Nov/2025:13:29:46 +0200] "HEAD / HTTP/2.0" 200 126 "-" "-"
```

The missing User-Agent header ("-") makes it difficult for website owners to:

- Identify the source of automated traffic
- Understand the purpose of HEAD requests
- Properly configure rate limiting or allowlisting
- Debug issues or contact the tool operator

## Decision

We will add a standardized User-Agent header to all HTTP requests made by WWWMW:

```
WWWMW/1.0 (+https://captainpragmatic.com/tools/website-health-scanner)
```

This follows RFC 9309 and industry best practices for bot identification.

## Format Rationale

The chosen format includes:

1. **Tool Name**: `WWWMW` - Clear, memorable identifier
2. **Version**: `1.0` - Enables tracking of behavior changes over time
3. **Info URL**: `+https://captainpragmatic.com/tools/website-health-scanner` - Provides context and contact information

This follows patterns used by established services:

- `Googlebot/2.1 (+http://www.google.com/bot.html)`
- `UptimeRobot/2.0 (+https://uptimerobot.com/)`
- `facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)`

## Pros and Cons

### Advantages

✅ **Transparency**: Website owners can clearly identify our tool's traffic  
✅ **Trust**: Demonstrates professionalism and good internet citizenship  
✅ **Debugging**: Makes troubleshooting easier for both parties  
✅ **Analytics**: Helps site owners understand legitimate monitoring traffic  
✅ **Compliance**: Aligns with web standards and best practices  
✅ **Contact**: Provides a way for site owners to learn about or contact us

### Disadvantages

❌ **Potential Blocking**: Some aggressive WAFs might block unknown bots

- _Mitigation_: This is acceptable and even desirable - legitimate monitoring tools should be transparent, and site owners have the right to block automated access

## Implementation

User-Agent header added to fetch requests in:

- `src/services/availability-check.ts` - HEAD requests for uptime checks
- `src/services/server-response.ts` - HEAD requests for TTFB measurement
- `src/services/ssl-check.ts` - HEAD requests for HTTPS validation

Other fetch calls (DNS APIs, PageSpeed API, etc.) don't require this header as they're API-to-API communication, not direct site checking.

## Consequences

### Immediate Impact

- Server logs will now show: `"HEAD / HTTP/2.0" 200 126 "-" "WWWMW/1.0 (+https://captainpragmatic.com/tools/website-health-scanner)"`
- Website administrators can identify and understand our traffic
- More professional appearance in server logs

### Future Considerations

- Version number can be incremented when significant changes are made to request patterns
- URL provides a stable reference point even if domain or tool evolves
- May receive feedback from site owners, which could inform future improvements

## References

- [RFC 9309 - Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html)
- [MDN Web Docs - User-Agent](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/User-Agent)
- Industry examples: Googlebot, UptimeRobot, Facebook External Hit
