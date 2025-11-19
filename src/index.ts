/**
 * WWWMW API - What's Wrong With My Website
 * Cloudflare Worker for website diagnostics
 */

import type { Env, ScanResponse, CheckResults, CheckResult } from './types';
import { validateAndNormalizeUrl, isHttps } from './utils/validation';
import { corsHeaders, handleCorsPreFlight, createCorsResponse } from './utils/cors';
import { errorResponse, validationErrorResponse, notFoundResponse } from './utils/errors';
import {
  calculateOverallScore,
  getScoreLevel,
  identifyCriticalIssues,
  generateRecommendations
} from './utils/scoring';
import {
  checkRateLimit,
  getClientIP,
  rateLimitResponse,
  addRateLimitHeaders
} from './utils/rate-limit';

// Service imports
import { checkSSL } from './services/ssl-check';
import { checkDNSSpeed } from './services/dns-speed';
import { checkPageSpeed } from './services/pagespeed-check';
import { checkServerResponse } from './services/server-response';
import { checkAvailability } from './services/availability-check';
import { checkEmailConfig } from './services/email-config';

async function handleScan(targetUrl: string, env: Env): Promise<Response> {
  try {
    // Validate and normalize URL
    const validation = validateAndNormalizeUrl(targetUrl);

    if (!validation.isValid) {
      return validationErrorResponse(validation.error || 'Invalid URL');
    }

    const normalizedUrl = validation.normalizedUrl!;

    // Run all checks in parallel for optimal performance
    const [sslResult, dnsResult, serverResponseResult, availabilityResult, emailResult, pageSpeedResult] =
      await Promise.all([
        checkSSL(normalizedUrl),
        checkDNSSpeed(normalizedUrl),
        checkServerResponse(normalizedUrl),
        checkAvailability(normalizedUrl),
        checkEmailConfig(normalizedUrl),
        checkPageSpeed(normalizedUrl, env.GOOGLE_PAGESPEED_API_KEY)
      ]);

    // Derive mobile check from PageSpeed
    const mobileResult: CheckResult = deriveMobileCheck(pageSpeedResult);

    // Derive HTTPS check from SSL
    const httpsResult: CheckResult = deriveHttpsCheck(sslResult, normalizedUrl);

    // Aggregate all checks
    const checks: CheckResults = {
      ssl: sslResult,
      dns: dnsResult,
      serverResponse: serverResponseResult,
      pageSpeed: pageSpeedResult,
      mobile: mobileResult,
      https: httpsResult,
      availability: availabilityResult,
      email: emailResult
    };

    // Calculate overall score
    const overallScore = calculateOverallScore(checks);
    const { level, color } = getScoreLevel(overallScore);

    // Identify critical issues and generate recommendations
    const criticalIssues = identifyCriticalIssues(checks);
    const recommendations = generateRecommendations(checks);

    // Build response
    const response: ScanResponse = {
      url: normalizedUrl,
      timestamp: new Date().toISOString(),
      overallScore,
      scoreLevel: level,
      scoreColor: color,
      checks,
      criticalIssues,
      recommendations
    };

    return createCorsResponse(response, 200);
  } catch (error: any) {
    console.error('Scan error:', error);
    return errorResponse('Internal server error during scan', 500);
  }
}

function deriveMobileCheck(pageSpeedResult: CheckResult): CheckResult {
  // Mobile performance is derived from PageSpeed mobile score
  const performanceScore = pageSpeedResult.details?.performanceScore || 0;

  if (pageSpeedResult.status === 'fail' || performanceScore < 50) {
    return {
      status: 'warn',
      message: 'Mobile performance needs improvement',
      score: 5,
      details: {
        derivedFrom: 'pageSpeed',
        performanceScore
      }
    };
  }

  if (pageSpeedResult.status === 'warn' || performanceScore < 90) {
    return {
      status: 'pass',
      message: 'Good mobile performance',
      score: 12,
      details: {
        derivedFrom: 'pageSpeed',
        performanceScore
      }
    };
  }

  return {
    status: 'pass',
    message: 'Excellent mobile performance',
    score: 15,
    details: {
      derivedFrom: 'pageSpeed',
      performanceScore
    }
  };
}

function deriveHttpsCheck(sslResult: CheckResult, url: string): CheckResult {
  const httpsEnabled = isHttps(url);

  if (!httpsEnabled) {
    return {
      status: 'fail',
      message: 'Site not using HTTPS',
      score: 0,
      details: {
        derivedFrom: 'ssl',
        protocol: 'http'
      }
    };
  }

  if (sslResult.status === 'pass') {
    return {
      status: 'pass',
      message: 'HTTPS properly configured',
      score: 10,
      details: {
        derivedFrom: 'ssl',
        protocol: 'https'
      }
    };
  }

  if (sslResult.status === 'warn') {
    return {
      status: 'warn',
      message: 'HTTPS enabled but with issues',
      score: 5,
      details: {
        derivedFrom: 'ssl',
        protocol: 'https'
      }
    };
  }

  return {
    status: 'fail',
    message: 'HTTPS not working properly',
    score: 0,
    details: {
      derivedFrom: 'ssl',
      protocol: 'https'
    }
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCorsPreFlight();
    }

    const url = new URL(request.url);

    // Health check endpoint (no rate limiting)
    if (url.pathname === '/health') {
      return new Response('OK', {
        status: 200,
        headers: corsHeaders
      });
    }

    // Check rate limit for all other requests
    const clientIP = getClientIP(request);
    const rateLimitResult = await checkRateLimit(env.RATE_LIMITER, clientIP);

    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult.resetAt);
    }

    // Main scan endpoint
    if (url.pathname === '/' && request.method === 'GET') {
      const targetUrl = url.searchParams.get('url');

      if (!targetUrl) {
        return validationErrorResponse('Missing url parameter');
      }

      const response = await handleScan(targetUrl, env);
      return addRateLimitHeaders(response, rateLimitResult);
    }

    // 404 for all other routes
    return notFoundResponse();
  }
};
