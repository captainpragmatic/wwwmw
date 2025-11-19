/**
 * DNS Speed Check
 * Measures DNS resolution time using Cloudflare DNS-over-HTTPS
 */

import type { CheckResult, DNSResponse } from '../types';
import { extractHostname } from '../utils/validation';

export async function checkDNSSpeed(url: string): Promise<CheckResult> {
  try {
    const hostname = extractHostname(url);

    if (!hostname) {
      return {
        status: 'fail',
        message: 'Invalid hostname',
        score: 0,
        details: {}
      };
    }

    const startTime = Date.now();

    // Use Cloudflare DNS-over-HTTPS
    const dnsUrl = `https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(dnsUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/dns-json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const endTime = Date.now();
    const responseTime = endTime - startTime;

    if (!response.ok) {
      return {
        status: 'fail',
        message: 'DNS lookup failed',
        score: 0,
        details: {
          responseTime,
          error: `HTTP ${response.status}`
        }
      };
    }

    const data = await response.json() as DNSResponse;

    // Check if DNS resolution was successful
    if (data.Status !== 0 || !data.Answer || data.Answer.length === 0) {
      return {
        status: 'fail',
        message: 'DNS records not found',
        score: 0,
        details: {
          responseTime,
          status: data.Status
        }
      };
    }

    // Score based on response time
    if (responseTime < 200) {
      return {
        status: 'pass',
        message: `Fast DNS resolution (${responseTime}ms)`,
        score: 10,
        details: {
          responseTime,
          records: data.Answer.length
        }
      };
    } else if (responseTime < 500) {
      return {
        status: 'warn',
        message: `Moderate DNS resolution (${responseTime}ms)`,
        score: 5,
        details: {
          responseTime,
          records: data.Answer.length
        }
      };
    } else {
      return {
        status: 'fail',
        message: `Slow DNS resolution (${responseTime}ms)`,
        score: 0,
        details: {
          responseTime,
          records: data.Answer.length
        }
      };
    }
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';

    if (error.name === 'AbortError') {
      return {
        status: 'fail',
        message: 'DNS lookup timed out (>5s)',
        score: 0,
        details: {
          error: 'Timeout'
        }
      };
    }

    return {
      status: 'fail',
      message: 'DNS check failed',
      score: 0,
      details: {
        error: errorMessage
      }
    };
  }
}
