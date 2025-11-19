/**
 * SSL/TLS Certificate Check
 * Verifies HTTPS works correctly by attempting a secure connection
 */

import type { CheckResult } from '../types';
import { isHttps } from '../utils/validation';

export async function checkSSL(url: string): Promise<CheckResult> {
  try {
    const urlObj = new URL(url);
    const isSecure = isHttps(url);

    // If URL is not HTTPS, it's a fail
    if (!isSecure) {
      return {
        status: 'fail',
        message: 'Site is not using HTTPS - insecure connection',
        score: 0,
        details: {
          protocol: 'http',
          secure: false
        }
      };
    }

    // Try to connect via HTTPS to verify SSL/TLS works
    const httpsUrl = `https://${urlObj.hostname}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(httpsUrl, {
        method: 'HEAD',
        signal: controller.signal,
        // Follow redirects to check if SSL works anywhere in the chain
        redirect: 'follow'
      });

      clearTimeout(timeoutId);

      // If we got here, SSL/TLS connection worked
      return {
        status: 'pass',
        message: 'HTTPS enabled with valid SSL/TLS certificate',
        score: 10,
        details: {
          protocol: 'https',
          secure: true,
          statusCode: response.status
        }
      };
    } catch (fetchError: any) {
      // SSL/TLS connection failed
      const errorMessage = fetchError.message || 'Unknown error';

      if (errorMessage.includes('certificate') || errorMessage.includes('SSL') || errorMessage.includes('TLS')) {
        return {
          status: 'fail',
          message: 'SSL/TLS certificate is invalid or expired',
          score: 0,
          details: {
            protocol: 'https',
            secure: false,
            error: errorMessage
          }
        };
      }

      // Connection timeout or other issue
      return {
        status: 'warn',
        message: 'HTTPS configured but connection issue detected',
        score: 5,
        details: {
          protocol: 'https',
          secure: false,
          error: errorMessage
        }
      };
    }
  } catch (error: any) {
    return {
      status: 'fail',
      message: 'Unable to verify SSL/TLS',
      score: 0,
      details: {
        error: error.message || 'Unknown error'
      }
    };
  }
}
