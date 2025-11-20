/**
 * DNS Speed Check Service
 *
 * Measures DNS resolution performance using dual DNS-over-HTTPS providers (Cloudflare and Google).
 * Provides actionable insights including DNSSEC validation and CDN detection.
 *
 * Key Features:
 * - Dual provider queries (Cloudflare + Google) for redundancy and accuracy
 * - Tightened thresholds: <75ms pass, 75-149ms warn, ≥150ms fail
 * - DNSSEC validation detection via AD (Authenticated Data) flag
 * - CDN detection via IP range and CNAME pattern matching
 * - Backward-compatible response structure (preserves `responseTime` field)
 *
 * Performance Thresholds Rationale:
 * - <20ms: Excellent (edge/Anycast DNS with geographic proximity)
 * - <75ms: Fast (modern DNS providers like Cloudflare, Google, Route53)
 * - 75-149ms: Moderate (acceptable but room for improvement)
 * - ≥150ms: Slow (noticeable user impact, consider DNS optimization)
 *
 * @see docs/ADR-001-dns-speed-check-enhancement.md for full decision context
 */

import type { CheckResult, DNSResponse } from "../types";
import { extractHostname } from "../utils/validation";

/**
 * Query a single DNS provider via DNS-over-HTTPS (DoH)
 *
 * Uses the DNS JSON API format supported by both Cloudflare and Google.
 * Times the complete request/response cycle including network latency.
 *
 * @param hostname - The domain to resolve (e.g., "example.com")
 * @param providerUrl - The DoH endpoint URL (without query params)
 * @returns Object containing response time in ms and parsed DNS data (or null if failed)
 *
 * @example
 * const result = await queryDNSProvider("example.com", "https://cloudflare-dns.com/dns-query");
 * // Returns: { time: 45, data: { Status: 0, Answer: [...] } }
 */
