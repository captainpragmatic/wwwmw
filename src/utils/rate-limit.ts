/**
 * Rate limiting using Cloudflare Workers KV
 * Implements a sliding window rate limiter per IP address
 */

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the time window */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 10,
  windowSeconds: 60, // 1 minute
};

/**
 * Check if a request from the given IP should be rate limited
 */
export async function checkRateLimit(
  kv: KVNamespace,
  ip: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const key = `ratelimit:${ip}`;

  // Get existing request timestamps
  const existing = await kv.get(key, 'json') as number[] | null;
  const timestamps = existing || [];

  // Filter out timestamps outside the current window
  const validTimestamps = timestamps.filter(ts => now - ts < windowMs);

  // Check if limit exceeded
  if (validTimestamps.length >= config.maxRequests) {
    const oldestTimestamp = Math.min(...validTimestamps);
    const resetAt = oldestTimestamp + windowMs;

    return {
      allowed: false,
      remaining: 0,
      resetAt: Math.floor(resetAt / 1000),
    };
  }

  // Add current request timestamp
  validTimestamps.push(now);

  // Store updated timestamps with TTL
  await kv.put(key, JSON.stringify(validTimestamps), {
    expirationTtl: config.windowSeconds + 10, // Add buffer
  });

  return {
    allowed: true,
    remaining: config.maxRequests - validTimestamps.length,
    resetAt: Math.floor((now + windowMs) / 1000),
  };
}

/**
 * Get the client IP address from the request
 */
export function getClientIP(request: Request): string {
  // Cloudflare provides the client IP in the CF-Connecting-IP header
  const cfIP = request.headers.get('CF-Connecting-IP');
  if (cfIP) return cfIP;

  // Fallback to X-Forwarded-For
  const forwardedFor = request.headers.get('X-Forwarded-For');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  // Last resort fallback
  return 'unknown';
}

/**
 * Create rate limit error response
 */
export function rateLimitResponse(resetAt: number): Response {
  const retryAfter = Math.max(1, resetAt - Math.floor(Date.now() / 1000));

  return new Response(
    JSON.stringify({
      error: 'Rate limit exceeded',
      message: 'Too many requests. Please try again later.',
      retryAfter: retryAfter,
      resetAt: new Date(resetAt * 1000).toISOString(),
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': retryAfter.toString(),
        'X-RateLimit-Limit': DEFAULT_CONFIG.maxRequests.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': resetAt.toString(),
        'Access-Control-Allow-Origin': 'https://captainpragmatic.com',
      },
    }
  );
}

/**
 * Add rate limit headers to a response
 */
export function addRateLimitHeaders(
  response: Response,
  result: RateLimitResult,
  config: RateLimitConfig = DEFAULT_CONFIG
): Response {
  const headers = new Headers(response.headers);
  headers.set('X-RateLimit-Limit', config.maxRequests.toString());
  headers.set('X-RateLimit-Remaining', result.remaining.toString());
  headers.set('X-RateLimit-Reset', result.resetAt.toString());

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
