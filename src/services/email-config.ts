/**
 * Email Configuration Check
 * Verifies if domain has MX records configured
 */

import type { CheckResult, DNSResponse } from '../types';
import { extractHostname } from '../utils/validation';

export async function checkEmailConfig(url: string): Promise<CheckResult> {
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

    // Use Cloudflare DNS-over-HTTPS for MX record lookup
    const dnsUrl = `https://cloudflare-dns.com/dns-query?name=${hostname}&type=MX`;

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

    if (!response.ok) {
      return {
        status: 'warn',
        message: 'Unable to check email configuration',
        score: 5,
        details: {
          error: `HTTP ${response.status}`
        }
      };
    }

    const data = await response.json() as DNSResponse;

    // Check if MX records exist
    if (data.Status === 0 && data.Answer && data.Answer.length > 0) {
      const mxRecords = data.Answer.map(record => record.data);

      return {
        status: 'pass',
        message: `Email configured (${mxRecords.length} MX record${mxRecords.length > 1 ? 's' : ''})`,
        score: 10,
        details: {
          mxRecords: mxRecords.length,
          records: mxRecords
        }
      };
    }

    // No MX records found
    return {
      status: 'warn',
      message: 'No email (MX) records configured',
      score: 5,
      details: {
        mxRecords: 0,
        note: 'Domain cannot receive email'
      }
    };
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';

    if (error.name === 'AbortError') {
      return {
        status: 'warn',
        message: 'Email config check timed out',
        score: 5,
        details: {
          error: 'Timeout'
        }
      };
    }

    return {
      status: 'warn',
      message: 'Unable to verify email configuration',
      score: 5,
      details: {
        error: errorMessage
      }
    };
  }
}
