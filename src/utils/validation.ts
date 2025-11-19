/**
 * URL validation utilities
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  normalizedUrl?: string;
}

export function validateAndNormalizeUrl(urlString: string): ValidationResult {
  // Basic check for empty input
  if (!urlString || urlString.trim() === '') {
    return {
      isValid: false,
      error: 'URL is required'
    };
  }

  // Remove whitespace
  urlString = urlString.trim();

  // Add protocol if missing
  if (!/^https?:\/\//i.test(urlString)) {
    urlString = 'https://' + urlString;
  }

  try {
    const url = new URL(urlString);

    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return {
        isValid: false,
        error: 'Only HTTP and HTTPS protocols are supported'
      };
    }

    // Ensure hostname exists
    if (!url.hostname || url.hostname.length === 0) {
      return {
        isValid: false,
        error: 'Invalid hostname'
      };
    }

    // Check for localhost/private IPs (basic check)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return {
        isValid: false,
        error: 'Localhost URLs are not supported'
      };
    }

    return {
      isValid: true,
      normalizedUrl: url.toString()
    };
  } catch (error) {
    return {
      isValid: false,
      error: 'Invalid URL format'
    };
  }
}

export function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
