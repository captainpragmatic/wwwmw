/**
 * Google PageSpeed Insights Check
 * Measures page performance using Google's PageSpeed API v5
 */

import type { CheckResult, PageSpeedResponse } from '../types';

export async function checkPageSpeed(url: string, apiKey: string): Promise<CheckResult> {
  try {
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&key=${apiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(apiUrl, {
      method: 'GET',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Graceful degradation if API fails
      console.error('PageSpeed API error:', response.status);
      return {
        status: 'warn',
        message: 'Unable to fetch PageSpeed data - API unavailable',
        score: 8,
        details: {
          error: `HTTP ${response.status}`,
          note: 'PageSpeed check skipped'
        }
      };
    }

    const data = await response.json() as PageSpeedResponse;

    // Extract performance score (0-1, multiply by 100 for percentage)
    const performanceScore = Math.round(
      (data.lighthouseResult?.categories?.performance?.score || 0) * 100
    );

    // Extract Core Web Vitals
    const audits = data.lighthouseResult?.audits || {};
    const fcp = audits['first-contentful-paint']?.displayValue || 'N/A';
    const lcp = audits['largest-contentful-paint']?.displayValue || 'N/A';
    const cls = audits['cumulative-layout-shift']?.displayValue || 'N/A';

    const details = {
      performanceScore,
      metrics: {
        fcp,
        lcp,
        cls
      }
    };

    // Scoring based on PageSpeed score
    if (performanceScore >= 90) {
      return {
        status: 'pass',
        message: `Excellent performance (${performanceScore}/100)`,
        score: 15,
        details
      };
    } else if (performanceScore >= 50) {
      return {
        status: 'warn',
        message: `Moderate performance (${performanceScore}/100)`,
        score: 10,
        details
      };
    } else {
      return {
        status: 'fail',
        message: `Poor performance (${performanceScore}/100)`,
        score: 5,
        details
      };
    }
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';

    if (error.name === 'AbortError') {
      // Timeout - graceful degradation
      return {
        status: 'warn',
        message: 'PageSpeed check timed out - may indicate slow page',
        score: 8,
        details: {
          error: 'Timeout after 30 seconds',
          note: 'This timeout suggests performance issues'
        }
      };
    }

    // Other errors - graceful degradation
    console.error('PageSpeed check error:', errorMessage);
    return {
      status: 'warn',
      message: 'Unable to complete PageSpeed check',
      score: 8,
      details: {
        error: errorMessage,
        note: 'PageSpeed check skipped'
      }
    };
  }
}