async function queryDNSProvider(
  hostname: string,
  providerUrl: string
): Promise<{ time: number; data: DNSResponse | null }> {
  const startTime = Date.now();

  try {
    // 3-second timeout per provider to prevent slow providers from blocking
    // This is shorter than the typical 5s timeout to allow parallel queries to complete quickly
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${providerUrl}?name=${hostname}&type=A`, {
      method: "GET",
      headers: {
        Accept: "application/dns-json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const endTime = Date.now();
    const responseTime = endTime - startTime;

    if (!response.ok) {
      return { time: responseTime, data: null };
    }

    const data = (await response.json()) as DNSResponse;
    return { time: responseTime, data };
  } catch (error) {
    return { time: Date.now() - startTime, data: null };
  }
}

/**
 * Detect if DNS resolution points to a known CDN provider
 *
 * Checks both IP address ranges and CNAME patterns to identify CDN usage.
 * This is informational only and doesn't affect pass/fail status.
 *
 * Detection Methods:
 * 1. IP Range Matching: Check if A records fall within known CDN IP blocks
 * 2. Pattern Matching: Check for CDN-specific keywords in CNAMEs/names
 *
 * Supported CDNs:
 * - Cloudflare (104.16-31.*, 172.64-127.*, *.cloudflare.*)
 * - Fastly (151.101.*, *.fastly.*)
 * - Akamai (*.akamai.*, *.edgekey.*, *.edgesuite.*)
 * - AWS CloudFront (*.cloudfront.*)
 * - Generic CDN patterns (/cdn/i regex)
 *
 * @param answers - Array of DNS answer records from DoH response
 * @returns true if CDN detected, false otherwise
 *
 * Note: Optimized for high recall (catch most CDNs) over precision.
 * False positives are acceptable since this is informational only.
 */
function detectCDN(answers: Array<{ data: string; name: string }>): boolean {
  if (!answers || answers.length === 0) return false;

  const cdnPatterns = [
    // Cloudflare IP ranges and patterns
    /^104\.(1[6-9]|2[0-9]|3[01])\./, // 104.16.0.0/12
    /^172\.(6[4-9]|[7-9][0-9]|1[0-2][0-9]|13[01])\./, // 172.64.0.0/13
    /cloudflare/i,
    // Fastly
    /^151\.101\./, // 151.101.0.0/16
    /fastly/i,
    // Akamai edge patterns
    /akamai/i,
    /edgekey/i,
    /edgesuite/i,
    // AWS CloudFront
    /cloudfront/i,
    // Generic CDN patterns
    /cdn/i,
    /\.cloudflare\./i,
    /\.fastly\./i,
  ];

  return answers.some((answer) => {
    const ip = answer.data;
    const name = answer.name || "";
    return cdnPatterns.some(
      (pattern) => pattern.test(ip) || pattern.test(name)
    );
  });
}

/**
 * Check DNS resolution speed and configuration
 *
 * Main entry point for DNS speed check. Queries dual DNS providers in parallel,
 * calculates performance metrics, validates DNSSEC, detects CDN usage, and generates
 * a comprehensive check result with actionable recommendations.
 *
 * @param url - The full URL to check (e.g., "https://example.com")
 * @returns CheckResult with status, message, score, and detailed metrics
 *
 * Response Structure:
 * ```typescript
 * {
 *   status: "pass" | "warn" | "fail",
 *   message: "Fast DNS resolution (68ms avg, DNSSEC not enabled, CDN detected)",
 *   score: 0-10,
 *   details: {
 *     responseTime: 68,     // Backward compatible (average)
 *     averageTime: 68,      // Explicit average
 *     minTime: 45,          // Fastest provider
 *     maxTime: 92,          // Slowest provider
 *     records: 2,           // Number of A records
 *     dnssecValid: false,   // DNSSEC validation status
 *     cdnDetected: true,    // CDN usage detected
 *     ttl: 300              // DNS TTL in seconds
 *   }
 * }
 * ```
 */
export async function checkDNSSpeed(url: string): Promise<CheckResult> {
  try {
    const hostname = extractHostname(url);

    if (!hostname) {
      return {
        status: "fail",
        message: "Invalid hostname",
        score: 0,
        details: {},
      };
    }

    // Query both Cloudflare and Google DNS in parallel for redundancy and cross-validation
    // Parallel execution keeps latency low (~50-100ms overhead vs single provider)
    const [cloudflareResult, googleResult] = await Promise.all([
      queryDNSProvider(hostname, "https://cloudflare-dns.com/dns-query"),
      queryDNSProvider(hostname, "https://dns.google/resolve"),
    ]);

    // Collect successful query times and determine primary data source
    // Prefer Cloudflare but fall back to Google if Cloudflare fails
    let primaryData: DNSResponse | null = cloudflareResult.data;
    let times: number[] = [];

    if (cloudflareResult.data && cloudflareResult.data.Status === 0) {
      times.push(cloudflareResult.time);
    }
    if (googleResult.data && googleResult.data.Status === 0) {
      times.push(googleResult.time);
      // Use Google data if Cloudflare failed or returned non-zero status
      if (!primaryData || primaryData.Status !== 0) {
        primaryData = googleResult.data;
      }
    }

    // If both failed, return error
    if (!primaryData || primaryData.Status !== 0 || times.length === 0) {
      return {
        status: "fail",
        message: "DNS lookup failed on all providers",
        score: 0,
        details: {
          responseTime: Math.min(cloudflareResult.time, googleResult.time),
          error: "No valid DNS response",
        },
      };
    }

    // Check if DNS records exist
    if (!primaryData.Answer || primaryData.Answer.length === 0) {
      return {
        status: "fail",
        message: "DNS records not found",
        score: 0,
        details: {
          responseTime: times[0],
          status: primaryData.Status,
        },
      };
    }

    // Calculate performance metrics across successful providers
    const minTime = Math.min(...times); // Best case (fastest provider)
    const maxTime = Math.max(...times); // Worst case (slowest provider)
    const averageTime = times.reduce((sum, t) => sum + t, 0) / times.length;
    const responseTime = Math.round(averageTime); // Backward compatibility: existing frontends expect this field

    // DNSSEC validation: Check AD (Authenticated Data) flag
    // AD=true means the resolver validated the DNSSEC chain
    // Note: This doesn't guarantee the domain itself has DNSSEC, only that the resolver can validate it
    const dnssecValid = primaryData.AD === true;

    // CDN detection: Check if DNS answers point to known CDN infrastructure
    const cdnDetected = detectCDN(primaryData.Answer);

    // Extract TTL (Time To Live) from first DNS answer record
    // Low TTL (<300s) can impact performance due to frequent re-queries
    const ttl = primaryData.Answer[0]?.TTL || 0;

    // Build comprehensive details object for API response
    // Maintains backward compatibility while adding new diagnostic fields
    const details: Record<string, any> = {
      responseTime, // PRESERVED: Existing frontends expect this (equals averageTime)
      averageTime: Math.round(averageTime), // NEW: Explicit average for clarity
      minTime, // NEW: Best provider performance
      maxTime, // NEW: Worst provider performance
      records: primaryData.Answer.length, // Number of A records returned
      dnssecValid, // NEW: DNSSEC validation status
      cdnDetected, // NEW: CDN infrastructure detected
      ttl, // NEW: DNS TTL in seconds
    };

    // Determine status and score based on performance thresholds
    // Thresholds reflect modern DNS performance standards (2025)
    let status: "pass" | "warn" | "fail";
    let score: number;
    let speedLabel: string;

    if (averageTime < 75) {
      // Pass: Modern DNS providers (Cloudflare, Google, Route53 with edge/Anycast)
      status = "pass";
      score = 10;
      // Distinguish exceptional performance (<20ms) from merely good performance
      speedLabel = averageTime < 20 ? "Excellent" : "Fast";
    } else if (averageTime < 150) {
      // Warn: Acceptable but has room for optimization
      status = "warn";
      score = 5;
      speedLabel = "Moderate";
    } else {
      // Fail: Noticeably slow, impacts user experience
      status = "fail";
      score = 0;
      speedLabel = "Slow";
    }

    // Build informative message with contextual details
    // Include DNSSEC and CDN status for actionable insights
    const dnssecNote = !dnssecValid ? ", DNSSEC not enabled" : "";
    const cdnNote = cdnDetected ? ", CDN detected" : "";
    const message = `${speedLabel} DNS resolution (${responseTime}ms avg${dnssecNote}${cdnNote})`;

    return {
      status,
      message,
      score,
      details,
    };
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";

    if (error.name === "AbortError") {
      return {
        status: "fail",
        message: "DNS lookup timed out",
        score: 0,
        details: {
          error: "Timeout",
        },
      };
    }

    return {
      status: "fail",
      message: "DNS check failed",
      score: 0,
      details: {
        error: errorMessage,
      },
    };
  }
}
