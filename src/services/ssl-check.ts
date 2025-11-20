/**
 * SSL/TLS Certificate Check
 * 
 * Verifies HTTPS works correctly by attempting a secure connection and optionally
 * retrieves certificate details from Certificate Transparency logs for expiration monitoring.
 * 
 * Two-stage approach:
 * 1. Real-time handshake test (fast, confirms SSL works right now)
 * 2. CT log lookup (slower, provides expiry/issuer details)
 * 
 * Falls back gracefully if CT logs are unavailable.
 */

import type { CheckResult } from '../types';
import { isHttps } from '../utils/validation';

/**
 * Certificate data from Certificate Transparency logs
 */
interface CTLogCertificate {
  issuer_ca_id: number;
  issuer_name: string;
  name_value: string; // SANs (newline separated)
  min_cert_id: number;
  min_entry_timestamp: string;
  not_before: string;
  not_after: string;
}

/**
 * Fetch certificate details from Certificate Transparency logs (crt.sh)
 * 
 * CT logs provide historical certificate data including expiration dates,
 * issuers, and Subject Alternative Names (SANs). This is a free public service
 * but may have rate limits or occasional unavailability.
 * 
 * @param hostname - The domain to look up (e.g., "example.com")
 * @returns Certificate details or null if lookup fails
 */
async function getCertificateFromCTLogs(hostname: string): Promise<{
  expiresAt: string;
  daysUntilExpiry: number;
  issuer: string;
  sans: number;
  expiringSoon: boolean;
} | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

    const response = await fetch(
      `https://crt.sh/?q=${encodeURIComponent(hostname)}&output=json`,
      {
        headers: {
          'User-Agent': 'WWWMW-Scanner/1.0'
        },
        signal: controller.signal
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const certs: CTLogCertificate[] = await response.json();

    if (!certs || certs.length === 0) {
      return null;
    }

    // Find the most recent certificate that hasn't expired yet
    const now = new Date();
    const activeCert = certs
      .filter(cert => new Date(cert.not_after) > now)
      .sort((a, b) => new Date(b.not_before).getTime() - new Date(a.not_before).getTime())[0];

    if (!activeCert) {
      // All certs expired, get the most recently expired one for info
      const mostRecentExpired = certs
        .sort((a, b) => new Date(b.not_after).getTime() - new Date(a.not_after).getTime())[0];
      
      if (mostRecentExpired) {
        const daysExpired = Math.floor(
          (now.getTime() - new Date(mostRecentExpired.not_after).getTime()) / 86400000
        );
        
        return {
          expiresAt: mostRecentExpired.not_after,
          daysUntilExpiry: -daysExpired,
          issuer: mostRecentExpired.issuer_name,
          sans: mostRecentExpired.name_value.split('\n').length,
          expiringSoon: false
        };
      }
      return null;
    }

    const expiresAt = new Date(activeCert.not_after);
    const daysUntilExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / 86400000);
    const expiringSoon = daysUntilExpiry <= 30;

    return {
      expiresAt: activeCert.not_after,
      daysUntilExpiry,
      issuer: activeCert.issuer_name,
      sans: activeCert.name_value.split('\n').length,
      expiringSoon
    };
  } catch (error) {
    // CT log lookup failed - return null to fall back to handshake-only check
    return null;
  }
}

/**
 * Check SSL/TLS certificate status with enhanced expiration monitoring
 * 
 * Performs two checks:
 * 1. Real-time HTTPS handshake (confirms certificate works now)
 * 2. Certificate Transparency log lookup (provides expiry details)
 * 
 * Gracefully falls back to handshake-only if CT logs are unavailable.
 * 
 * @param url - The full URL to check
 * @returns CheckResult with status, message, score, and certificate details
 */
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

    const httpsUrl = `https://${urlObj.hostname}`;

    // Stage 1: Real-time HTTPS handshake test
    let handshakeSuccess = false;
    let handshakeError: string | null = null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(httpsUrl, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow'
      });

      clearTimeout(timeoutId);
      handshakeSuccess = true;
    } catch (fetchError: any) {
      handshakeError = fetchError.message || 'Unknown error';
    }

    // If handshake failed, return early
    if (!handshakeSuccess) {
      const errorMessage = handshakeError || 'Unknown error';
      
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

    // Stage 2: Attempt to get certificate details from CT logs
    // This runs in parallel with the response but we await it
    const certDetails = await getCertificateFromCTLogs(urlObj.hostname);

    // Build response based on handshake + CT log data
    if (certDetails) {
      // We have certificate details from CT logs
      const { daysUntilExpiry, expiresAt, issuer, sans, expiringSoon } = certDetails;

      if (daysUntilExpiry < 0) {
        // Certificate expired (but handshake somehow succeeded - maybe cached/stale CT data)
        return {
          status: 'warn',
          message: `HTTPS enabled but certificate expired ${Math.abs(daysUntilExpiry)} days ago`,
          score: 5,
          details: {
            protocol: 'https',
            secure: true,
            expiresAt,
            daysUntilExpiry,
            expired: true,
            issuer,
            sans,
            certTransparency: true
          }
        };
      }

      if (expiringSoon) {
        // Certificate expiring within 30 days
        return {
          status: 'warn',
          message: `HTTPS enabled, certificate expires in ${daysUntilExpiry} days`,
          score: 8,
          details: {
            protocol: 'https',
            secure: true,
            expiresAt,
            daysUntilExpiry,
            expiringSoon: true,
            issuer,
            sans,
            certTransparency: true
          }
        };
      }

      // Certificate valid and not expiring soon
      return {
        status: 'pass',
        message: `HTTPS enabled with valid certificate (expires in ${daysUntilExpiry} days)`,
        score: 10,
        details: {
          protocol: 'https',
          secure: true,
          expiresAt,
          daysUntilExpiry,
          expiringSoon: false,
          issuer,
          sans,
          certTransparency: true
        }
      };
    }

    // Fallback: CT log lookup failed, use handshake-only result
    return {
      status: 'pass',
      message: 'HTTPS enabled with valid SSL/TLS certificate',
      score: 10,
      details: {
        protocol: 'https',
        secure: true,
        certTransparency: false // Indicates CT log lookup was unsuccessful
      }
    };
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
